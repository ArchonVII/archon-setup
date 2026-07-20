import { mkdtemp, readFile, access, writeFile } from "node:fs/promises";
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
import { attachSelectionValidation } from "../src/server/onboard/selectionValidation.mjs";

// Baseline files the minimal local-default selection must produce.
const MINIMAL_BASELINE_FILES = [
  "README.md",
  "LICENSE",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".gitattributes",
  ".agent/coordination/README.md",
  ".github/archon-setup.json",
  "docs/repo-update-log.md",
  ".agent/startup-baseline.json",
  "docs/plans/README.md",
  "docs/agent-process/document-policy.md",
  "docs/agent-process/message-protocol.md",
  ".agent/doc-map.yml",
  "docs/CANON.md",
  "docs/INDEX.md",
  "docs/agent-process/doc-system.md",
  "scripts/docs/lib.mjs",
  "scripts/docs/index.mjs",
  "scripts/docs/nav.mjs",
  "scripts/docs/render.mjs",
  "scripts/docs/status.mjs",
  "scripts/docs/changelog.mjs",
  "scripts/doc-health/lib.mjs",
  "scripts/doc-health/health.mjs",
  "docs/agent-process/doc-health.md",
  "package.json",
];

const OPT_IN_FILES = [
  ".githooks/pre-commit",
  ".githooks/scripts/checkout-role.sh",
  "CHANGELOG.md",
  ".changelog/unreleased/README.md",
  ".github/dependabot.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/anomaly-triage.yml",
  ".github/workflows/repo-update-log-fragment.yml",
  ".github/workflows/repo-required-gate.yml",
  "scripts/close/lib.mjs",
  "scripts/close/scan-complete.mjs",
  "scripts/close/ci-guard.mjs",
  "templates/README.md",
  "templates/MANIFEST.md",
  "templates/github/github.issue.standard.md",
];

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

test("defaultLocalSelection keeps standard onboarding local and minimal", async () => {
  const { features } = await loadRegistry();
  const expected = features
    .filter((f) => f.default && f.remoteRequirement !== "api-target")
    .map((f) => f.id);
  assert.deepEqual(defaultLocalSelection(features), expected);
  assert.ok(expected.includes("foundation.readme"));
  assert.ok(expected.includes("foundation.agents"));
  assert.ok(expected.includes("foundation.git-init"));
  assert.ok(!expected.includes("remote.labels"), "api-target features are not in the local baseline");
  assert.ok(!expected.includes("remote.branch-protection"), "remote branch protection is opt-in");
  assert.ok(!expected.includes("foundation.hooks"), "local hooks are opt-in");
  assert.ok(!expected.includes("foundation.pr-template"), "PR template ceremony is opt-in");
  assert.ok(!expected.includes("workflow.required-gate"), "runner-backed gate caller is opt-in");
  assert.ok(!expected.includes("agent-workflow.repo-update-log-fragment"), "retired repo-update-log workflow is disabled");
  assert.ok(!expected.includes("agent-lifecycle.baseline"), "agent lifecycle scripts are opt-in");
  assert.ok(!expected.includes("agent-workflow.doc-health"), "doc-health is pulled transitively by doc-system, not marked default itself");
  assert.ok(!expected.includes("agent-workflow.template-library"), "template library is opt-in");
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
  const reference = await attachSelectionValidation(await buildPlan({
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
  }));
  assert.deepEqual(result.plan, reference);

  // Nothing was written to disk.
  for (const rel of MINIMAL_BASELINE_FILES) {
    assert.equal(await exists(root, rel), false, `${rel} should not exist after dry-run`);
  }
});

test("onboard writes the minimal local baseline without opt-in process automation", async () => {
  const root = await tempRoot();

  const result = await withFetchStub(() =>
    withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
  );

  assert.equal(result.ok, true, "onboard should succeed");
  assert.equal(result.result.ok, true, "executor should succeed");

  for (const rel of MINIMAL_BASELINE_FILES) {
    assert.equal(await exists(root, rel), true, `expected onboard to create ${rel}`);
  }
  for (const rel of OPT_IN_FILES) {
    assert.equal(await exists(root, rel), false, `standard onboard should not create opt-in file ${rel}`);
  }

  // Manifest is written and self-identifies.
  const manifest = JSON.parse(await readFile(join(root, ".github/archon-setup.json"), "utf8"));
  assert.equal(manifest.tool, "archon-setup");
  assert.ok(manifest.selectedFeatures.includes("foundation.git-init"));
  assert.ok(manifest.selectedFeatures.includes("foundation.agents"));
  assert.ok(!manifest.selectedFeatures.includes("foundation.hooks"));
  assert.ok(!manifest.selectedFeatures.includes("workflow.required-gate"));
  assert.ok(!manifest.selectedFeatures.includes("agent-workflow.template-library"));
});

