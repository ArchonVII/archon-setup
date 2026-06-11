import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { primaryRootFromCommonDir } from "../scripts/agent/lib.mjs";
import { sweepRepo } from "../scripts/doc-sweep/sweep.mjs";
import { acquireLock } from "../scripts/doc-sweep/git.mjs";

// #197 review regressions: the root lifecycle scripts and their repo-template
// snapshot twins must stay byte-identical (the onboard audit compares exactly),
// and the specific failure shapes the review caught must stay fixed.

const ROOT = process.cwd();
const SNAP = join(ROOT, "src", "snapshots", "repo-template");
const STATUS_BIN = join(ROOT, "scripts", "agent", "status.mjs");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function normalized(text) {
  return text.replace(/\r\n/g, "\n");
}

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "archon-lifecycle-scripts-"));
  await writeFile(join(root, "README.md"), "# Fixture\n", "utf8");
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "agent@example.test"]);
  git(root, ["config", "user.name", "Archon Agent"]);
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "chore: seed fixture"]);
  return root;
}

test("root lifecycle scripts stay byte-identical to their repo-template snapshot twins", async () => {
  const pairs = [
    ".agent/startup-baseline.json",
    "scripts/agent/lib.mjs",
    "scripts/agent/status.mjs",
    "scripts/agent/prune.mjs",
    "scripts/agent/start-task.mjs",
    "scripts/agent/pr-body.mjs",
    "scripts/doc-sweep/lib.mjs",
    "scripts/doc-sweep/git.mjs",
    "scripts/doc-sweep/sweep.mjs",
  ];
  for (const rel of pairs) {
    const rootBody = normalized(await readFile(join(ROOT, rel), "utf8"));
    const snapBody = normalized(await readFile(join(SNAP, rel), "utf8"));
    assert.equal(rootBody, snapBody, `${rel} must match the snapshot (fix both in lockstep)`);
  }
});

test("startup baseline requires the pr-body lifecycle script", async () => {
  const baseline = JSON.parse(await readFile(join(ROOT, ".agent", "startup-baseline.json"), "utf8"));
  assert.ok(baseline.required.includes("scripts/agent/pr-body.mjs"));
});

test("primaryRootFromCommonDir strips the .git suffix for forward- and backslash paths", () => {
  assert.equal(primaryRootFromCommonDir("C:/GitHub/repo/.git"), "C:/GitHub/repo");
  assert.equal(primaryRootFromCommonDir("C:\\GitHub\\repo\\.git"), "C:\\GitHub\\repo");
  assert.equal(primaryRootFromCommonDir("/home/user/repo/.git"), "/home/user/repo");
});

test("agent:status detects claims via the coordination claims directory", async () => {
  const repo = await makeRepo();

  const before = spawnSync(process.execPath, [STATUS_BIN], { cwd: repo, encoding: "utf8" });
  assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /Claims:\s+not installed/);

  await mkdir(join(repo, ".agent", "coordination", "claims"), { recursive: true });
  await writeFile(
    join(repo, ".agent", "coordination", "claims", "claim-1.json"),
    JSON.stringify({ repo: "fixture", worktree: "main", paths: ["docs/**"], status: "active" }),
    "utf8",
  );

  const after = spawnSync(process.execPath, [STATUS_BIN], { cwd: repo, encoding: "utf8" });
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.stdout, /Claims:\s+installed/);
});

test("doc-sweep lock-held early return strips the internal captured field", async () => {
  const repo = await makeRepo();
  const docPath = join(repo, "docs", "stray-notes.md");
  await mkdir(join(repo, "docs"), { recursive: true });
  await writeFile(docPath, "# Stray notes from a prior session\n", "utf8");
  // Backdate past the 12h primary-default staleness gate (doc-sweep lib STALE_MS).
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await utimes(docPath, dayAgo, dayAgo);

  const lock = acquireLock(repo);
  assert.equal(lock.acquired, true, "fixture must hold the sweep lock");

  const buckets = await sweepRepo(repo, { now: Date.now(), apply: true, owner: true });

  assert.equal(buckets.eligible.length, 1);
  assert.equal(buckets.eligible[0].path, "docs/stray-notes.md");
  assert.equal(
    Object.hasOwn(buckets.eligible[0], "captured"),
    false,
    "lock-held early return must not leak TOCTOU metadata",
  );
});
