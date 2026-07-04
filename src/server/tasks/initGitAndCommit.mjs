import { runCommand } from "../lib/commandRunner.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { stageHookExecBits } from "./writeGithooks.mjs";

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

async function currentHooksPath(path) {
  const { code, stdout } = await runCommand("git", ["-C", path, "config", "--get", "core.hooksPath"], { timeoutMs: 5000 });
  if (code !== 0) return "";
  return stdout.trim();
}

async function activateHooksPath(path, { allowOverwrite = false } = {}) {
  const existing = await currentHooksPath(path);
  const normalized = existing.replace(/\\/g, "/");
  if (normalized === ".githooks") return { status: "already-set", hooksPath: ".githooks" };
  if (existing && !allowOverwrite) {
    return { status: "preserved", hooksPath: existing };
  }
  const config = await runCommand("git", ["-C", path, "config", "core.hooksPath", ".githooks"], { timeoutMs: 5000 });
  if (config.code !== 0) throw new Error(`git config core.hooksPath failed: ${config.stderr}`);
  return { status: existing ? "overwrote" : "configured", hooksPath: ".githooks" };
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
  // #317: stage hook exec bits before the bootstrap commit so filemode-less
  // hosts (Windows, core.filemode=false) commit them at 100755. Shared helper
  // in writeGithooks.mjs — the existing-repo path (#294) stages there too.
  await stageHookExecBits(cwd);
  const commit = await runCommand(
    "git",
    ["-C", cwd, "commit", "-m", "chore: initial commit via archon-setup"],
    { timeoutMs: 15_000 }
  );
  if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
  const hooksPath = await activateHooksPath(cwd, {
    allowOverwrite: ctx.taskOptions?.overwriteHooksPath === true || ctx.allowHooksPathOverwrite === true,
  });
  return { result: "committed", hooksPath };
}

export async function verify(ctx) {
  return { ok: await hasCommits(ctx.targetPath) };
}

export function rollbackHint(ctx) {
  return `If this failed mid-way, inspect ${ctx.targetPath}/.git. Re-running is safe — already-committed state is detected.`;
}
