import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { HOOK_FILES } from "../src/server/tasks/writeGithooks.mjs";

const execFileP = promisify(execFile);

async function tempRoot(prefix = "archon-onboard-execbit-") {
  return mkdtemp(join(tmpdir(), prefix));
}

// Hermetic license/gitignore fetch stub (mirrors onboardProvenanceClean.test.mjs).
async function withFetchStub(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    async json() {
      if (String(url).includes("/licenses/")) return { body: "Existing License\n" };
      return { source: "node_modules/\n" };
    },
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withGitIdentity(fn) {
  const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GIT_AUTHOR_NAME = "Archon Onboard Test";
  process.env.GIT_AUTHOR_EMAIL = "archon-onboard-test@example.invalid";
  process.env.GIT_COMMITTER_NAME = "Archon Onboard Test";
  process.env.GIT_COMMITTER_EMAIL = "archon-onboard-test@example.invalid";
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

// #317: writeGithooks chmods 0o755 on DISK, but on Windows (core.filemode=false)
// `git add` records new files as 100644 — so a Unix clone of a Windows-onboarded
// repo gets non-executable commit-msg/pre-commit guards that git silently skips.
// The bootstrap commit must record the hooks as 100755 in the COMMITTED tree,
// regardless of host filemode support.
test("a fresh onboard commits every hook entrypoint at mode 100755 (#317)", async () => {
  const root = await tempRoot();

  // Simulate a filemode-less host (the Windows default) on every platform so
  // this regression bites on Linux/macOS CI too: with core.filemode=false,
  // `git add` records new files as 100644 regardless of the on-disk mode, so
  // only the explicit update-index --chmod=+x staging can yield 100755.
  // initGitAndCommit reuses an existing repo without re-init, so this local
  // config survives the onboard (src/server/tasks/initGitAndCommit.mjs apply()).
  await execFileP("git", ["init", "-b", "main", root]);
  await execFileP("git", ["-C", root, "config", "core.filemode", "false"]);

  const result = await withFetchStub(() =>
    withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
  );
  assert.equal(result.ok, true, "onboard should succeed");

  const { stdout } = await execFileP("git", ["-C", root, "ls-files", "-s", "--", ".githooks"]);
  const modeByPath = new Map(
    stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [mode, , , ...pathParts] = line.split(/\s+/);
        return [pathParts.join(" "), mode];
      })
  );

  for (const file of HOOK_FILES) {
    assert.equal(
      modeByPath.get(file),
      "100755",
      `${file} must be committed executable (got ${modeByPath.get(file) || "untracked"})`
    );
  }
});

// Simulate a filemode-less host via environment config instead of repo config.
// GIT_CONFIG_COUNT / GIT_CONFIG_KEY_0 / GIT_CONFIG_VALUE_0 behave exactly like
// `git -c core.filemode=false` (git-config(1), "Environment"), which is
// command-scope config — the HIGHEST precedence level — so it outranks the
// core.filemode=true that a fresh `git init` auto-detects into .git/config on
// Unix. Repo-local pre-config (the test above) cannot be used here because the
// whole point is that no repo exists before the onboard runs. Every git the
// onboard spawns inherits process.env (commandRunner spawns with
// { ...process.env, ...env }), as do this test's own git probes.
async function withFilemodelessEnv(fn) {
  const keys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "core.filemode";
  process.env.GIT_CONFIG_VALUE_0 = "false";
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

// #317 mutation guard (added in the #294 review round): the pre-init test
// above no longer isolates initGitAndCommit's staging call — since #294,
// writeGithooks.apply() also stages exec bits whenever `.git` already exists
// at hook-write time, so deleting `await stageHookExecBits(cwd)` from
// initGitAndCommit.apply() still passes that test (index mode is sticky
// through the later `git add --all`). This variant starts with NO `.git` at
// all: writeGithooks.apply() runs before any repo exists and skips staging,
// so the bootstrap commit's own staging call is the only possible source of
// 100755 — removing it turns every hook 100644 and fails this test.
test("a truly-fresh onboard (no .git until bootstrap) commits hooks at 100755 (#317)", async () => {
  const root = await tempRoot();

  await withFilemodelessEnv(async () => {
    const result = await withFetchStub(() =>
      withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
    );
    assert.equal(result.ok, true, "onboard should succeed");

    // Sanity: the env-level filemode simulation must actually resolve inside
    // the onboarded repo, otherwise on real-filemode hosts (Linux CI) plain
    // `git add` would record the on-disk 0o755 and this test could not
    // distinguish bootstrap staging from disk-mode pickup.
    const { stdout: filemode } = await execFileP("git", ["-C", root, "config", "core.filemode"]);
    assert.equal(filemode.trim(), "false", "GIT_CONFIG_* env must override the repo-local core.filemode");
  });

  const { stdout } = await execFileP("git", ["-C", root, "ls-files", "-s", "--", ".githooks"]);
  const modeByPath = new Map(
    stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [mode, , , ...pathParts] = line.split(/\s+/);
        return [pathParts.join(" "), mode];
      })
  );

  for (const file of HOOK_FILES) {
    assert.equal(
      modeByPath.get(file),
      "100755",
      `${file} must be committed executable (got ${modeByPath.get(file) || "untracked"})`
    );
  }
});
