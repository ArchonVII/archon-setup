import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOriginRemote } from "../src/server/preflight/checkOriginRemote.mjs";

const execFileP = promisify(execFile);
const tmp = (p = "archon-origin-") => mkdtemp(join(tmpdir(), p));

test("non-git directory -> { originDetected: null }, no throw", async () => {
  const root = await tmp();
  assert.deepEqual(await checkOriginRemote(root), { originDetected: null });
});

test("git repo with no origin -> null, no throw", async () => {
  const root = await tmp();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  assert.deepEqual(await checkOriginRemote(root), { originDetected: null });
});

test("git repo with a github origin -> detected owner/repo", async () => {
  const root = await tmp();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "remote", "add", "origin", "git@github.com:ArchonVII/example.git"]);
  assert.deepEqual(await checkOriginRemote(root), { originDetected: { owner: "ArchonVII", repo: "example" } });
});
