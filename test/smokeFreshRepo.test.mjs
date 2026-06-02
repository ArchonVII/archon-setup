import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_GH = join(__dirname, "mocks", "fake-gh.mjs");

// Bare-repo naming the mock uses: <owner>__<repo>.git under the remote dir.
function bareRepoPath(remoteDir, owner, repo) {
  return join(remoteDir, `${owner}__${repo}.git`);
}

// Run the body with the gh-mock seam wired in, restoring env afterwards.
async function withMockGh(remoteDir, fn) {
  const keys = [
    "ARCHON_GH_BIN",
    "ARCHON_GH_ARGS_PREFIX_JSON",
    "ARCHON_FAKE_GH_REMOTE_DIR",
    // CI runners have no global git identity, and the wizard commits into a
    // fresh temp repo (no repo-local config), so `git commit` fails with
    // "empty ident name". Inject a deterministic identity for the smoke test
    // only — restored in finally — so the hermetic run matches local + CI.
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.ARCHON_GH_BIN = process.execPath; // run the mock with node
  process.env.ARCHON_GH_ARGS_PREFIX_JSON = JSON.stringify([FAKE_GH]);
  process.env.ARCHON_FAKE_GH_REMOTE_DIR = remoteDir;
  process.env.GIT_AUTHOR_NAME = "Archon Smoke"; // test fixture identity (#43)
  process.env.GIT_AUTHOR_EMAIL = "smoke@archonvii.test";
  process.env.GIT_COMMITTER_NAME = "Archon Smoke";
  process.env.GIT_COMMITTER_EMAIL = "smoke@archonvii.test";
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("fresh-repo remote path creates NO real GitHub repo (hermetic via local bare repo)", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-smoke-"));
  const remoteDir = await mkdtemp(join(tmpdir(), "archon-remote-"));
  const owner = "ArchonVII";
  const repo = "archon-setup-smoketest-hermetic";

  const result = await withMockGh(remoteDir, () =>
    runOnboard({
      targetPath,
      // remote.github pulls in the foundation closure; required-gate satisfies
      // the "exactly one CI" planner gate so the plan is not blocked.
      features: ["remote.github", "workflow.required-gate"],
      owner,
      repo,
      visibility: "private",
      capabilities: {
        "gh.repoCreateAllowed": true,
        "gh.authenticated": true,
        "gh.branchProtectionAllowed": true,
      },
    })
  );

  assert.equal(result.ok, true, `onboard should succeed; warnings=${JSON.stringify(result.blockingWarnings)}`);

  // origin points at the local bare repo, never github.com
  const originUrl = execFileSync("git", ["-C", targetPath, "remote", "get-url", "origin"]).toString().trim();
  assert.ok(!originUrl.includes("github.com"), `origin must not be github.com, got: ${originUrl}`);
  assert.ok(originUrl.includes("smoketest-hermetic"), `origin should be the local bare repo, got: ${originUrl}`);

  // the bare repo exists and received the pushed commit
  const bareDir = bareRepoPath(remoteDir, owner, repo);
  await stat(bareDir);
  const log = execFileSync("git", ["-C", bareDir, "log", "--oneline"]).toString().trim();
  assert.ok(log.length > 0, "bare repo should contain the pushed initial commit");
});

test("the smoke test exercises the real remote task through the mock (no network)", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-smoke-"));
  const remoteDir = await mkdtemp(join(tmpdir(), "archon-remote-"));

  const result = await withMockGh(remoteDir, () =>
    runOnboard({
      targetPath,
      features: ["remote.github", "workflow.required-gate"],
      owner: "ArchonVII",
      repo: "archon-setup-smoketest-hermetic",
      visibility: "private",
      capabilities: { "gh.repoCreateAllowed": true, "gh.authenticated": true, "gh.branchProtectionAllowed": true },
    })
  );
  assert.equal(result.ok, true);

  // The mock records each gh invocation; prove `repo create` actually ran
  // through it (i.e. the production remote path executed), and that no call
  // targeted github.com.
  const callLog = await readFile(join(remoteDir, ".gh-calls.log"), "utf8");
  assert.match(callLog, /repo create/, "the production gh-create path should have run through the mock");
  assert.ok(!callLog.includes("github.com"), "no mock invocation should reference github.com");
});

test("the smoke selection records a repo.create remote action in the manifest", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-smoke-"));
  const remoteDir = await mkdtemp(join(tmpdir(), "archon-remote-"));

  const result = await withMockGh(remoteDir, () =>
    runOnboard({
      targetPath,
      features: ["remote.github", "workflow.required-gate"],
      owner: "ArchonVII",
      repo: "archon-setup-smoketest-hermetic",
      visibility: "private",
      capabilities: { "gh.repoCreateAllowed": true, "gh.authenticated": true, "gh.branchProtectionAllowed": true },
    })
  );

  assert.equal(result.ok, true);
  const remoteActions = result.result.manifest.remoteActions;
  assert.ok(
    remoteActions.some((a) => a.type === "repo.create" && a.result === "ok"),
    `expected a repo.create remote action, got ${JSON.stringify(remoteActions)}`
  );
});
