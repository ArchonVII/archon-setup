import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  checkAllExist,
  verifyAllExist,
  writeSnapshotFile,
} from "./repoTemplateSnapshot.mjs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";

// The repo-template agent worktree-lifecycle scripts (shipped upstream in
// repo-template; snapshotted under src/snapshots/repo-template/scripts/agent/).
const SCRIPT_FILES = [
  "scripts/agent/lib.mjs",
  "scripts/agent/start-task.mjs",
  "scripts/agent/status.mjs",
  "scripts/agent/prune.mjs",
];

// The 3 npm script entries this task idempotently merges into the target's
// package.json. Exported so the audit path can report them present/missing/
// drifted (the "entries" comparison) without re-deriving them.
export const AGENT_SCRIPTS = {
  "agent:status": "node scripts/agent/status.mjs",
  "agent:prune": "node scripts/agent/prune.mjs",
  "agent:start-task": "node scripts/agent/start-task.mjs",
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
  if ((await checkAllExist(ctx, SCRIPT_FILES)) === "needs-apply") return "needs-apply";
  const pkg = await readTargetPackageJson(ctx.targetPath);
  return pkg && entriesAlreadyMerged(pkg) ? "already-done" : "needs-apply";
}

export async function apply(ctx) {
  const results = [];
  for (const file of SCRIPT_FILES) {
    results.push(await writeSnapshotFile(ctx, file));
  }

  // Merge only the 3 agent:* entries into the target package.json, creating a
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
  const filesOk = await verifyAllExist(ctx, SCRIPT_FILES);
  if (!filesOk.ok) return filesOk;
  const pkg = await readTargetPackageJson(ctx.targetPath);
  if (!pkg || !entriesAlreadyMerged(pkg)) {
    return { ok: false, error: "package.json is missing the agent:* lifecycle scripts" };
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/scripts/agent/ and remove the agent:* entries from package.json to retry.`;
}
