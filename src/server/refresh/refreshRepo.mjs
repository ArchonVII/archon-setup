import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { distributeRepo, loadDefaultCatalog, repoContextFor } from "../../distributor/distribute.mjs";
import { loadOperationMapping, operationRowFor } from "../../contracts/operationMapping.mjs";
import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";
import { runCommand } from "../lib/commandRunner.mjs";
import { safeJoin } from "../lib/paths.mjs";

// M1 refresh audit engine (#157): one repo -> RepoRefreshReport. Reuses
// distributeRepo (mode "audit") as the single reconcile code path and projects
// every finding through the M0.5 operation-mapping golden, so the audit, the
// decision doc (M2), and the PR lane (M3) can never disagree about what a raw
// state means. The engine validates its own output against the M0.5 schema
// before returning — a projection bug fails loudly, never ships a malformed
// report (DL4 fail closed).

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "..", "contracts", "schemas", "repo-refresh-report.schema.json"), "utf8"),
);
assertSchemaSupported(REPORT_SCHEMA);

// The golden table's scenario-dependent rows (operation.currentState null)
// are resolved here: a conflict or failure means the region's true state is
// unknowable; a skip is judged by whether the target file exists.
function currentStateFor(row, { status, fileExisted }) {
  if (row.operation.currentState !== null && row.operation.currentState !== undefined) {
    return row.operation.currentState;
  }
  if (status === "skip") return fileExisted ? "present" : "missing";
  return "unknown";
}

function buildItem({ mapping, category, relpath, regionId, status, reason, changed, fileExisted, diff }) {
  const created = !fileExisted;
  const row = operationRowFor(mapping, { status, changed, created });

  const raw = { status, changed, created };
  if (reason) raw.reason = reason;

  const operation = {
    action: row.operation.action,
    currentState: currentStateFor(row, { status, fileExisted }),
  };
  if (row.requiresConfirmation) operation.requiresConfirmation = true;
  if (diff !== undefined) operation.diff = diff;
  if (operation.action === "blocked") operation.blockerReason = reason ?? "unknown";

  return {
    itemId: regionId === null ? `${category}/${relpath}` : `${category}/${relpath}#${regionId}`,
    category,
    regionId,
    file: relpath,
    raw,
    operation,
    recommended: row.recommended,
    recommendationReason: row.recommendationReason,
  };
}

// File results collapse to one file-level item when the file-level verdict is
// authoritative (operational failures, and conflicts carrying a file reason —
// adapter-mismatch, malformed-markers, danger-detected, replace-failed: their
// per-region statuses may read clean while the file as a whole is blocked).
// Otherwise each region is its own item (the unknown-id conflict case keeps
// per-region granularity: the unknown region blocks, siblings stay honest).
function itemsForFile({ mapping, category, file, fileExisted }) {
  const fileLevelVerdict =
    file.status === "failed" || (file.status === "conflict" && file.reason) || !(file.regions?.length > 0);

  if (fileLevelVerdict) {
    return [
      buildItem({
        mapping,
        category,
        relpath: file.relpath,
        regionId: null,
        status: file.status,
        reason: file.reason,
        changed: file.changed ?? false,
        fileExisted,
        diff: null,
      }),
    ];
  }

  return file.regions.map((region) =>
    buildItem({
      mapping,
      category,
      relpath: file.relpath,
      regionId: region.id,
      status: region.status,
      reason: region.reason,
      changed: region.changed ?? false,
      fileExisted,
      diff: region.diff ?? null,
    }),
  );
}

// Existence is probed BEFORE reconcile so the mapping's `created` dimension is
// the engine's own knowledge, not inferred from distributor output (the
// operation-mapping notes pin this contract). A path-safety failure reads as
// absent — the resulting item is a skip either way.
function probeExistence(repo, relpaths) {
  const exists = new Map();
  for (const relpath of relpaths) {
    let fileExisted = false;
    try {
      fileExisted = existsSync(safeJoin(repo.path, relpath));
    } catch {
      fileExisted = false;
    }
    exists.set(relpath, fileExisted);
  }
  return exists;
}

