import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { repoContextFor } from "../src/distributor/distribute.mjs";

// CLI surface (design §9): `archon-setup distribute` defaults to dry-run,
// resolves the target repo's branch/dirty state itself, and exits with the
// stable A6 code map so automation can branch on it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "archon-setup.mjs");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(repoPath, ...args) {
  const result = spawnSync("git", ["-C", repoPath, ...args], { env: GIT_ENV, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function makeGitRepo(agentsBody) {
  const path = await mkdtemp(join(tmpdir(), "archon-cli-"));
  git(path, "init");
  git(path, "checkout", "-b", "agent/test/1-cli");
  await writeFile(join(path, "AGENTS.md"), agentsBody, "utf8");
  git(path, "add", "AGENTS.md");
  git(path, "commit", "-m", "chore: fixture");
  return path;
}

test("repoContextFor reports branch and dirty state from git", async () => {
  const path = await makeGitRepo("# Agents\n");

  const clean = await repoContextFor(path);
  assert.equal(clean.branch, "agent/test/1-cli");
  assert.equal(clean.dirty, false);
  assert.ok(clean.name.length > 0);

  await writeFile(join(path, "untracked.txt"), "x\n", "utf8");
  const dirty = await repoContextFor(path);
  assert.equal(dirty.dirty, true);
});

test("distribute --target dry-run reports pending AGENTS adoptions and exits 20", async () => {
  const path = await makeGitRepo("# Agents\n\nLocal content only.\n");
  const logPath = join(await mkdtemp(join(tmpdir(), "archon-cli-log-")), "log.jsonl");

  const result = spawnSync(
    process.execPath,
    [BIN, "distribute", "--target", path, "--group", "agents", "--log", logPath, "--json"],
    { env: GIT_ENV, encoding: "utf8" },
  );

  // Real globalUpdates catalog: every block is missing → adoption_needed → 20.
  assert.equal(result.status, 20, result.stderr);
  const run = JSON.parse(result.stdout);
  assert.equal(run.mode, "dry-run");
  assert.ok(run.counts.adoptionNeeded >= 1);
  // Dry run wrote nothing.
  assert.equal(git(path, "status", "--porcelain").trim(), "");
});

test("distribute --help prints usage and exits 0", () => {
  const result = spawnSync(process.execPath, [BIN, "distribute", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /archon-setup distribute/);
  assert.match(result.stdout, /--apply/);
  assert.match(result.stdout, /--write-preview/);
});
