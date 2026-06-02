import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import * as setRepoSecrets from "../src/server/tasks/setRepoSecrets.mjs";
import * as enableCopilot from "../src/server/tasks/enableCopilot.mjs";
import { buildSecretSetCommand, secretRemoteAction } from "../src/server/tasks/setRepoSecrets.mjs";
import { classifyCopilotTarget } from "../src/server/tasks/enableCopilot.mjs";
import { redactString } from "../src/server/ecosystem/redact.mjs";
import { buildPlan } from "../src/server/planner/buildPlan.mjs";
import { executePlan } from "../src/server/executor/executePlan.mjs";
import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES = JSON.parse(readFileSync(join(ROOT, "src/registry/features.json"), "utf8"));
const FAKE_GH = join(ROOT, "test/mocks/fake-gh.mjs");

function tempDir(prefix = "archon-secret-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function withFakeGh(remoteDir, fn) {
  const previous = {
    ARCHON_GH_BIN: process.env.ARCHON_GH_BIN,
    ARCHON_GH_ARGS_PREFIX_JSON: process.env.ARCHON_GH_ARGS_PREFIX_JSON,
    ARCHON_FAKE_GH_REMOTE_DIR: process.env.ARCHON_FAKE_GH_REMOTE_DIR,
    ARCHON_FAKE_GH_EXPECT_SECRET: process.env.ARCHON_FAKE_GH_EXPECT_SECRET,
  };
  process.env.ARCHON_GH_BIN = process.execPath;
  process.env.ARCHON_GH_ARGS_PREFIX_JSON = JSON.stringify([FAKE_GH]);
  process.env.ARCHON_FAKE_GH_REMOTE_DIR = remoteDir;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function assertNoSecret(value, secret, label) {
  assert.ok(!JSON.stringify(value).includes(secret), `${label} must not contain the secret value`);
}

async function buildSecretPlan(secret) {
  return buildPlan({
    selection: ["copilot.repo-secret"],
    options: { "copilot.repo-secret": { secretName: "NPM_TOKEN", secretValue: secret } },
    context: {
      targetPath: tempDir(),
      owner: "ArchonVII",
      repo: "demo",
      visibility: "private",
      capabilities: { "gh.actionsSecretsAllowed": true },
    },
  });
}

// --- the security-critical contract: the value never leaves stdin -------------

test("buildSecretSetCommand carries the value on stdin, never on argv", () => {
  const SECRET = "ghp_supersecretvalue1234567890";
  const { cmd, args, stdin } = buildSecretSetCommand({
    name: "NPM_TOKEN",
    value: SECRET,
    owner: "ArchonVII",
    repo: "demo",
  });
  assert.equal(cmd, "gh");
  assert.equal(stdin, SECRET);
  assert.ok(!args.join(" ").includes(SECRET), "secret value must never appear anywhere in argv");
});

test("buildSecretSetCommand targets the repo and reads the body from stdin", () => {
  const { args } = buildSecretSetCommand({ name: "NPM_TOKEN", value: "x", owner: "ArchonVII", repo: "demo" });
  assert.deepEqual(args.slice(0, 3), ["secret", "set", "NPM_TOKEN"]);
  assert.ok(args.includes("--repo") && args.includes("ArchonVII/demo"), "must target owner/repo");
  assert.ok(!args.includes("--body"), "gh reads stdin only when --body is omitted");
});

test("setRepoSecrets uses gh stdin semantics, not --body literal semantics", async () => {
  const SECRET = "ghp_supersecretvalue1234567890";
  const remoteDir = tempDir("archon-fake-gh-secret-");
  await withFakeGh(remoteDir, async () => {
    process.env.ARCHON_FAKE_GH_EXPECT_SECRET = SECRET;
    const ctx = {
      owner: "ArchonVII",
      repo: "demo",
      featureId: "copilot.repo-secret",
      taskOptions: { secretName: "NPM_TOKEN" },
      manifest: { remoteActions: [] },
      secretProvider: async ({ name }) => {
        assert.equal(name, "NPM_TOKEN");
        return SECRET;
      },
    };

    const result = await setRepoSecrets.apply(ctx);
    assert.deepEqual(result, { result: "applied" });
    assert.deepEqual(ctx.manifest.remoteActions, [secretRemoteAction("NPM_TOKEN")]);

    const log = readFileSync(join(remoteDir, ".gh-calls.log"), "utf8");
    assert.match(log, /secret set NPM_TOKEN source=stdin/);
    assert.doesNotMatch(log, /--body\s+-/);
    assert.ok(!log.includes(SECRET), "fake gh call log must not record the secret value");
  });
});

test("secretRemoteAction records the name + wasSet but never the value", () => {
  const entry = secretRemoteAction("NPM_TOKEN");
  assert.equal(entry.type, "secret.set");
  assert.equal(entry.name, "NPM_TOKEN");
  assert.equal(entry.wasSet, true);
  assert.ok(!("value" in entry), "the manifest entry must not carry a value field");
});

test("planner never serializes a supplied secretValue into task options", async () => {
  const SECRET = "ghp_serialized_plan_secret_123456";
  const plan = await buildSecretPlan(SECRET);
  const unit = plan.ordered.find((entry) => entry.taskId === "setRepoSecrets");
  assert.deepEqual(unit.options, { secretName: "NPM_TOKEN" });
  assertNoSecret(plan, SECRET, "serialized plan");
});

test("dry-run and audit outputs do not contain supplied secret values", async () => {
  const SECRET = "ghp_dry_run_secret_1234567890";
  const input = {
    targetPath: tempDir(),
    features: ["copilot.repo-secret"],
    owner: "ArchonVII",
    repo: "demo",
    capabilities: { "gh.actionsSecretsAllowed": true },
    options: { "copilot.repo-secret": { secretName: "NPM_TOKEN", secretValue: SECRET } },
  };

  const dryRun = await runOnboard({ ...input, dryRun: true });
  assertNoSecret(dryRun, SECRET, "dry-run output");

  const audit = await runOnboard({ ...input, audit: true });
  assertNoSecret(audit, SECRET, "audit output");
});

test("executor strips secret-bearing task options before results, logs, manifests, or argv", async () => {
  const SECRET = "ghp_malicious_rpc_secret_123456";
  const targetPath = tempDir();
  const remoteDir = tempDir("archon-fake-gh-execute-");
  const plan = {
    context: { targetPath, owner: "ArchonVII", repo: "demo", visibility: "private" },
    selectedFeatureIds: ["copilot.repo-secret"],
    files: [],
    skippedFiles: [],
    commands: [],
    remoteMutations: [],
    postChecks: [],
    warnings: [],
    ordered: [
      {
        featureId: "copilot.repo-secret",
        taskId: "setRepoSecrets",
        options: { secretName: "NPM_TOKEN", secretValue: SECRET },
      },
    ],
  };

  await withFakeGh(remoteDir, async () => {
    const result = await executePlan(plan);
    assertNoSecret(result, SECRET, "executePlan result");

    const manifest = readFileSync(join(targetPath, ".github/archon-setup.json"), "utf8");
    assert.ok(!manifest.includes(SECRET), "manifest must not contain the secret value");

    const events = readFileSync(join(targetPath, ".archon/events.jsonl"), "utf8");
    assert.ok(!events.includes(SECRET), "event log must not contain the secret value");

    const ghLog = join(remoteDir, ".gh-calls.log");
    assert.equal(existsSync(ghLog), false, "serialized secretValue must not trigger a gh secret call");
  });
});

// --- redaction backstop -------------------------------------------------------

test("redactString masks an accidental `gh secret set NAME VALUE` argv leak", () => {
  const masked = redactString("running: gh secret set NPM_TOKEN s3cr3t-value-not-a-flag");
  assert.doesNotMatch(masked, /s3cr3t-value-not-a-flag/);
  assert.match(masked, /gh secret set NPM_TOKEN/); // name preserved
  assert.match(masked, /\[redacted\]/);
});

test("redactString still masks a GitHub token (existing pattern regression)", () => {
  const masked = redactString("token=ghp_abcdefghijklmnopqrstuvwxyz0123");
  assert.doesNotMatch(masked, /ghp_abcdefghijklmnopqrstuvwxyz0123/);
});

// --- Copilot enablement: org-only, with a manual checklist --------------------

test("classifyCopilotTarget blocks a personal (User) account", () => {
  const r = classifyCopilotTarget({ ownerType: "User" });
  assert.equal(r.status, "blocked");
  assert.match(r.reason, /org/i);
});

test("classifyCopilotTarget returns a manual checklist for an organization", () => {
  const r = classifyCopilotTarget({ ownerType: "Organization" });
  assert.equal(r.status, "manual-required");
  assert.ok(Array.isArray(r.checklist) && r.checklist.length > 0, "org path must include a manual checklist");
});

// --- staged-disabled registry wiring -----------------------------------------

test("the copilot features are registered, disabled, non-default, in the copilot group", () => {
  for (const id of ["copilot.enable-repo", "copilot.repo-secret"]) {
    const f = FEATURES.find((x) => x.id === id);
    assert.ok(f, `feature ${id} must exist`);
    assert.equal(f.disabled, true, `${id} must be disabled (v0.4 gate)`);
    assert.equal(f.default, false, `${id} must not be a default`);
    assert.equal(f.group, "copilot");
  }
});

test("the copilot features map to their tasks", () => {
  assert.ok(FEATURES.find((x) => x.id === "copilot.enable-repo").tasks.includes("enableCopilot"));
  assert.ok(FEATURES.find((x) => x.id === "copilot.repo-secret").tasks.includes("setRepoSecrets"));
});

test("setRepoSecrets and enableCopilot are valid task modules", () => {
  for (const mod of [setRepoSecrets, enableCopilot]) {
    assert.equal(typeof mod.check, "function");
    assert.equal(typeof mod.apply, "function");
    assert.equal(typeof mod.verify, "function");
  }
});
