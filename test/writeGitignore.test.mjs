import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import * as task from "../src/server/tasks/writeGitignore.mjs";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "archon-gitignore-"));
}

// language "None" makes the fresh-repo branch skip the network template fetch
// (fetchGitignore("None") -> ""), so these tests are hermetic.
function ctx(targetPath, language = "None") {
  return {
    targetPath,
    taskOptions: { language },
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
  };
}

// git check-ignore: exit 0 = ignored, exit 1 = not ignored.
function gitIgnores(root, relPath) {
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", relPath]);
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

test("writeGitignore ignores generated .agent/current-task.json on a fresh repo (#282)", async () => {
  const root = await tempRoot();
  const taskCtx = ctx(root);

  assert.equal(await task.check(taskCtx), "needs-apply");
  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.agent\/current-task\.json$/m);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  assert.equal(await task.check(taskCtx), "already-done");

  // A fresh worktree after `npm run agent:start-task` must stay clean.
  execFileSync("git", ["-C", root, "init", "-q"]);
  assert.equal(gitIgnores(root, ".agent/current-task.json"), true, "current-task.json must be ignored");
  assert.equal(gitIgnores(root, "src/index.mjs"), false, "ordinary source files must not be ignored");
});

test("writeGitignore is idempotent — re-apply does not duplicate the managed rule", async () => {
  const root = await tempRoot();
  const taskCtx = ctx(root);

  await task.apply(taskCtx);
  assert.equal(await task.check(taskCtx), "already-done");
  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.equal((gitignore.match(/^\.agent\/current-task\.json$/gm) || []).length, 1);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
});

test("writeGitignore augments an existing .gitignore without refetching or clobbering it", async () => {
  const root = await tempRoot();
  // Default language is Node (network fetch), but an existing .gitignore must be
  // augmented in place without any fetch, so this stays hermetic.
  await writeFile(join(root, ".gitignore"), "node_modules/\ndist/\n", "utf8");
  const taskCtx = ctx(root, "Node");

  assert.equal(await task.check(taskCtx), "needs-apply");
  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^node_modules\/$/m, "existing rules preserved");
  assert.match(gitignore, /^dist\/$/m, "existing rules preserved");
  assert.match(gitignore, /^\.agent\/current-task\.json$/m, "managed runtime rule added");
});
