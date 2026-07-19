import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  checkAllMatch,
  verifyAllMatch,
  writeSnapshotFile,
} from "./repoTemplateSnapshot.mjs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";

const GITIGNORE_PATH = ".gitignore";
// scripts/close/scan-complete.mjs writes a HEAD-bound marker at
// .agent/close-scan/complete.json (scripts/close/lib.mjs DEFAULT_MARKER_PATH).
// It is ephemeral close-state, never committed, so onboarded repos must ignore
// the whole directory or the marker shows up as committable junk (#253).
// Exported for the capability-manifest cross-check: test/capabilityManifest.test.mjs
// asserts the agent-lifecycle.baseline .gitignore merge install's appends[] equals
// [CLOSE_SCAN_IGNORE] so features.json cannot drift from the line this task writes.
export const CLOSE_SCAN_IGNORE = ".agent/close-scan/";
// Match the managed rule already present (with or without a leading slash or
// trailing slash) so re-runs detect it and stay no-ops. Mirrors the
// CLAUDE_DIR_IGNORE shape in writeFrictionLedger.mjs.
const CLOSE_SCAN_IGNORE_LINE = /^\/?\.agent\/close-scan\/?$/;

// The repo-template agent worktree-lifecycle and close-guard scripts (shipped
// upstream in repo-template and snapshotted under src/snapshots/repo-template).
// Exported for the capability-manifest cross-check: test/capabilityManifest.test.mjs
// asserts this equals the agent-lifecycle.baseline file-kind installs[] projection.
export const SCRIPT_FILES = [
  // start-task imports this verified copy/cleanup helper; install it before the
  // command shim so a partially applied baseline never leaves a broken import.
  "scripts/agent/carry.mjs",
  "scripts/agent/lib.mjs",
  "scripts/agent/start-task.mjs",
  "scripts/agent/status.mjs",
  "scripts/agent/prune.mjs",
  "scripts/agent/pr-body.mjs",
  // scripts/close/{scan-complete,ci-guard}.mjs `import ../pr-contract.mjs`, so the
  // dependency must be written BEFORE its importers or onboarded repos hit
  // ERR_MODULE_NOT_FOUND at close-scan runtime (issue #252).
  "scripts/pr-contract.mjs",
  "scripts/close/lib.mjs",
  "scripts/close/scan-complete.mjs",
  "scripts/close/ci-guard.mjs",
  // The strict closeout wrappers AGENTS.md mandates (`npm run agent:close-preflight`
  // / `npm run agent:pr-ready`). They `import ./pr-contract.mjs`, written above, so
  // the dependency resolves at runtime (same ordering rule as the close scripts,
  // #252). Without these the documented closeout path fails with "missing script"
  // in every onboarded repo (#282).
  "scripts/agent-close-preflight.mjs",
  "scripts/agent-pr-ready.mjs",
];

// The npm script entries this task idempotently merges into the target's
// package.json. Exported so the audit path can report them present/missing/
// drifted (the "entries" comparison) without re-deriving them.
export const AGENT_SCRIPTS = {
  "agent:status": "node scripts/agent/status.mjs",
  "agent:prune": "node scripts/agent/prune.mjs",
  "agent:start-task": "node scripts/agent/start-task.mjs",
  "agent:pr-body": "node scripts/agent/pr-body.mjs",
  "close:scan:complete": "node scripts/close/scan-complete.mjs",
  "close:ci:guard": "node scripts/close/ci-guard.mjs",
  "agent:close-preflight": "node scripts/agent-close-preflight.mjs",
  "agent:pr-ready": "node scripts/agent-pr-ready.mjs",
};

