import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRequiredChecks } from "../src/server/branchProtection/tightenRequiredGate.mjs";

// Empty target dir: no .github/archon-setup.json, so manifest resolution is a no-op and
// owner/repo are taken from the explicit args below (no origin lookup needed).
async function emptyTarget() {
  return mkdtemp(join(tmpdir(), "archon-rrc-"));
}

function fakeRun(handler) {
  return async (cmd, args, opts) => handler({ cmd, args, opts });
}

const IDENTITY = { owner: "ArchonVII", repo: "consumer-repo", branch: "main" };

test("resolveRequiredChecks returns the configured contexts from live branch protection", async () => {
  const targetPath = await emptyTarget();
  const protection = {
    required_status_checks: {
      strict: true,
      contexts: ["legacy-ctx"],
      checks: [{ context: "Node CI", app_id: 1 }, { context: "repo-required-gate / decision" }],
    },
  };
  const runCommand = fakeRun(({ cmd, args }) => {
    assert.equal(cmd, "gh");
    assert.deepEqual(args, ["api", "repos/ArchonVII/consumer-repo/branches/main/protection"]);
    return { code: 0, stdout: JSON.stringify(protection), stderr: "" };
  });

  const result = await resolveRequiredChecks({ targetPath, ...IDENTITY, runCommand });

  assert.equal(result.status, "ok");
  assert.equal(result.source, "branch-protection");
  assert.deepEqual([...result.checks].sort(), ["Node CI", "legacy-ctx", "repo-required-gate / decision"]);
});

test("resolveRequiredChecks fails closed (empty) when branch protection is missing (404)", async () => {
  const targetPath = await emptyTarget();
  const runCommand = fakeRun(() => ({ code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }));

  const result = await resolveRequiredChecks({ targetPath, ...IDENTITY, runCommand });

  assert.deepEqual(result.checks, []);
  assert.equal(result.status, "missing-protection");
});

test("resolveRequiredChecks fails closed (empty) on an unreadable response (e.g. 403, no admin scope)", async () => {
  const targetPath = await emptyTarget();
  const runCommand = fakeRun(() => ({ code: 1, stdout: "", stderr: "gh: HTTP 403 (forbidden)" }));

  const result = await resolveRequiredChecks({ targetPath, ...IDENTITY, runCommand });

  assert.deepEqual(result.checks, []);
  assert.equal(result.status, "error");
});

test("resolveRequiredChecks returns ok with an empty set when protection requires no checks", async () => {
  const targetPath = await emptyTarget();
  const runCommand = fakeRun(() => ({ code: 0, stdout: JSON.stringify({ required_status_checks: null }), stderr: "" }));

  const result = await resolveRequiredChecks({ targetPath, ...IDENTITY, runCommand });

  assert.deepEqual(result.checks, []);
  assert.equal(result.status, "ok");
});
