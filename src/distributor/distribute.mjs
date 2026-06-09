import { readFileSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdapter } from "./adapters/index.mjs";
import { parseRegions, replaceRegionInner } from "./regionEngine.mjs";
import { appliesTo } from "./appliesTo.mjs";
import { safeJoin } from "../server/lib/paths.mjs";

// Distributor orchestration (#145 PR2, design §9-§10). The region engine stays
// pure; this layer owns every filesystem and repo-policy decision: dry-run vs
// apply, skip dirty/protected, applicability gating, atomic writes, metadata
// preservation, previews. `distributeRepo` is the per-repo function reused by
// audit, apply, and the globalUpdates delegation so one code path computes all
// three answers.

// Never write to a checked-out default branch (safety rule; same set the
// globalUpdates path has always used as its fallback).
const PROTECTED_BRANCHES = new Set(["main", "master"]);

const MARKER_SHAPES = {
  "global-update": {
    markdown: (id) => ({
      begin: `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${id} -->`,
      end: `<!-- END ARCHONVII GLOBAL UPDATE: ${id} -->`,
    }),
  },
  managed: {
    markdown: (id) => ({
      begin: `<!-- BEGIN ARCHONVII MANAGED: ${id} -->`,
      end: `<!-- END ARCHONVII MANAGED: ${id} -->`,
    }),
    hash: (id) => ({
      begin: `# BEGIN ARCHONVII MANAGED: ${id}`,
      end: `# END ARCHONVII MANAGED: ${id}`,
    }),
  },
};

function markerLines(entry, style) {
  const shape = MARKER_SHAPES[entry.markerShape ?? "managed"]?.[style];
  if (!shape) throw new Error(`no marker shape "${entry.markerShape}" for style "${style}"`);
  return shape(entry.id);
}

function emptyCounts() {
  return { cleanApply: 0, changed: 0, adoptionNeeded: 0, conflicts: 0, skips: 0, failures: 0, written: 0 };
}

function tallyCounts(files) {
  const counts = emptyCounts();
  for (const file of files) {
    if (file.status === "clean_apply") {
      counts.cleanApply += 1;
      if (file.changed) counts.changed += 1;
    } else if (file.status === "adoption_needed") counts.adoptionNeeded += 1;
    else if (file.status === "conflict") counts.conflicts += 1;
    else if (file.status === "skip") counts.skips += 1;
    else if (file.status === "failed") counts.failures += 1;
    if (file.written) counts.written += 1;
  }
  return counts;
}

async function readTarget(fullPath) {
  try {
    return { exists: true, body: await readFile(fullPath, "utf8") };
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, body: null };
    throw err;
  }
}

// tmp-in-same-dir + rename so a crash mid-write never leaves a truncated
// target (NFR "Atomic writes"). On POSIX the original mode is restored after
// the rename; on Windows chmod is a no-op.
async function writeAtomic(fullPath, content, { preserveModeFrom = null } = {}) {
  const tmpPath = `${fullPath}.archon-tmp-${process.pid}-${Math.floor(Math.random() * 1e6)}`;
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(tmpPath, content, "utf8");
  if (preserveModeFrom !== null && process.platform !== "win32") {
    await chmod(tmpPath, preserveModeFrom);
  }
  await rename(tmpPath, fullPath);
}

function ensureTrailingNewline(body) {
  return body.endsWith("\n") ? body : `${body}\n`;
}

// Exact legacy append format (globalUpdates.applyGlobalUpdateToAgents):
// trailing newline ensured, one blank separator line, then the marked block.
function appendBlock(body, entry, style) {
  const { begin, end } = markerLines(entry, style);
  const block = `${begin}\n${entry.inner}\n${end}\n`;
  return `${ensureTrailingNewline(body)}\n${block}`;
}

function previewBody(repo, relpath, proposals) {
  const lines = [
    "# archon-setup distribute preview",
    `# repo: ${repo.name}  file: ${relpath}`,
    "# Proposed adoption(s) — review, then re-run with the region adopted or",
    "# resolve via the decision flow. This file is never applied automatically.",
    "",
  ];
  for (const proposal of proposals) {
    lines.push(`## region: ${proposal.id}  anchor: ${proposal.anchor}`, "", proposal.block, "");
  }
  return lines.join("\n");
}