async function readTargetPackageJson(targetPath) {
  try {
    return JSON.parse(await readFile(safeJoin(targetPath, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

async function readGitignore(ctx) {
  // Tolerate a missing .gitignore: treat absent as empty so the managed block is
  // simply created (mirrors writeFrictionLedger.mjs readGitignore()).
  try {
    return await readFile(safeJoin(ctx.targetPath, GITIGNORE_PATH), "utf8");
  } catch {
    return "";
  }
}

function gitignoreHasCloseScanIgnore(body) {
  return String(body ?? "").split(/\r?\n/).some((line) => CLOSE_SCAN_IGNORE_LINE.test(line.trim()));
}

function ensureGitignoreCloseScanIgnore(body) {
  const original = String(body ?? "");
  // Already ignored — return the body untouched so the no-op path (and CRLF
  // files) stays byte-identical and re-runs don't rewrite line endings.
  if (gitignoreHasCloseScanIgnore(original)) return original;

  const trimmed = original.trimEnd();
  const prefix = trimmed ? `${trimmed}\n\n` : "";
  return `${prefix}# ArchonVII close-scan marker (ephemeral, never committed)\n${CLOSE_SCAN_IGNORE}\n`;
}

function entriesAlreadyMerged(pkg) {
  const scripts = pkg?.scripts || {};
  return Object.entries(AGENT_SCRIPTS).every(([k, v]) => scripts[k] === v);
}

export async function check(ctx) {
  // Content-aware: a present-but-drifted managed script re-opens the apply path
  // (#95), not just a missing one.
  if ((await checkAllMatch(ctx, SCRIPT_FILES)) === "needs-apply") return "needs-apply";
  const pkg = await readTargetPackageJson(ctx.targetPath);
  if (!pkg || !entriesAlreadyMerged(pkg)) return "needs-apply";
  // A partial state (scripts + entries present, but the close-scan ignore rule
  // missing) must re-apply so the marker stays ignored (#253).
  if (!gitignoreHasCloseScanIgnore(await readGitignore(ctx))) return "needs-apply";
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  for (const file of SCRIPT_FILES) {
    // overwrite:true so a drifted managed script is REPAIRED, not skipped (#95).
    results.push(await writeSnapshotFile(ctx, file, { overwrite: true }));
  }

  // Merge only the managed agent:* entries into the target package.json, creating a
  // minimal one if absent (DECISION A1: minimal { name, type, scripts } only),
  // and preserving every other key/script. Re-assigning the same values keeps
  // this idempotent — a re-run produces byte-identical output.
  const existing = await readTargetPackageJson(ctx.targetPath);
  const pkg = existing || {
    name: ctx.repo || (ctx.targetPath ? basename(ctx.targetPath) : "repo"),
    type: "module",
    scripts: {},
  };
  pkg.scripts = pkg.scripts || {};
  for (const [k, v] of Object.entries(AGENT_SCRIPTS)) pkg.scripts[k] = v;

  const pkgResult = await safeWriteFile(
    ctx.targetPath,
    "package.json",
    JSON.stringify(pkg, null, 2) + "\n",
    { overwrite: true }
  );
  recordCreatedFile(ctx, pkgResult, { path: "package.json", source: "merged:agent-lifecycle" });
  results.push(pkgResult);

  // Idempotently ignore the ephemeral close-scan marker dir. Skip the write when
  // unchanged so re-runs are no-ops and CRLF .gitignore files stay stable.
  const gitignoreBody = await readGitignore(ctx);
  const nextGitignore = ensureGitignoreCloseScanIgnore(gitignoreBody);
  const gitignoreResult = nextGitignore === gitignoreBody
    ? { status: "unchanged", path: safeJoin(ctx.targetPath, GITIGNORE_PATH) }
    : await safeWriteFile(ctx.targetPath, GITIGNORE_PATH, nextGitignore, { overwrite: true });
  recordCreatedFile(ctx, gitignoreResult, {
    path: GITIGNORE_PATH,
    source: "archon-setup:agent-lifecycle-close-scan-ignore",
  });
  results.push(gitignoreResult);

  return results;
}

export async function verify(ctx) {
  const filesOk = await verifyAllMatch(ctx, SCRIPT_FILES);
  if (!filesOk.ok) return filesOk;
  const pkg = await readTargetPackageJson(ctx.targetPath);
  if (!pkg || !entriesAlreadyMerged(pkg)) {
    return { ok: false, error: "package.json is missing the agent:* lifecycle scripts" };
  }
  if (!gitignoreHasCloseScanIgnore(await readGitignore(ctx))) {
    return { ok: false, error: `${GITIGNORE_PATH} is missing the ${CLOSE_SCAN_IGNORE} ignore rule` };
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/scripts/agent/ and ${ctx.targetPath}/scripts/close/, remove the managed agent:* and close:* entries from package.json, and drop the ${CLOSE_SCAN_IGNORE} rule from ${ctx.targetPath}/.gitignore to retry.`;
}
