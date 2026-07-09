import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultLocalSelection, runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { loadRegistry } from "../src/server/planner/buildPlan.mjs";

const execFileP = promisify(execFile);

async function tempRoot(prefix = "archon-onboard-clean-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function defaultFeaturesWith(...ids) {
  const { features } = await loadRegistry();
  return [...new Set([...defaultLocalSelection(features), ...ids])];
}

// Hermetic license/gitignore fetch stub (mirrors onboardHeadless.test.mjs).
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

async function gitStatusPorcelain(root) {
  const { stdout } = await execFileP("git", ["-C", root, "status", "--porcelain"]);
  return stdout.trim();
}

async function trackedAtHead(root, relPath) {
  try {
    await execFileP("git", ["-C", root, "cat-file", "-e", `HEAD:${relPath}`]);
    return true;
  } catch {
    return false;
  }
}

// #289: on a fresh onboard, the setup manifest (and CODEOWNERS, when an owner is
// known) is written by tasks that run after initGitAndCommit, so they miss the
// bootstrap commit. The bootstrap also activates the main-protection githooks,
// which then refuse an ordinary commit of that provenance, leaving every fresh
// repo dirty. A fresh onboard must end with a clean working tree and the
// provenance committed.
test("a fresh onboard ends with a clean working tree (provenance committed) (#289)", async () => {
  const root = await tempRoot();

  const result = await withFetchStub(() =>
    withGitIdentity(async () =>
      runOnboard({
        targetPath: root,
        owner: "ArchonVII",
        repo: "example",
        features: await defaultFeaturesWith("foundation.codeowners"),
      })
    )
  );
  assert.equal(result.ok, true, "onboard should succeed");

  const status = await gitStatusPorcelain(root);
  assert.equal(status, "", `working tree should be clean after onboard; dirty:\n${status}`);

  // The provenance manifest must be committed, not just present on disk.
  assert.equal(
    await trackedAtHead(root, ".github/archon-setup.json"),
    true,
    "the setup manifest must be committed"
  );
  assert.equal(
    await trackedAtHead(root, ".github/CODEOWNERS"),
    true,
    "CODEOWNERS must be committed when an owner is known"
  );
});

// The runtime event log and bypass audit log are generated agent state and must
// never re-dirty a freshly-onboarded repo (#289).
test("a fresh onboard ignores generated agent runtime state (#289)", async () => {
  const root = await tempRoot();

  await withFetchStub(() =>
    withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
  );

  for (const ignored of [".archon/events.jsonl", ".agent/bypass.log"]) {
    const { stdout } = await execFileP("git", ["-C", root, "check-ignore", ignored]).catch((err) => {
      if (err.code === 1) return { stdout: "" };
      throw err;
    });
    assert.equal(stdout.trim(), ignored, `${ignored} must be gitignored in the onboarded repo`);
  }
});