function readOwnership(repoPath) {
  const empty = { itemIds: new Set(), malformed: false };
  if (!repoPath) return empty;

  let body;
  try {
    body = readFileSync(safeJoin(repoPath, ".archon/region-ownership.json"), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return empty;
    return { itemIds: new Set(), malformed: true };
  }

  try {
    const parsed = JSON.parse(body);
    const records = Array.isArray(parsed.records) ? parsed.records : Array.isArray(parsed.regions) ? parsed.regions : null;
    if (!records) return { itemIds: new Set(), malformed: true };

    const itemIds = new Set();
    for (const record of records) {
      if (record && typeof record.itemId === "string") itemIds.add(record.itemId);
      if (record && typeof record.file === "string" && typeof record.regionId === "string") {
        itemIds.add(`${record.category ?? "agents"}/${record.file}#${record.regionId}`);
      }
    }
    return { itemIds, malformed: false };
  } catch {
    return { itemIds: new Set(), malformed: true };
  }
}

export async function refreshRepo({
  repo,
  catalog,
  categories = ["agents"],
  mapping = loadOperationMapping(),
  now = new Date().toISOString(),
  baseSha = null,
}) {
  const repoBlock = { name: repo.name, path: repo.path ?? null, branch: repo.branch ?? null };
  if (baseSha) repoBlock.baseSha = baseSha;

  const report = {
    schemaVersion: 1,
    kind: "repo-refresh-report",
    generatedAt: now,
    repo: repoBlock,
    status: "ok",
    categories: [],
  };

  const ownership = readOwnership(repo.path);

  for (const category of categories) {
    const relpaths = [
      ...new Set(catalog.entries.filter((e) => e.group === category).map((e) => e.targetRelpath)),
    ];
    const exists = repo.path ? probeExistence(repo, relpaths) : new Map();

    const result = await distributeRepo({ repo, catalog, groups: [category], mode: "audit" });
    if (result.status === "skipped") {
      // Repo-level gates are category-independent: report once and stop.
      report.status = "skipped";
      report.reason = result.reason;
      report.categories = [];
      break;
    }

    let items = result.files
      .flatMap((file) =>
        itemsForFile({ mapping, category, file, fileExisted: exists.get(file.relpath) ?? false }),
      );
    if (ownership.malformed && category === "agents") {
      items.push(
        buildItem({
          mapping,
          category,
          relpath: ".archon/region-ownership.json",
          regionId: null,
          status: "conflict",
          reason: "malformed-region-ownership",
          changed: false,
          fileExisted: true,
          diff: null,
        }),
      );
    }
    items = items
      .filter((item) => !ownership.itemIds.has(item.itemId))
      .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

    report.categories.push({ category, items });
  }

  const checked = validate(REPORT_SCHEMA, report);
  if (!checked.valid) {
    const detail = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`refreshRepo produced a schema-invalid RepoRefreshReport: ${detail}`);
  }
  return report;
}

// null = no resolvable HEAD (empty repo, git failure) — baseSha is then
// omitted, which the schema allows.
async function gitHeadSha(repoPath) {
  try {
    const { code, stdout } = await runCommand("git", ["-C", repoPath, "rev-parse", "HEAD"], {
      timeoutMs: 15_000,
    });
    const sha = stdout.trim();
    return code === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export async function refreshTarget({ targetPath, categories = ["agents"], now = new Date().toISOString() }) {
  const repo = await repoContextFor(targetPath);
  const baseSha = repo.available === false ? null : await gitHeadSha(repo.path);
  const catalog = await loadDefaultCatalog();
  return refreshRepo({ repo, catalog, categories, now, baseSha });
}

// A6 exit-code precedence, mirroring distribute.exitCodeFor: 1 operational
// failure (incl. an unauditable target), else 20 when a human decision
// remains, else 10 when a clean update is pending, else 0.
export function refreshExitCodeFor(report) {
  if (report.status === "skipped") return 1;
  const items = report.categories.flatMap((c) => c.items);
  if (items.some((i) => i.raw.status === "failed")) return 1;
  if (items.some((i) => i.operation.action === "blocked" || i.operation.action === "needs_review")) return 20;
  if (items.some((i) => i.operation.action === "merge" || i.operation.action === "create")) return 10;
  return 0;
}