async function reconcileFile({ repo, relpath, entries, knownIds, mode, writePreview, adoptAnchored }) {
  const base = { relpath, regions: [], diagnostics: [], changed: false, written: false };

  let fullPath;
  try {
    fullPath = safeJoin(repo.path, relpath);
  } catch {
    return { ...base, status: "skip", reason: "path-safety" };
  }

  let adapter;
  try {
    adapter = getAdapter(entries[0].adapter);
  } catch {
    return { ...base, status: "skip", reason: "unsupported-file-type" };
  }
  if (entries.some((e) => e.adapter !== entries[0].adapter)) {
    return { ...base, status: "conflict", reason: "adapter-mismatch" };
  }
  const style = adapter.commentStyle;

  let target;
  try {
    target = await readTarget(fullPath);
  } catch (err) {
    return { ...base, status: "failed", reason: "read-failed", error: err.message };
  }

  if (!target.exists) {
    // A5: the distributor owns the absent-file decision via the applicability
    // profile; the engine never creates files. Creation requires a single
    // whole-file entry whose snapshot body is fully and validly marked.
    const creatable = entries.filter((e) => appliesTo(e, { targetExists: false }).applies);
    if (creatable.length === 0) {
      return { ...base, status: "skip", reason: "not-applicable" };
    }
    const entry = creatable[0];
    if (creatable.length > 1 || !entry.wholeFile || !entry.snapshotBody) {
      return { ...base, status: "skip", reason: "no-create-source" };
    }
    const parsed = parseRegions(entry.snapshotBody, style);
    if (parsed.diagnostics.length || !parsed.regions.some((r) => r.id === entry.id)) {
      return { ...base, status: "conflict", reason: "invalid-snapshot-markup", diagnostics: parsed.diagnostics };
    }
    const regions = [{ id: entry.id, status: "clean_apply", changed: true }];
    if (mode !== "apply") {
      return { ...base, status: "clean_apply", changed: true, regions };
    }
    try {
      await writeAtomic(fullPath, entry.snapshotBody);
      return { ...base, status: "clean_apply", changed: true, written: true, regions };
    } catch (err) {
      return { ...base, status: "failed", reason: "write-failed", error: err.message, regions };
    }
  }

  const body = target.body;
  const parsed = parseRegions(body, style);
  if (parsed.diagnostics.length) {
    return { ...base, status: "conflict", reason: "malformed-markers", diagnostics: parsed.diagnostics };
  }

  const regions = [];
  let hasConflict = false;

  // A1/DL5: unknown/deprecated ids are checked against the FULL catalog,
  // independent of which entries this run selected.
  for (const consumerRegion of parsed.regions) {
    if (knownIds.has(consumerRegion.id)) continue;
    hasConflict = true;
    regions.push({ id: consumerRegion.id, status: "conflict", reason: "unknown-id", changed: false });
  }

  const presentIds = new Set(parsed.regions.map((r) => r.id));
  let working = body;
  let changed = false;
  const adoptions = [];

  for (const entry of entries) {
    if (presentIds.has(entry.id)) {
      const replaced = replaceRegionInner(working, entry.id, entry.inner, style);
      working = replaced.body;
      changed = changed || replaced.changed;
      regions.push({ id: entry.id, status: "clean_apply", changed: replaced.changed });
    } else {
      adoptions.push(entry);
    }
  }

  const anchoredAdoptions = adoptions.filter((e) => e.anchor?.kind === "eof-append");
  let pendingAdoptions = adoptions;
  if (adoptAnchored && adoptions.length > 0 && anchoredAdoptions.length === adoptions.length) {
    for (const entry of anchoredAdoptions) {
      working = appendBlock(working, entry, style);
      changed = true;
      regions.push({ id: entry.id, status: "clean_apply", changed: true, adopted: true });
    }
    pendingAdoptions = [];
  } else {
    for (const entry of adoptions) {
      regions.push({ id: entry.id, status: "adoption_needed", changed: false });
    }
  }

  // Danger detection on the would-be result (DL6: parsers detect danger only;
  // any flag means a human resolves it — never write).
  if (changed) {
    const dangers = adapter.detectDanger(working);
    if (dangers.length > 0) {
      return { ...base, status: "conflict", reason: "danger-detected", regions, dangers };
    }
  }

  const fileStatus = hasConflict ? "conflict" : pendingAdoptions.length > 0 ? "adoption_needed" : "clean_apply";

  let previewPath;
  if (writePreview && pendingAdoptions.length > 0) {
    const proposals = pendingAdoptions
      .filter((e) => e.anchor?.kind === "eof-append")
      .map((e) => {
        const { begin, end } = markerLines(e, style);
        return { id: e.id, anchor: e.anchor.kind, block: `${begin}\n${e.inner}\n${end}` };
      });
    if (proposals.length > 0) {
      previewPath = safeJoin(repo.path, join(".archon", "distribute-preview", `${relpath}.patch`));
      await mkdir(dirname(previewPath), { recursive: true });
      await writeAtomic(previewPath, previewBody(repo, relpath, proposals));
    }
  }

  const result = { ...base, status: fileStatus, changed, regions };
  if (previewPath) result.previewPath = previewPath;

  if (fileStatus !== "clean_apply" || !changed || mode !== "apply") {
    return result;
  }

  // Metadata preservation (A7 policy is declared by the adapter, enforced here).
  if (adapter.metadataPolicy.shebangFirstLine && body.startsWith("#!") && !working.startsWith("#!")) {
    return { ...result, status: "failed", reason: "shebang-violation" };
  }
  try {
    let preserveModeFrom = null;
    if (adapter.metadataPolicy.preserveExecBit && process.platform !== "win32") {
      preserveModeFrom = (await stat(fullPath)).mode;
    }
    await writeAtomic(fullPath, working, { preserveModeFrom });
    return { ...result, written: true };
  } catch (err) {
    return { ...result, status: "failed", reason: "write-failed", error: err.message };
  }
}

