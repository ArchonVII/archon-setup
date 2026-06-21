import { mkdtemp, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runOnboard,
  defaultLocalSelection,
  loadSourceSnapshots,
} from "../src/server/onboard/headlessOnboard.mjs";
import { loadRegistry, buildPlan } from "../src/server/planner/buildPlan.mjs";

// Baseline files the local-default selection must produce (subset of the
// repo-template baseline asserted in foundationParity.test.mjs).
const BASELINE_FILES = [
  "README.md",
  "LICENSE",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".githooks/pre-commit",
  ".githooks/scripts/checkout-role.sh",
  ".gitattributes",
  "CHANGELOG.md",
  ".github/dependabot.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/anomaly-triage.yml",
  ".github/workflows/repo-update-log-fragment.yml",
  ".github/workflows/repo-required-gate.yml",
  ".github/archon-setup.json",
  "scripts/close/lib.mjs",
  "scripts/close/scan-complete.mjs",
  "scripts/close/ci-guard.mjs",
];

// F19 / authority markers that the wizard scrubs out of generated hooks.
const FORBIDDEN_HOOK_PATTERNS = [/\bF19\b/, /ADR-001/, /docs\/adr\/001/, /\bF18\b/];

async function tempRoot(prefix = "archon-onboard-") {
  return mkdtemp(join(tmpdir(), prefix));
}

function exists(root, rel) {
  return access(join(root, rel), constants.F_OK).then(
    () => true,
    () => false
  );
}

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

test("defaultLocalSelection includes local files and runtime workflow callers", async () => {
  const { features } = await loadRegistry();
  const expected = features
    .filter((f) => f.default && f.remoteRequirement !== "api-target")
    .map((f) => f.id);
  assert.deepEqual(defaultLocalSelection(features), expected);
  assert.ok(expected.includes("foundation.hooks"));
  assert.ok(!expected.includes("remote.labels"), "api-target features are not in the local baseline");
  assert.ok(expected.includes("workflow.required-gate"), "required gate caller is part of the local baseline");
});

test("dry-run builds a plan via the shared planner and writes nothing", async () => {
  const root = await tempRoot();
  const result = await runOnboard({ targetPath: root, dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.ok(result.plan.files.length > 0, "plan should list files to create");

  // Single source of truth: the dry-run plan must equal a direct buildPlan call
  // with the same inputs the CLI assembles.
  const { features } = await loadRegistry();
  const reference = await buildPlan({
    selection: defaultLocalSelection(features),
    options: {},
    context: {
      targetPath: root,
      owner: "",
      account: "",
      repo: "",
      visibility: "private",
      capabilities: {},
      originDetected: null,
      sourceSnapshots: await loadSourceSnapshots(),
    },
  });
  assert.deepEqual(result.plan, reference);

  // Nothing was written to disk.
  for (const rel of BASELINE_FILES) {
    assert.equal(await exists(root, rel), false, `${rel} should not exist after dry-run`);
  }
});

test("onboard writes the local baseline, scrubbed identically to the wizard", async () => {
  const root = await tempRoot();

  const result = await withFetchStub(() =>
    withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
  );

  assert.equal(result.ok, true, "onboard should succeed");
  assert.equal(result.result.ok, true, "executor should succeed");

  for (const rel of BASELINE_FILES) {
    assert.equal(await exists(root, rel), true, `expected onboard to create ${rel}`);
  }

  // Manifest is written and self-identifies.
  const manifest = JSON.parse(await readFile(join(root, ".github/archon-setup.json"), "utf8"));
  assert.equal(manifest.tool, "archon-setup");
  assert.ok(manifest.selectedFeatures.includes("foundation.hooks"));

  // Hooks are scrubbed of F19 / authority markers.
  const preCommit = await readFile(join(root, ".githooks/pre-commit"), "utf8");
  const checkoutRole = await readFile(join(root, ".githooks/scripts/checkout-role.sh"), "utf8");
  for (const pattern of FORBIDDEN_HOOK_PATTERNS) {
    assert.doesNotMatch(preCommit, pattern, `pre-commit leaked ${pattern}`);
    assert.doesNotMatch(checkoutRole, pattern, `checkout-role leaked ${pattern}`);
  }
});

test("unknown feature ids are rejected before any write", async () => {
  const root = await tempRoot();
  await assert.rejects(
    () => runOnboard({ targetPath: root, features: ["foundation.readme", "not.a.feature"] }),
    /unknown feature/i
  );
  assert.equal(await exists(root, "README.md"), false);
});

test("missing targetPath is rejected", async () => {
  await assert.rejects(() => runOnboard({}), /targetPath/i);
});

test("blocking warnings halt execution and write nothing", async () => {
  const root = await tempRoot();
  // remote.github with no CI flavor selected => blocking workflows.ci warning,
  // and remote.github needs capabilities we do not grant.
  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.readme", "remote.github"],
  });

  assert.equal(result.ok, false);
  assert.ok(result.blockingWarnings.length > 0, "should report blocking warnings");
  assert.equal(result.result, undefined, "executor should not have run");
  assert.equal(await exists(root, "README.md"), false, "no files written when blocked");
});

test("onboarding an existing-origin repo installs a workflow without repo-create", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  const root = await tempRoot();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "remote", "add", "origin", "git@github.com:ArchonVII/example.git"]);

  const result = await runOnboard({ targetPath: root, features: ["workflow.pr-policy"], dryRun: true });

  assert.equal(result.ok, true);
  assert.ok(!result.plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  assert.ok(result.plan.files.some((f) => f.path === ".github/workflows/pr-policy.yml"));
  assert.equal(result.plan.context.githubRepoTarget.status, "known");
  assert.equal(result.plan.context.owner, "ArchonVII");
});
