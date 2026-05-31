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

function mockRunner({ protection, patchResult = { code: 0, stdout: "{}" } }) {
  const calls = [];
  const runCommand = async (cmd, args, options = {}) => {
    calls.push({ cmd, args, options });
    const path = args.find((arg) => typeof arg === "string" && arg.startsWith("repos/"));
    if (cmd === "gh" && args[0] === "api" && path.endsWith("/protection")) {
      return { code: 0, stdout: JSON.stringify(protection), stderr: "" };
    }
    if (cmd === "gh" && args[0] === "api" && path.endsWith("/protection/required_status_checks")) {
      return { stderr: "", ...patchResult };
    }
    throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
  };
  return { calls, runCommand };
}

test("tightenRequiredGate PATCHes the named gate and marks the manifest complete", async () => {
  const root = await tempRoot();
  await seedManifest(root);
  const { calls, runCommand } = mockRunner({
    protection: { required_status_checks: null },
  });

  const result = await tightenRequiredGate({
    targetPath: root,
    runCommand,
    now: () => "2026-05-31T18:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "required");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["api", "repos/ArchonVII/example/branches/main/protection"]);
  assert.deepEqual(calls[1].args, [
    "api",
    "--method",
    "PATCH",
    "repos/ArchonVII/example/branches/main/protection/required_status_checks",
    "--input",
    "-",
  ]);
  assert.deepEqual(JSON.parse(calls[1].options.stdin), {
    strict: false,
    checks: [{ context: DEFAULT_REQUIRED_GATE_CHECK }],
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
    patchResult: {
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
