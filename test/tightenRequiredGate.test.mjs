import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REQUIRED_GATE_CHECK,
  tightenRequiredGate,
} from "../src/server/branchProtection/tightenRequiredGate.mjs";

async function tempRoot(prefix = "archon-tighten-gate-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function seedManifest(root, manifest = {}) {
  const path = join(root, ".github", "archon-setup.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        tool: "archon-setup",
        owner: "ArchonVII",
        repo: "example",
        postChecks: [
          {
            type: "branchProtection.tightenRequiredChecks",
            deferUntil: "firstCheckRun",
          },
        ],
        ...manifest,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return path;
}

async function readManifest(root) {
  return JSON.parse(await readFile(join(root, ".github", "archon-setup.json"), "utf8"));
}

function mockRunner({ protection, patchResult = { code: 0, stdout: "{}" }, putResult = { code: 0, stdout: "{}" } }) {
  const calls = [];
  const runCommand = async (cmd, args, options = {}) => {
    calls.push({ cmd, args, options });
    const path = args.find((arg) => typeof arg === "string" && arg.startsWith("repos/"));
    if (cmd === "gh" && args[0] === "api" && path.endsWith("/protection") && !args.includes("--method")) {
      return { code: 0, stdout: JSON.stringify(protection), stderr: "" };
    }
    if (cmd === "gh" && args[0] === "api" && args.includes("PUT") && path.endsWith("/protection")) {
      return { stderr: "", ...putResult };
    }
    if (cmd === "gh" && args[0] === "api" && path.endsWith("/protection/required_status_checks")) {
      return { stderr: "", ...patchResult };
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
  };
  return { calls, runCommand };
}

// Baseline protection has required_status_checks: null — GitHub 404s the
// subresource PATCH in that state, so the gate must be enabled through a
// full-protection PUT that preserves the current settings (#301).
test("tightenRequiredGate enables the gate via full-protection PUT when required status checks are null", async () => {
  const root = await tempRoot();
  await seedManifest(root);
  const { calls, runCommand } = mockRunner({
    protection: {
      required_status_checks: null,
      enforce_admins: { enabled: false },
      required_pull_request_reviews: {
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
        required_approving_review_count: 0,
      },
      restrictions: null,
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      required_conversation_resolution: { enabled: true },
      block_creations: { enabled: false },
      lock_branch: { enabled: false },
      allow_fork_syncing: { enabled: true },
    },
  });

  const result = await tightenRequiredGate({
    targetPath: root,
    runCommand,
    now: () => "2026-05-31T18:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "required");
  assert.equal(result.via, "full-protection-put");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["api", "repos/ArchonVII/example/branches/main/protection"]);
  assert.deepEqual(calls[1].args, [
    "api",
    "--method",
    "PUT",
    "repos/ArchonVII/example/branches/main/protection",
    "--input",
    "-",
  ]);
  // The PUT body must carry the new gate AND preserve every baseline setting.
  assert.deepEqual(JSON.parse(calls[1].options.stdin), {
    required_status_checks: {
      strict: false,
      checks: [{ context: DEFAULT_REQUIRED_GATE_CHECK }],
    },
    enforce_admins: false,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
    },
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: true,
    lock_branch: false,
    allow_fork_syncing: true,
  });

  const manifest = await readManifest(root);
  assert.deepEqual(manifest.postChecks, [
    {
      type: "branchProtection.tightenRequiredChecks",
      deferUntil: "firstCheckRun",
      status: "complete",
      completedAt: "2026-05-31T18:00:00.000Z",
      requiredCheck: DEFAULT_REQUIRED_GATE_CHECK,
      branch: "main",
      result: "required",
    },
  ]);
});

test("tightenRequiredGate is safe before the check has run", async () => {
  const root = await tempRoot();
  await seedManifest(root);
  const { calls, runCommand } = mockRunner({
    protection: { required_status_checks: null },
    putResult: {
      code: 422,
      stderr: "Validation Failed: required status check repo-required-gate / decision has not run",
    },
  });

  const result = await tightenRequiredGate({ targetPath: root, runCommand });

  assert.equal(result.ok, true);
  assert.equal(result.status, "pending-check-run");
  assert.match(result.message, /has not run/i);
  assert.equal(calls.length, 2, "should try the safe GitHub update once");

  const manifest = await readManifest(root);
  assert.equal(manifest.postChecks[0].status, undefined, "pending run must not be recorded as complete");
});

// If required status checks vanish between the read and the subresource PATCH,
// GitHub 404s the PATCH. That is NOT missing branch protection — report it
// distinctly so the operator reruns (which takes the PUT path) instead of
// re-applying baseline protection (#301).
test("tightenRequiredGate reports required-checks-not-enabled when the subresource PATCH 404s", async () => {
  const root = await tempRoot();
  await seedManifest(root);
  const { calls, runCommand } = mockRunner({
    protection: {
      required_status_checks: { strict: false, contexts: ["node-ci / ci-success"], checks: [] },
    },
    patchResult: {
      code: 404,
      stderr: "gh: Required status checks not enabled (HTTP 404)",
    },
  });

  const result = await tightenRequiredGate({ targetPath: root, runCommand });

  assert.equal(result.ok, true);
  assert.equal(result.status, "required-checks-not-enabled");
  assert.match(result.message, /required status checks are not enabled/i);
  assert.doesNotMatch(result.message, /branch protection is not enabled/i);
  assert.equal(calls.length, 2);

  const manifest = await readManifest(root);
  assert.equal(manifest.postChecks[0].status, undefined, "must not be recorded as complete");
});

test("tightenRequiredGate is idempotent when the gate is already required", async () => {
  const root = await tempRoot();
  await seedManifest(root, {
    postChecks: [
      {
        type: "branchProtection.tightenRequiredChecks",
        deferUntil: "firstCheckRun",
        status: "complete",
        completedAt: "2026-05-30T12:00:00.000Z",
        requiredCheck: DEFAULT_REQUIRED_GATE_CHECK,
        branch: "main",
        result: "required",
      },
    ],
  });
  const { calls, runCommand } = mockRunner({
    protection: {
      required_status_checks: {
        strict: true,
        contexts: [DEFAULT_REQUIRED_GATE_CHECK],
        checks: [{ context: DEFAULT_REQUIRED_GATE_CHECK, app_id: 15368 }],
      },
    },
  });

  const result = await tightenRequiredGate({
    targetPath: root,
    runCommand,
    now: () => "2026-05-31T18:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "already-required");
  assert.equal(calls.length, 1, "already-required must not PATCH branch protection");

  const manifest = await readManifest(root);
  assert.equal(manifest.postChecks.length, 1);
  assert.equal(manifest.postChecks[0].completedAt, "2026-05-30T12:00:00.000Z");
});

test("tightenRequiredGate preserves existing checks and strict mode", async () => {
  const root = await tempRoot();
  await seedManifest(root);
  const { calls, runCommand } = mockRunner({
    protection: {
      required_status_checks: {
        strict: true,
        contexts: ["node-ci / ci-success"],
        checks: [{ context: "node-ci / ci-success", app_id: 15368 }],
      },
    },
  });

  const result = await tightenRequiredGate({ targetPath: root, runCommand });

  assert.equal(result.ok, true);
  assert.equal(result.status, "required");
  assert.deepEqual(JSON.parse(calls[1].options.stdin), {
    strict: true,
    checks: [
      { context: "node-ci / ci-success", app_id: 15368 },
      { context: DEFAULT_REQUIRED_GATE_CHECK },
    ],
  });
});
