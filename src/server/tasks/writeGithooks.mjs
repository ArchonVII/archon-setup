import { access, chmod, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { runCommand } from "../lib/commandRunner.mjs";

// Exported for initGitAndCommit (#317): the bootstrap commit must stage these
// with the executable bit set, because on Windows (core.filemode=false) `git
// add` records new hook files as 100644 and a Unix clone then silently skips
// the guards.
export const HOOK_FILES = [
  ".githooks/commit-msg",
  ".githooks/pre-commit",
  ".githooks/scripts/install-githooks.sh",
  ".githooks/scripts/owner-maintenance.sh",
  ".githooks/scripts/test-owner-maintenance.sh",
  ".githooks/scripts/checkout-role.sh",
  ".githooks/scripts/checkout-doctor.sh",
  ".githooks/scripts/test-checkout-role.sh",
];
const FILES = HOOK_FILES;

// #317: on Windows (core.filemode=false) `git add` records new hook files as
// 100644, so a Unix clone of a Windows-onboarded repo gets non-executable
// commit-msg/pre-commit guards that git silently skips. Stage the executable
// bit explicitly for every hook entrypoint that exists — cross-platform,
// idempotent on Unix (apply() already chmods 0o755 on disk). Single shared
// implementation for both onboarding paths so they cannot drift: the fresh
// bootstrap commit (initGitAndCommit, #317) and hook-write time on existing
// repos (apply() below, #294).
export async function stageHookExecBits(cwd) {
  const present = [];
  for (const file of HOOK_FILES) {
    try {
      await access(join(cwd, file), constants.F_OK);
      present.push(file);
    } catch {
      // Hook feature not selected for this onboard — nothing to stage.
    }
  }
  if (present.length === 0) return;
  const res = await runCommand(
    "git",
    ["-C", cwd, "update-index", "--add", "--chmod=+x", "--", ...present],
    { timeoutMs: 10_000 }
  );
  if (res.code !== 0) throw new Error(`git update-index --chmod=+x failed: ${res.stderr}`);
}

export function scrubHookBody(body) {
  return body
    .replace(/\s*\(F18, ArchonVII\/repo-template#16\)/g, "")
    .replace(/\s*\(F18, repo-template#16\)/g, "")
    .replace(/\s*\(F18\)/g, "")
    .replace(/See \.githooks\/(commit-msg|pre-commit) \(F18, repo-template#16\) for the rule source\./g, "See .githooks/$1 for the rule source.")
    .replace(/# Authority: Layer 5 in docs\/phase2\/hook-authority\.md\.\n/g, "")
    .replace(/# baselines \(F18\) run/g, "# baselines run")
    // F19 worktree guard: strip repo-template-internal refs from generated
    // repos. User-facing hook text references AGENTS.md (ships everywhere), so
    // nothing user-visible is lost.
    .replace(/# Authority: docs\/adr\/001-primary-checkout-worktree-policy\.md \(F19\)\.\n/g, "")
    .replace(/# Authority: docs\/adr\/001-primary-checkout-worktree-policy\.md[^\n]*\n/g, "")
    .replace(/ \(ADR-001\)/g, "")
    .replace(/ \(F19\)/g, "")
    // test-checkout-role.sh cross-references the F18 guard by name in a comment;
    // strip the parenthetical so the generated script stays clean.
    .replace(/ \(existing F18\)/g, "");
}

export async function check(ctx) {
  const exists = await checkAllExist(ctx, FILES);
  if (exists !== "already-done") return exists;
  if (!(await allExecutable(ctx))) return "needs-apply";
  // #294: the disk-mode probe above is a no-op on win32 and blind to the git
  // index everywhere. A hook tracked at 100644 — the residue a plain `git add`
  // leaves under core.filemode=false — must report needs-apply so a
  // re-onboard/update run repairs the staged mode instead of skipping.
  if (await firstBadStagedMode(ctx)) return "needs-apply";
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  for (const file of FILES) {
    results.push(await writeSnapshotFile(ctx, file, { transform: scrubHookBody }));
    await chmod(safeJoin(ctx.targetPath, file), 0o755);
  }
  // #294: when the target is already a git repo, stage the exec bits now —
  // index mode is sticky under core.filemode=false, so the onboarding agent's
  // later plain `git add` + commit preserves 100755. Staging only: onboarding
  // never auto-commits on a user's existing history. Fresh onboards skip
  // (writeGithooks runs before initGitAndCommit, so no .git exists yet); the
  // bootstrap commit path stages via the same helper (#317).
  if (await isGitRepo(ctx.targetPath)) {
    await stageHookExecBits(ctx.targetPath);
  }
  return results;
}

export async function verify(ctx) {
  const exists = await verifyAllExist(ctx, FILES);
  if (!exists.ok) return exists;
  const nonExecutable = await firstNonExecutable(ctx);
  if (nonExecutable) return { ok: false, error: `${nonExecutable} is not executable` };
  // #294: honest exec-bit verification on filemode-less hosts — when the
  // target is a git repo, inspect the staged mode of tracked hooks, not just
  // the disk mode (which win32 cannot represent and firstNonExecutable skips).
  const badStaged = await firstBadStagedMode(ctx);
  if (badStaged) return { ok: false, error: `${badStaged} is tracked non-executable (index mode 100644)` };
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.githooks to retry.`;
}

async function allExecutable(ctx) {
  return !(await firstNonExecutable(ctx));
}

async function firstNonExecutable(ctx) {
  if (process.platform === "win32") return null;
  for (const file of FILES) {
    const mode = (await stat(safeJoin(ctx.targetPath, file))).mode;
    if ((mode & 0o111) === 0) return file;
  }
  return null;
}

async function isGitRepo(path) {
  try {
    await access(join(path, ".git"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// First hook file tracked in the git index at mode 100644, or null. Only a
// regular file at 100644 counts as drift (symlinks and other modes are left
// alone), and untracked hooks are not flagged here — existence is checked
// separately and apply() stages them. Returns null when the target is not a
// git repo or git cannot answer, preserving pre-#294 behavior for non-repo
// targets; the loud failure path lives in stageHookExecBits.
async function firstBadStagedMode(ctx) {
  if (!(await isGitRepo(ctx.targetPath))) return null;
  const res = await runCommand(
    "git",
    ["-C", ctx.targetPath, "ls-files", "-s", "--", ...FILES],
    { timeoutMs: 10_000 }
  );
  if (res.code !== 0) return null;
  for (const line of res.stdout.split(/\r?\n/)) {
    // `git ls-files -s` line: <mode> SP <sha> SP <stage> TAB <path>
    const match = /^(\d{6}) \S+ \d+\t(.+)$/.exec(line);
    if (match && match[1] === "100644") return match[2];
  }
  return null;
}
