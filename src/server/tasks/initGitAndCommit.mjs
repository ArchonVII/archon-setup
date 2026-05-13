import { runCommand } from "../lib/commandRunner.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

async function isGitRepo(path) {
  try {
    await access(join(path, ".git"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function hasCommits(path) {
  const { code } = await runCommand("git", ["-C", path, "rev-parse", "HEAD"], { timeoutMs: 5000 });
  return code === 0;
}

export async function check(ctx) {
  if (await isGitRepo(ctx.targetPath)) {
    if (await hasCommits(ctx.targetPath)) return "already-done";
  }
  return "needs-apply";
}

export async function apply(ctx) {
  const cwd = ctx.targetPath;
  if (!(await isGitRepo(cwd))) {
    const init = await runCommand("git", ["-C", cwd, "init", "-b", "main"], { timeoutMs: 10_000 });
    if (init.code !== 0) throw new Error(`git init failed: ${init.stderr}`);
  }
  const add = await runCommand("git", ["-C", cwd, "add", "--all"], { timeoutMs: 10_000 });
  if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);
  const commit = await runCommand(
    "git",
    ["-C", cwd, "commit", "-m", "chore: initial commit via archon-setup"],
    { timeoutMs: 15_000 }
  );
  if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
  return { result: "committed" };
}

export async function verify(ctx) {
  return { ok: await hasCommits(ctx.targetPath) };
}

export function rollbackHint(ctx) {
  return `If this failed mid-way, inspect ${ctx.targetPath}/.git. Re-running is safe — already-committed state is detected.`;
}
