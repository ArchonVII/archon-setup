import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as task from "../src/server/tasks/writeFrictionLedger.mjs";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "archon-friction-ledger-"));
}

function ctx(targetPath) {
  return {
    targetPath,
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
  };
}

test("writeFrictionLedger seeds the ledger and gitignore exception", async () => {
  const root = await tempRoot();
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  const taskCtx = ctx(root);

  assert.equal(await task.check(taskCtx), "needs-apply");
  await task.apply(taskCtx);

  const ledger = await readFile(join(root, ".claude", "friction.md"), "utf8");
  assert.match(ledger, /^\| date \| category \| what happened \| cost \| suggested fix \|/m);
  assert.match(ledger, /tooling \| docs \| skill \| hook \| ci \| env/);
  assert.match(ledger, /rerun \| blocked \| context-burn \| none/);
  assert.doesNotMatch(ledger, /PowerShell double-quoted here-string/);
  assert.equal(
    ledger.split(/\r?\n/).filter((line) => line.trim().startsWith("|")).length,
    2,
    "generated repos should receive only the seed table, not provider ledger entries",
  );

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.claude\/\*$/m);
  assert.match(gitignore, /^!\.claude\/friction\.md$/m);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  assert.deepEqual(taskCtx.manifest.createdFiles.map((entry) => entry.path), [
    ".claude/friction.md",
    ".gitignore",
  ]);
});

test("writeFrictionLedger is idempotent after apply", async () => {
  const root = await tempRoot();
  const taskCtx = ctx(root);

  await task.apply(taskCtx);
  assert.equal(await task.check(taskCtx), "already-done");
  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.equal((gitignore.match(/^!\.claude\/friction\.md$/gm) || []).length, 1);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
});