export async function distributeRepo({
  repo,
  catalog,
  groups = null,
  ids = null,
  mode = "dry-run",
  writePreview = false,
  adoptAnchored = false,
}) {
  const base = {
    repo: repo.name,
    path: repo.path ?? null,
    branch: repo.branch ?? null,
    files: [],
    counts: emptyCounts(),
  };

  if (!repo.path) return { ...base, status: "skipped", reason: "missing-path" };
  if (repo.dirty) return { ...base, status: "skipped", reason: "dirty-worktree" };
  if (PROTECTED_BRANCHES.has(repo.branch)) return { ...base, status: "skipped", reason: "protected-main" };

  // A1: --group/--id scope which entries this run acts on; the unknown-id
  // check inside reconcileFile still runs against catalog.knownIds.
  const selected = catalog.entries.filter(
    (entry) => (!groups || groups.includes(entry.group)) && (!ids || ids.includes(entry.id)),
  );

  const byFile = new Map();
  for (const entry of selected) {
    if (!byFile.has(entry.targetRelpath)) byFile.set(entry.targetRelpath, []);
    byFile.get(entry.targetRelpath).push(entry);
  }

  const files = [];
  for (const [relpath, entries] of byFile) {
    files.push(
      await reconcileFile({
        repo,
        relpath,
        entries,
        knownIds: catalog.knownIds,
        mode,
        writePreview,
        adoptAnchored,
      }),
    );
  }

  return { ...base, status: "ok", files, counts: tallyCounts(files) };
}

// Run-log default lives outside every consumer worktree (DL12/design §9).
export const DEFAULT_LOG_PATH = join(homedir(), ".claude", "archon-distribute-log.jsonl");

