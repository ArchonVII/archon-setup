import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as task from "../src/server/tasks/writeAgentLifecycle.mjs";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "archon-agent-lifecycle-gitignore-"));
}

function ctx(targetPath) {
  return {
    targetPath,
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
  };
}

const CLOSE_SCAN_RULE = /^\.agent\/close-scan\/$/m;

test("writeAgentLifecycle ignores the close-scan marker dir (#253)", async () => {
  const root = await tempRoot();
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  const taskCtx = ctx(root);

  assert.equal(await task.check(taskCtx), "needs-apply");
  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, CLOSE_SCAN_RULE, "the .agent/close-scan/ rule must be appended");
  assert.match(gitignore, /^node_modules\/$/m, "existing rules must be preserved");
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  assert.ok(
    taskCtx.manifest.createdFiles.some((entry) => entry.path === ".gitignore"),
    "the gitignore write should be recorded in the manifest",
  );
});

test("writeAgentLifecycle appends the close-scan rule exactly once and is idempotent", async () => {
  const root = await tempRoot();
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);
  const afterFirst = await readFile(join(root, ".gitignore"), "utf8");
  assert.equal(
    (afterFirst.match(/^\.agent\/close-scan\/$/gm) || []).length,
    1,
    "the rule must appear exactly once after the first apply",
  );

  assert.equal(await task.check(taskCtx), "already-done");
  // Second apply must not duplicate the rule and must leave the file byte-identical.
  await task.apply(taskCtx);
  const afterSecond = await readFile(join(root, ".gitignore"), "utf8");
  assert.equal(
    (afterSecond.match(/^\.agent\/close-scan\/$/gm) || []).length,
    1,
    "re-applying must not duplicate the rule",
  );
  assert.equal(afterSecond, afterFirst, "re-applying must be a byte-identical no-op");
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
});

test("writeAgentLifecycle tolerates a missing .gitignore by creating one", async () => {
  const root = await tempRoot();
  const taskCtx = ctx(root);

  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, CLOSE_SCAN_RULE);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
});

test("writeAgentLifecycle treats an existing close-scan rule (variant form) as satisfied", async () => {
  const root = await tempRoot();
  // A repo that already ignores the dir without a trailing slash must stay a no-op.
  await writeFile(join(root, ".gitignore"), ".agent/close-scan\nnode_modules/\n", "utf8");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.doesNotMatch(gitignore, CLOSE_SCAN_RULE, "must not append a duplicate trailing-slash form");
  assert.match(gitignore, /^\.agent\/close-scan$/m, "the pre-existing variant rule must remain");
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
});

test("writeAgentLifecycle re-applies when scripts are installed but the close-scan rule is missing", async () => {
  const root = await tempRoot();
  const taskCtx = ctx(root);

  // First apply installs scripts + entries and the ignore rule.
  await task.apply(taskCtx);

  // Simulate a partial state: drop the close-scan rule but keep everything else.
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  await writeFile(
    join(root, ".gitignore"),
    gitignore.replace(/^\.agent\/close-scan\/$\r?\n?/m, ""),
    "utf8",
  );

  assert.equal(
    await task.check(taskCtx),
    "needs-apply",
    "a partial state (missing close-scan rule) must re-open the apply path",
  );

  await task.apply(taskCtx);
  const repaired = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(repaired, CLOSE_SCAN_RULE);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
});
