import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { HOOK_FILES, check, apply, verify } from "../src/server/tasks/writeGithooks.mjs";

const execFileP = promisify(execFile);

async function tempRoot(prefix = "archon-onboard-execbit-existing-") {
  return mkdtemp(join(tmpdir(), prefix));
}

// Hermetic license/gitignore fetch stub (mirrors onboardHookExecBit.test.mjs).
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

// Minimal executor context for driving the writeGithooks task directly
// (mirrors test/manifestAccuracy.test.mjs).
function ctx(targetPath) {
  return {
    targetPath,
    owner: "ArchonVII",
    account: "ArchonVII",
    repo: "example",
    visibility: "private",
    taskOptions: {},
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
  };
}

async function stagedHookModes(root) {
  const { stdout } = await execFileP("git", ["-C", root, "ls-files", "-s", "--", ".githooks"]);
  return new Map(
    stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [mode, , , ...pathParts] = line.split(/\s+/);
        return [pathParts.join(" "), mode];
      })
  );
}

// Pre-initialise the temp repo as a filemode-less host (the Windows default)
// on every platform so the regression bites on Linux/macOS CI too: with
// core.filemode=false, plain `git add` records new files as 100644 regardless
// of the on-disk mode, so only explicit update-index --chmod=+x staging can
// yield 100755.
async function initFilemodelessRepo(root) {
  await execFileP("git", ["init", "-b", "main", root]);
  await execFileP("git", ["-C", root, "config", "core.filemode", "false"]);
}

// #294: initGitAndCommit.check() short-circuits to already-done for any target
// with prior commits, so the #317 bootstrap staging never runs on the
// existing-repo onboarding path — the path every real onboarding (civ-sim,
// lifeloot) took. writeGithooks must therefore stage the exec bit itself when
// the target is already a git repo: index mode is sticky under
// core.filemode=false, so the onboarding agent's later plain `git add` +
// commit preserves 100755. Staging only — onboarding must never auto-commit on
// top of a user's existing history.
test("onboarding an existing repo stages every hook entrypoint at 100755 without committing (#294)", async () => {
  const root = await tempRoot();
  await initFilemodelessRepo(root);

  await withGitIdentity(async () => {
    await writeFile(join(root, "PRIOR.md"), "# Pre-existing history\n", "utf8");
    await execFileP("git", ["-C", root, "add", "--", "PRIOR.md"]);
    await execFileP("git", ["-C", root, "commit", "-m", "chore: pre-existing user commit"]);
  });
  const { stdout: headBefore } = await execFileP("git", ["-C", root, "rev-parse", "HEAD"]);

  const result = await withFetchStub(() =>
    withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
  );
  assert.equal(result.ok, true, "onboard should succeed");

  const { stdout: headAfter } = await execFileP("git", ["-C", root, "rev-parse", "HEAD"]);
  assert.equal(
    headAfter.trim(),
    headBefore.trim(),
    "onboarding an existing repo must not create commits on the user's history"
  );

  const modeByPath = await stagedHookModes(root);
  for (const file of HOOK_FILES) {
    assert.equal(
      modeByPath.get(file),
      "100755",
      `${file} must be staged executable (got ${modeByPath.get(file) || "untracked"})`
    );
  }
});

// #294 repair path: a hook already tracked at 100644 (the residue every
// Windows onboarding left behind) must make check() report needs-apply, and a
// re-apply must repair the staged mode to 100755 — so re-onboard/update runs
// can heal mode drift instead of reporting already-done.
test("check() flags a hook tracked at 100644 and re-apply repairs the staged mode (#294)", async () => {
  const root = await tempRoot();
  await initFilemodelessRepo(root);
  const taskCtx = ctx(root);

  await apply(taskCtx);
  await withGitIdentity(async () => {
    // Pre-track a hook the way a plain `git add` under core.filemode=false
    // does, then force the index mode down to 100644 to simulate the drift.
    await execFileP("git", ["-C", root, "add", "--", ".githooks/commit-msg"]);
    await execFileP("git", ["-C", root, "update-index", "--chmod=-x", "--", ".githooks/commit-msg"]);
  });
  assert.equal((await stagedHookModes(root)).get(".githooks/commit-msg"), "100644", "degrade sanity check");

  assert.equal(await check(taskCtx), "needs-apply", "a hook tracked at 100644 must report needs-apply");
  const degraded = await verify(taskCtx);
  assert.equal(degraded.ok, false, "verify() must fail while a tracked hook is staged non-executable");

  await apply(taskCtx);
  assert.equal((await stagedHookModes(root)).get(".githooks/commit-msg"), "100755", "re-apply must repair the staged mode");
  assert.equal(await check(taskCtx), "already-done");
  assert.deepEqual(await verify(taskCtx), { ok: true });
});