test("an explicit feature list can omit license while retaining git initialization (#374)", async () => {
  const root = await tempRoot("archon-onboard-no-license-");
  const { features } = await loadRegistry();
  const selection = defaultLocalSelection(features).filter((id) => id !== "foundation.license");

  const result = await withFetchStub(() =>
    withGitIdentity(() => runOnboard({
      targetPath: root,
      features: selection,
      owner: "ArchonVII",
      repo: "no-license-example",
    }))
  );

  assert.equal(result.ok, true);
  assert.equal(result.plan.selectedFeatureIds.includes("foundation.git-init"), true);
  assert.equal(result.plan.selectedFeatureIds.includes("foundation.license"), false);
  assert.equal(result.plan.files.some((file) => file.path === "LICENSE"), false);
  assert.equal(await exists(root, "LICENSE"), false);
  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.doesNotMatch(readme, /\[LICENSE\]\(\.\/LICENSE\)/);

  const manifest = JSON.parse(await readFile(join(root, ".github", "archon-setup.json"), "utf8"));
  assert.equal(manifest.selectedFeatures.includes("foundation.license"), false);
  assert.equal(manifest.createdFiles.some((file) => file.path === "LICENSE"), false);

  const auditResult = await withFetchStub(() => runOnboard({
    targetPath: root,
    features: selection,
    owner: "ArchonVII",
    repo: "no-license-example",
    audit: true,
  }));
  assert.equal(auditResult.audit.items.find((item) => item.path === "README.md")?.status, "present");
});

test("an explicitly empty feature list does not fall back to defaults", async () => {
  const root = await tempRoot("archon-onboard-empty-selection-");

  const result = await runOnboard({ targetPath: root, features: [], dryRun: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.selectedFeatureIds, []);
  assert.deepEqual(result.plan.files, []);
  assert.equal(await exists(root, "LICENSE"), false);
});

test("a default onboard reports docs-min startup readiness complete", async () => {
  const root = await tempRoot();

  const writeResult = await withFetchStub(() =>
    withGitIdentity(() => runOnboard({ targetPath: root, owner: "ArchonVII", repo: "example" }))
  );
  assert.equal(writeResult.ok, true, "onboard should succeed");

  for (const rel of MINIMAL_BASELINE_FILES) {
    assert.equal(await exists(root, rel), true, `expected onboard to create ${rel}`);
  }
  for (const rel of OPT_IN_FILES) {
    assert.equal(await exists(root, rel), false, `standard onboard should not create opt-in file ${rel}`);
  }

  const auditResult = await withFetchStub(() => runOnboard({ targetPath: root, audit: true }));
  assert.equal(auditResult.ok, true);
  assert.equal(auditResult.audit.startupReadiness.status, "complete");
  // A default onboard = the ten docs-min foundations after C5 (#353).
  assert.equal(auditResult.audit.startupReadiness.profile, "docs-min");
  assert.deepEqual(auditResult.audit.startupReadiness.missing, []);
  assert.deepEqual(auditResult.audit.startupReadiness.stale, []);
  // The docs-min floor: AGENTS.md + the coordination/plans/document-policy docs.
  assert.ok(auditResult.audit.startupReadiness.present.includes("AGENTS.md"));
  assert.ok(auditResult.audit.startupReadiness.present.includes(".agent/coordination/README.md"));
  // repo-update-log.md is installed but contract:"optional" — not in the docs-min
  // floor. The doc-system's own runner is part of the docs-min execution closure.
  assert.ok(!auditResult.audit.startupReadiness.present.includes("docs/repo-update-log.md"));
  assert.ok(auditResult.audit.startupReadiness.present.includes("scripts/doc-health/health.mjs"));

  const agentsPath = join(root, "AGENTS.md");
  const agentsBody = await readFile(agentsPath, "utf8");
  await writeFile(
    agentsPath,
    `${agentsBody.trimEnd()}\n\n## Repository-specific guidance\n\nKeep this local section.\n`,
    "utf8"
  );

  const customizedAudit = await withFetchStub(() => runOnboard({ targetPath: root, audit: true }));
  assert.equal(customizedAudit.audit.items.find((item) => item.path === "AGENTS.md")?.status, "drifted");
  assert.equal(customizedAudit.audit.startupReadiness.status, "complete");
  assert.ok(customizedAudit.audit.startupReadiness.present.includes("AGENTS.md"));
  assert.ok(!customizedAudit.audit.startupReadiness.stale.includes("AGENTS.md"));
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
