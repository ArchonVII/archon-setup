import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { readFile } from "node:fs/promises";

// Generated agent runtime state that must never be committed. repo-template's
// own .gitignore carries these, but an onboarded repo builds .gitignore from a
// stock GitHub language template (below), so the rules are appended here
// instead. `.agent/current-task.json` is written per-worktree by
// `npm run agent:start-task`; without this rule a fresh worktree is immediately
// dirty with untracked runtime state, conflicting with the clean-worktree
// delivery workflow (#282).
const ARCHON_GITIGNORE_BLOCK_HEADER = "# ArchonVII agent runtime state (generated; never committed)";
const ARCHON_GITIGNORE_LINES = [".agent/current-task.json"];

function escapeForLineMatch(line) {
  return line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasLine(body, line) {
  return new RegExp(`^${escapeForLineMatch(line)}$`, "m").test(String(body ?? ""));
}

function hasArchonRuntimeBlock(body) {
  return ARCHON_GITIGNORE_LINES.every((line) => hasLine(body, line));
}

// Idempotently append only the missing managed lines. Re-running produces
// byte-identical output, and an existing .gitignore (template or hand-written)
// is preserved — we only add the rules git needs to keep runtime state out.
function ensureArchonRuntimeBlock(body) {
  const original = String(body ?? "");
  const missing = ARCHON_GITIGNORE_LINES.filter((line) => !hasLine(original, line));
  if (!missing.length) return original;
  const trimmed = original.replace(/\s+$/, "");
  const prefix = trimmed ? `${trimmed}\n\n` : "";
  return `${prefix}${ARCHON_GITIGNORE_BLOCK_HEADER}\n${missing.join("\n")}\n`;
}

// Test-only fixture seam, mirroring the commandRunner ARCHON_GH_BIN seam
// (archon-setup#43 / #153). When ARCHON_GITIGNORE_BODY_JSON is set to a JSON
// object mapping template name (e.g. "Node", "Python") -> body, a matching
// entry short-circuits the real network fetch so the "hermetic / no network"
// smoke tests are truly network-free (the unauthenticated api.github.com path
// is 403-flaky under the 60/hr rate limit). Pure no-op when the env var is
// absent or has no entry for `lang`, so production keeps hitting GitHub.
function fixtureGitignore(lang) {
  const raw = process.env.ARCHON_GITIGNORE_BODY_JSON;
  if (!raw) return undefined;
  let map;
  try {
    map = JSON.parse(raw);
  } catch {
    throw new Error("ARCHON_GITIGNORE_BODY_JSON must be a JSON object of template -> body");
  }
  return map?.[lang];
}

async function fetchGitignore(lang) {
  if (lang === "None") return "";
  const fixture = fixtureGitignore(lang);
  if (fixture !== undefined) return fixture;
  const res = await fetch(`https://api.github.com/gitignore/templates/${lang}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`api.github.com/gitignore/templates/${lang} -> ${res.status}`);
  const json = await res.json();
  return json.source;
}

async function readExistingGitignore(ctx) {
  try {
    return await readFile(safeJoin(ctx.targetPath, ".gitignore"), "utf8");
  } catch {
    return null;
  }
}

export async function check(ctx) {
  const body = await readExistingGitignore(ctx);
  // Missing file, or present without the managed runtime-state rules, re-opens
  // the apply path so an existing repo gains the rules on the next run.
  if (body === null) return "needs-apply";
  return hasArchonRuntimeBlock(body) ? "already-done" : "needs-apply";
}

export async function apply(ctx) {
  const lang = ctx.taskOptions?.language || "Node";
  const existing = await readExistingGitignore(ctx);

  let baseBody;
  let source;
  if (existing === null) {
    // Fresh repo: seed from the stock GitHub language template, then layer the
    // ArchonVII runtime-state rules on top.
    if (lang === "Both") {
      const [node, py] = await Promise.all([fetchGitignore("Node"), fetchGitignore("Python")]);
      baseBody = `# Node\n${node}\n\n# Python\n${py}\n`;
    } else {
      baseBody = await fetchGitignore(lang);
    }
    source = `github:gitignore/${lang}`;
  } else {
    // Existing .gitignore: never re-fetch (that would clobber repo-local edits);
    // only ensure the managed runtime-state rules are present.
    baseBody = existing;
    source = "archon-setup:agent-runtime-gitignore";
  }

  const body = ensureArchonRuntimeBlock(baseBody);
  // No-op when an existing .gitignore already carries the managed rules.
  const res = existing !== null && body === existing
    ? { status: "unchanged", path: safeJoin(ctx.targetPath, ".gitignore") }
    : await safeWriteFile(ctx.targetPath, ".gitignore", body, { overwrite: true });
  // Only a freshly created .gitignore is a "created" file; augmenting an
  // existing one (overwrote) must not be reported as created (manifest accuracy).
  if (res.status === "created") {
    recordCreatedFile(ctx, res, { path: ".gitignore", source });
  }
  return res;
}

export async function verify(ctx) {
  const body = await readExistingGitignore(ctx);
  if (body === null) return { ok: false, error: ".gitignore is missing" };
  if (!hasArchonRuntimeBlock(body)) {
    return { ok: false, error: ".gitignore is missing the ArchonVII agent runtime-state ignore rules" };
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.gitignore to retry.`;
}