// The --all --apply confirmation phrase mirrors the run's scope so a pasted
// phrase can never authorize a broader run than the one it was issued for.
export function confirmationPhraseFor({ groups = null, ids = null } = {}) {
  if (ids?.length) return `DISTRIBUTE ALL --id ${ids.join(",")}`;
  if (groups?.length) return `DISTRIBUTE ALL --group ${groups.join(",")}`;
  return "DISTRIBUTE ALL";
}

function aggregateCounts(results) {
  const totals = emptyCounts();
  for (const result of results) {
    for (const key of Object.keys(totals)) totals[key] += result.counts?.[key] ?? 0;
  }
  return totals;
}

// Trim per-repo results for the JSONL log: statuses and reasons only — file
// bodies and region inners never land in the log (secret-safety NFR by
// construction rather than by redaction).
function logView(results) {
  return results.map((result) => ({
    repo: result.repo,
    path: result.path,
    branch: result.branch,
    status: result.status,
    reason: result.reason,
    files: (result.files ?? []).map((file) => ({
      relpath: file.relpath,
      status: file.status,
      reason: file.reason,
      changed: file.changed,
      written: file.written,
      regions: file.regions?.map((r) => ({ id: r.id, status: r.status, changed: r.changed, reason: r.reason })),
    })),
  }));
}

export async function distribute({
  repos,
  all = false,
  apply = false,
  confirmation = null,
  catalog,
  groups = null,
  ids = null,
  writePreview = false,
  adoptAnchored = false,
  logPath = DEFAULT_LOG_PATH,
  now = new Date().toISOString(),
} = {}) {
  const mode = apply ? "apply" : "dry-run";

  // Fleet-wide apply is confirmation-gated (design §9); dry-run and explicit
  // single-target runs are not.
  if (all && apply) {
    const phrase = confirmationPhraseFor({ groups, ids });
    if (confirmation !== phrase) {
      return {
        ok: false,
        status: "confirmation-required",
        confirmationPhrase: phrase,
        mode,
        results: [],
        counts: emptyCounts(),
      };
    }
  }

  const results = [];
  for (const repo of repos ?? []) {
    results.push(
      await distributeRepo({ repo, catalog, groups, ids, mode, writePreview, adoptAnchored }),
    );
  }

  const counts = aggregateCounts(results);
  const run = {
    ok: counts.failures === 0,
    status: counts.failures === 0 ? "completed" : "completed-with-errors",
    mode,
    groups,
    ids,
    results,
    counts,
  };

  if (logPath) {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(
      logPath,
      `${JSON.stringify({ schemaVersion: 1, kind: "distribute", generatedAt: now, mode, groups, ids, counts, results: logView(results) })}\n`,
      "utf8",
    );
  }

  return run;
}

// A6 exit-code precedence: 1 operational failure, else 20 when user action
// remains (adoption/conflict, or an unconfirmed fleet apply), else 10 when a
// dry-run found pending clean changes, else 0.
export function exitCodeFor(run) {
  if (run.status === "confirmation-required") return 20;
  if (run.counts.failures > 0 || run.status === "completed-with-errors") return 1;
  if (run.counts.adoptionNeeded > 0 || run.counts.conflicts > 0) return 20;
  if (run.mode === "dry-run" && run.counts.changed > 0) return 10;
  return 0;
}

const DISTRIBUTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Default catalog for CLI runs: the committed managed-regions manifest plus
// the globalUpdates catalog. globalUpdates.mjs is imported lazily because it
// delegates back into this module (delegation, #145 PR2) — a static import
// would create a cycle.
export async function loadDefaultCatalog({ root = DISTRIBUTOR_ROOT } = {}) {
  const manifestPath = join(root, "src", "distributor", "managed-regions.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const { listGlobalUpdates } = await import("../server/globalUpdates.mjs");
  const { buildCatalog } = await import("./catalogSource.mjs");
  return buildCatalog({
    manifest,
    // A4 snapshotFile paths are repo-root-relative (e.g. src/snapshots/...).
    read: (relpath) => readFileSync(resolve(root, relpath), "utf8"),
    globalUpdates: listGlobalUpdates(),
  });
}
