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
