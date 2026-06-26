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

// The repo-template agent worktree-lifecycle and close-guard scripts (shipped
// upstream in repo-template and snapshotted under src/snapshots/repo-template).
const SCRIPT_FILES = [
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

function entriesAlreadyMerged(pkg) {
  const scripts = pkg?.scripts || {};
  return Object.entries(AGENT_SCRIPTS).every(([k, v]) => scripts[k] === v);
}

export async function check(ctx) {
  // Content-aware: a present-but-drifted managed script re-opens the apply path
  // (#95), not just a missing one.
  if ((await checkAllMatch(ctx, SCRIPT_FILES)) === "needs-apply") return "needs-apply";
  const pkg = await readTargetPackageJson(ctx.targetPath);
  return pkg && entriesAlreadyMerged(pkg) ? "already-done" : "needs-apply";
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
  return results;
}

export async function verify(ctx) {
  const filesOk = await verifyAllMatch(ctx, SCRIPT_FILES);
  if (!filesOk.ok) return filesOk;
  const pkg = await readTargetPackageJson(ctx.targetPath);
  if (!pkg || !entriesAlreadyMerged(pkg)) {
    return { ok: false, error: "package.json is missing the agent:* lifecycle scripts" };
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/scripts/agent/ and ${ctx.targetPath}/scripts/close/, then remove the managed agent:* and close:* entries from package.json to retry.`;
}
