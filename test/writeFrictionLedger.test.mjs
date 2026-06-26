import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

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

// git check-ignore: exit 0 = path is ignored, exit 1 = not ignored.
function gitIgnores(root, relPath) {
  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", relPath]);
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
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

test("writeFrictionLedger keeps the ledger trackable when .claude/ is already ignored (#234)", async () => {
  const root = await tempRoot();
  // Pre-existing repos may already exclude the whole .claude directory.
  await writeFile(join(root, ".gitignore"), ".claude/\nnode_modules/\n", "utf8");
  const taskCtx = ctx(root);

  assert.equal(await task.check(taskCtx), "needs-apply");
  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.claude\/\*$/m, "bare .claude/ should be converted to the glob form");
  assert.doesNotMatch(gitignore, /^\.claude\/$/m, "the shadowing bare .claude/ directory ignore must be gone");
  assert.match(gitignore, /^!\.claude\/friction\.md$/m);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });

  // Definitive check: git itself must not ignore the ledger (writeFrictionLedger
  // runs before initGitAndCommit, so a static rewrite is the only available fix).
  execFileSync("git", ["-C", root, "init", "-q"]);
  assert.equal(
    gitIgnores(root, ".claude/friction.md"),
    false,
    "friction.md must be trackable, not shadowed by the .claude directory ignore",
  );
});

test("writeFrictionLedger keeps the documented noticed.md / napkin.md ledgers trackable (#282)", async () => {
  const root = await tempRoot();
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);

  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^!\.claude\/noticed\.md$/m);
  assert.match(gitignore, /^!\.claude\/napkin\.md$/m);

  // AGENTS.md and the owner-maintenance hook treat these as append-log ledgers
  // agents write to directly, so `git add` must work without -f.
  execFileSync("git", ["-C", root, "init", "-q"]);
  for (const ledger of [".claude/friction.md", ".claude/noticed.md", ".claude/napkin.md"]) {
    assert.equal(gitIgnores(root, ledger), false, `${ledger} must be trackable, not ignored by .claude/*`);
  }
});
