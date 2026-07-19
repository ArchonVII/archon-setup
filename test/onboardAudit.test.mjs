import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { checkTargetPath } from "../src/server/preflight/checkTargetPath.mjs";
import { AGENT_SCRIPTS } from "../src/server/tasks/writeAgentLifecycle.mjs";
import { extractDeliveryWorkflowBody, renderAgentsBody } from "../src/server/tasks/writeAgentsMd.mjs";
import { loadCheckMapBody } from "../src/server/tasks/writeCheckMap.mjs";
import { DOC_SYSTEM_FILES } from "../src/server/tasks/writeDocSystem.mjs";
import { formatManagedBlock } from "../src/server/tasks/managedMarkdownBlock.mjs";
import { loadRegistry, resolveSelection } from "../src/server/planner/buildPlan.mjs";
import {
  generateStartupBaseline,
  serializeStartupBaseline,
  loadProfileFeatures,
} from "../src/server/tasks/startupBaseline.mjs";

// #306: the managed delivery-workflow block as onboarding renders it, used to
// seed a "current" AGENTS.md in audit tests without hardcoding the contract.
async function deliveryWorkflowBlock() {
  const snapshot = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", "AGENTS.md"), "utf8");
  return formatManagedBlock("delivery-workflow", extractDeliveryWorkflowBody(renderAgentsBody(snapshot)));
}

const execFileP = promisify(execFile);
const REPO_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

// Lane C2 (#352): the drifted 8-feature FULL_STARTUP_FEATURES twin is deleted.
// The "full floor" tests now select the real agent-standard tier, and every
// seeded .agent/startup-baseline.json is the GENERATED baseline for the seeded
// selection (not the snapshot), matching what onboarding actually writes.
const { features: REGISTRY_FEATURES } = await loadRegistry();
const AGENT_STANDARD = await loadProfileFeatures("agent-standard");

// The three closeout scripts from Lane C2 plus the provider's new carry helper
// are required runtime dependencies. Seed all four alongside the historical
// floor so an agent-standard repo audits complete.
const NEWLY_REQUIRED_SCRIPTS = [
  "scripts/agent/carry.mjs",
  "scripts/pr-contract.mjs",
  "scripts/agent-close-preflight.mjs",
  "scripts/agent-pr-ready.mjs",
];

function generatedBaselineBody(selection) {
  return serializeStartupBaseline(generateStartupBaseline(selection, REGISTRY_FEATURES));
}

async function tempRoot(prefix = "archon-audit-") {
  return mkdtemp(join(tmpdir(), prefix));
}

function exists(root, rel) {
  return access(join(root, rel), constants.F_OK).then(
    () => true,
    () => false
  );
}

async function seedGitRepo(root) {
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await writeFile(join(root, "package.json"), "{\"name\":\"seeded\"}\n", "utf8");
}

function byPath(audit, path) {
  const item = audit.items.find((entry) => entry.path === path);
  assert.ok(item, `expected audit item for ${path}`);
  return item;
}

function flipLineEndings(body) {
  const lf = body.replace(/\r\n/g, "\n");
  return body.includes("\r\n") ? lf : lf.replace(/\n/g, "\r\n");
}

async function copySnapshot(root, relativePath, { flipEol = false } = {}) {
  const body = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", relativePath), "utf8");
  await mkdir(dirname(join(root, relativePath)), { recursive: true });
  await writeFile(join(root, relativePath), flipEol ? flipLineEndings(body) : body, "utf8");
}

async function writeCurrentSetupManifest(root, selectedFeatures = []) {
  const snapshotManifest = JSON.parse(await readFile(join(REPO_ROOT, "src", "snapshots", "manifest.json"), "utf8"));
  await mkdir(join(root, ".github"), { recursive: true });
  await writeFile(
    join(root, ".github", "archon-setup.json"),
    JSON.stringify(
      {
        tool: "archon-setup",
        version: "test",
        selectedFeatures: resolveSelection(REGISTRY_FEATURES, selectedFeatures).map((feature) => feature.id),
        sourceSnapshots: snapshotManifest.snapshots,
        createdFiles: [".github/archon-setup.json"],
        skippedFiles: [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function seedCurrentMinimalAgentBaseline(root, selectedFeatures = ["foundation.agents"]) {
  // Let the real task graph seed the execution-closed docs contract, then
  // widen only the recorded selection/baseline for tests whose deliberate
  // missing or drifted item must remain absent.
  await runOnboard({ targetPath: root, features: ["foundation.agents"] });
  await writeCurrentSetupManifest(root, selectedFeatures);
  // Lane C2 (#352): the baseline is generated per selection, so seed the
  // GENERATED expectation for the recorded selection rather than the snapshot.
  await writeFile(join(root, ".agent", "startup-baseline.json"), generatedBaselineBody(selectedFeatures), "utf8");
}

test("audit mode reports present, missing, and drifted baseline files without writing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });

  const actionlint = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", ".github", "workflows", "actionlint.yml"),
    "utf8"
  );
  await writeFile(join(root, ".github", "workflows", "actionlint.yml"), actionlint, "utf8");
  await writeFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "legacy template\n", "utf8");

  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.actionlint", "foundation.pr-template", "foundation.hooks"],
    audit: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "audit");
  assert.equal(byPath(result.audit, ".github/workflows/actionlint.yml").status, "present");
  assert.equal(byPath(result.audit, ".github/PULL_REQUEST_TEMPLATE.md").status, "drifted");
  assert.equal(byPath(result.audit, ".githooks/pre-commit").status, "missing");
  assert.equal(result.audit.summary.present, 1);
  assert.equal(result.audit.summary.drifted, 1);
  assert.ok(result.audit.summary.missing >= 1);

  assert.equal(await exists(root, ".githooks/pre-commit"), false, "audit must not create missing hooks");
  assert.equal(await exists(root, ".github/archon-setup.json"), false, "audit must not write the manifest");
  assert.equal(await readFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "utf8"), "legacy template\n");
});

test("onboard --audit is exposed by the CLI JSON contract", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });

  const actionlint = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", ".github", "workflows", "actionlint.yml"),
    "utf8"
  );
  await writeFile(join(root, ".github", "workflows", "actionlint.yml"), actionlint, "utf8");

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.actionlint", "--audit", "--json"],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "audit");
  assert.equal(parsed.selectionValidation.ok, true);
  assert.deepEqual(parsed.selectionValidation.findings, []);
  assert.equal(byPath(parsed.audit, ".github/workflows/actionlint.yml").status, "present");
});

test("onboard --audit refuses a complete verdict when AGENTS.md is missing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await writeCurrentSetupManifest(root, ["foundation.agents"]);

  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.agents"],
    audit: true,
  });

  assert.equal(result.audit.onboardingCompletion.status, "incomplete");
  assert.ok(result.audit.onboardingCompletion.missing.includes("AGENTS.md"));
  assert.ok(!result.audit.onboardingCompletion.missing.includes(".github/archon-setup.json"));
  assert.equal(result.audit.onboardingCompletion.blockers.includes("missing required onboarding anchor: AGENTS.md"), true);
});

test("onboard --audit reports completion after applying the selected baseline", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const features = ["foundation.agents", "foundation.actionlint"];

  const applied = await runOnboard({
    targetPath: root,
    features,
  });
  assert.equal(applied.ok, true);

  const result = await runOnboard({
    targetPath: root,
    features,
    audit: true,
  });

  assert.equal(result.audit.onboardingCompletion.status, "complete");
  assert.deepEqual(result.audit.onboardingCompletion.missing, []);
  assert.deepEqual(result.audit.onboardingCompletion.missingBaselineItems, []);
  assert.deepEqual(result.audit.onboardingCompletion.driftedBaselineItems, []);
});

test("onboard --audit accepts a repaired doc-system body with repo-local frontmatter", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const features = ["foundation.agents"];

  await runOnboard({ targetPath: root, features });
  const docSystemPath = join(root, "docs", "agent-process", "doc-system.md");
  await writeFile(docSystemPath, "---\ntitle: Local Doc System\n---\n\nstale body\n", "utf8");

  const repaired = await runOnboard({ targetPath: root, features });
  assert.equal(repaired.ok, true);
  const repairedBody = await readFile(docSystemPath, "utf8");
  assert.match(repairedBody, /^---\ntitle: Local Doc System\n---/);

  const result = await runOnboard({ targetPath: root, features, audit: true });
  assert.equal(byPath(result.audit, "docs/agent-process/doc-system.md").status, "present");
  assert.equal(result.audit.onboardingCompletion.status, "complete");
});

test("onboard --audit reports doc-system package scripts as decisionable entries", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const features = ["foundation.doc-system", "foundation.changelog"];
  await runOnboard({ targetPath: root, features });

  let result = await runOnboard({ targetPath: root, features, audit: true });
  let pkg = result.audit.items.find((item) =>
    item.feature === "foundation.doc-system" && item.path === "package.json"
  );
  assert.equal(pkg?.comparison, "entries");
  assert.equal(pkg?.status, "present");
  assert.deepEqual(pkg?.detail.map((entry) => entry.key), ["docs:render", "docs:status"]);

  const packagePath = join(root, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  packageJson.scripts["docs:render"] = "node wrong-file.mjs";
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  result = await runOnboard({ targetPath: root, features, audit: true });
  pkg = result.audit.items.find((item) =>
    item.feature === "foundation.doc-system" && item.path === "package.json"
  );
  assert.equal(pkg?.status, "drifted");
  assert.equal(pkg?.detail.find((entry) => entry.key === "docs:render")?.status, "drifted");
  const changelogPackage = result.audit.items.find((item) =>
    item.feature === "foundation.changelog" && item.path === "package.json"
  );
  assert.equal(changelogPackage?.status, "present");
  assert.ok(result.audit.startupReadiness.stale.includes("package.json"));
});

test("onboard --audit refuses completion when a selected baseline item is missing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await seedCurrentMinimalAgentBaseline(root, ["foundation.agents", "foundation.actionlint"]);

  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.agents", "foundation.actionlint"],
    audit: true,
  });

  assert.equal(result.audit.startupReadiness.status, "complete");
  assert.equal(byPath(result.audit, ".github/workflows/actionlint.yml").status, "missing");
  assert.equal(result.audit.onboardingCompletion.status, "incomplete");
  assert.ok(result.audit.onboardingCompletion.missingBaselineItems.includes(".github/workflows/actionlint.yml"));
  assert.ok(
    result.audit.onboardingCompletion.blockers.includes(
      "missing selected baseline item: .github/workflows/actionlint.yml"
    )
  );
});

test("onboard --audit refuses completion when a selected baseline item is drifted", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await seedCurrentMinimalAgentBaseline(root, ["foundation.agents", "foundation.actionlint"]);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(join(root, ".github", "workflows", "actionlint.yml"), "name: local drift\n", "utf8");

  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.agents", "foundation.actionlint"],
    audit: true,
  });

  assert.equal(result.audit.startupReadiness.status, "complete");
  assert.equal(byPath(result.audit, ".github/workflows/actionlint.yml").status, "drifted");
  assert.equal(result.audit.onboardingCompletion.status, "incomplete");
  assert.ok(result.audit.onboardingCompletion.driftedBaselineItems.includes(".github/workflows/actionlint.yml"));
  assert.ok(
    result.audit.onboardingCompletion.blockers.includes(
      "drifted selected baseline item: .github/workflows/actionlint.yml"
    )
  );
});

test("onboard --audit refuses completion when the manifest omits a selected feature", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await seedCurrentMinimalAgentBaseline(root, ["foundation.agents"]);
  await copySnapshot(root, ".github/workflows/actionlint.yml");

  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.agents", "foundation.actionlint"],
    audit: true,
  });

  assert.equal(result.audit.startupReadiness.status, "complete");
  assert.equal(byPath(result.audit, ".github/workflows/actionlint.yml").status, "present");
  assert.equal(result.audit.onboardingCompletion.status, "incomplete");
  assert.deepEqual(result.audit.onboardingCompletion.manifestMissingFeatures, ["foundation.actionlint"]);
  assert.ok(
    result.audit.onboardingCompletion.blockers.includes(
      "manifest missing selected feature: foundation.actionlint"
    )
  );
});

test("onboard --audit reports a malformed disposition instead of crashing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const features = ["foundation.agents"];
  await runOnboard({ targetPath: root, features });

  const manifestPath = join(root, ".github", "archon-setup.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.onboardingDispositions = { schemaVersion: 1, items: [null] };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = await runOnboard({ targetPath: root, features, audit: true });

  assert.equal(result.audit.onboardingCompletion.status, "incomplete");
  assert.ok(
    result.audit.onboardingCompletion.manifestProblems.includes(
      "manifest onboarding disposition is invalid: unknown"
    )
  );
});

test("onboard CLI resolves a relative target path before auditing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), ".", "--features", "foundation.actionlint", "--audit", "--json"],
    { cwd: root }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "audit");
  assert.equal(parsed.plan.context.targetPath, root);
  assert.equal(byPath(parsed.audit, ".github/workflows/actionlint.yml").status, "missing");
});

test("human audit output prints the onboarding completion gate", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit"],
    { cwd: REPO_ROOT }
  );

  assert.match(stdout, /Onboarding completion: incomplete/);
  assert.match(stdout, /missing required anchors: AGENTS\.md, \.github\/archon-setup\.json/);
  assert.match(stdout, /Selection contract: valid/);
});

test("onboard --audit reports template library files as missing, present, or drifted", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await copySnapshot(root, "templates/README.md");
  await writeFile(join(root, "templates", "MANIFEST.md"), "# local drift\n", "utf8");

  const result = await runOnboard({
    targetPath: root,
    features: ["agent-workflow.template-library"],
    audit: true,
  });

  assert.equal(result.ok, true);
  assert.equal(byPath(result.audit, "templates/README.md").status, "present");
  assert.equal(byPath(result.audit, "templates/MANIFEST.md").status, "drifted");
  assert.equal(byPath(result.audit, "templates/github/github.issue.standard.md").status, "missing");
});

test("onboard --audit reports custom-profile startup readiness in JSON", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, "docs", "superpowers", "plans"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Local agent guide\n\n## Workflow\n\nOld process.\n", "utf8");

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit", "--json"],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "audit");
  assert.equal(parsed.audit.startupReadiness.status, "incomplete");
  // foundation.agents alone matches no tier => "custom"; version is generated.
  assert.equal(parsed.audit.startupReadiness.profile, "custom");
  assert.equal(
    parsed.audit.startupReadiness.baselineVersion,
    generateStartupBaseline(["foundation.agents"], REGISTRY_FEATURES).version
  );
  assert.ok(parsed.audit.startupReadiness.missing.includes("docs/plans/README.md"));
  assert.ok(parsed.audit.startupReadiness.stale.includes("AGENTS.md"));
  assert.ok(parsed.audit.startupReadiness.legacyDetected.includes("docs/superpowers/plans/"));
  assert.match(parsed.audit.startupReadiness.repairCommand, /onboard\.mjs .* --dry-run/);
});

test("startup readiness accepts repo-specific AGENTS when the managed start map is current", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const snapshotAgents = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", "AGENTS.md"), "utf8");
  const startMap = snapshotAgents.match(/<!-- BEGIN MANAGED AGENT START MAP -->[\s\S]*?<!-- END MANAGED AGENT START MAP -->/)[0];
  const plansReadme = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", "docs", "plans", "README.md"),
    "utf8"
  );

  await mkdir(join(root, ".agent", "coordination"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "docs", "plans"), { recursive: true });
  await mkdir(join(root, "docs", "agent-process"), { recursive: true });
  await mkdir(join(root, "scripts", "agent"), { recursive: true });
  await mkdir(join(root, "scripts", "doc-sweep"), { recursive: true });
  await mkdir(join(root, "scripts", "doc-health"), { recursive: true });
  await writeCurrentSetupManifest(root, AGENT_STANDARD);
  await writeFile(
    join(root, "AGENTS.md"),
    `# Local agent guide\n\n<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->\n${startMap}\n<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->\n\n## Local workflow\n\nKeep repo-specific rules.\n\n${await deliveryWorkflowBlock()}\n`,
    "utf8"
  );
  // Lane C2 (#352): seed the GENERATED baseline for the agent-standard tier.
  await writeFile(join(root, ".agent", "startup-baseline.json"), generatedBaselineBody(AGENT_STANDARD), "utf8");
  await writeFile(join(root, "docs", "plans", "README.md"), plansReadme, "utf8");
  await writeFile(join(root, "docs", "repo-update-log.md"), "# Repository Update Log\n\nLocal entries.\n", "utf8");
  await writeFile(join(root, ".agent", "check-map.yml"), await loadCheckMapBody(), "utf8");
  await copySnapshot(root, ".agent/coordination/README.md");
  await copySnapshot(root, ".github/PULL_REQUEST_TEMPLATE.md");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { ...AGENT_SCRIPTS } }, null, 2) + "\n");

  for (const relativePath of [
    ".github/workflows/anomaly-triage.yml",
    "scripts/agent/lib.mjs",
    "scripts/agent/start-task.mjs",
    "scripts/agent/status.mjs",
    "scripts/agent/prune.mjs",
    "scripts/agent/pr-body.mjs",
    "scripts/close/lib.mjs",
    "scripts/close/scan-complete.mjs",
    "scripts/close/ci-guard.mjs",
    "scripts/doc-sweep/lib.mjs",
    "scripts/doc-sweep/git.mjs",
    "scripts/doc-sweep/sweep.mjs",
    "scripts/doc-health/lib.mjs",
    "scripts/doc-health/health.mjs",
    "docs/agent-process/doc-sweep.md",
    "docs/agent-process/document-policy.md",
    "docs/agent-process/doc-health.md",
    ...DOC_SYSTEM_FILES,
    // The required closeout and carry runtime files must be present for an
    // agent-standard repo to audit complete.
    ...NEWLY_REQUIRED_SCRIPTS,
  ]) {
    await copySnapshot(root, relativePath, { flipEol: relativePath.startsWith("scripts/") });
  }

  const { stdout } = await execFileP(
    process.execPath,
    [
      join(REPO_ROOT, "bin", "onboard.mjs"),
      root,
      "--features",
      AGENT_STANDARD.join(","),
      "--audit",
      "--json",
    ],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.audit.startupReadiness.status, "complete");
  assert.equal(parsed.audit.startupReadiness.profile, "agent-standard");
  assert.deepEqual(parsed.audit.startupReadiness.missing, []);
  assert.deepEqual(parsed.audit.startupReadiness.stale, []);
  assert.ok(parsed.audit.startupReadiness.present.includes("AGENTS.md"));
  assert.ok(!parsed.audit.startupReadiness.present.includes("docs/repo-update-log.md"));
  assert.ok(!parsed.audit.startupReadiness.present.includes("docs/repo-update-log/README.md"));
  assert.ok(!parsed.audit.startupReadiness.present.includes(".github/workflows/repo-update-log-fragment.yml"));
});

test("onboard --audit flags a missing managed delivery-workflow block on an existing repo", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const snapshotAgents = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", "AGENTS.md"), "utf8");
  const startMap = snapshotAgents.match(/<!-- BEGIN MANAGED AGENT START MAP -->[\s\S]*?<!-- END MANAGED AGENT START MAP -->/)[0];
  const startMapBlock = `<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->\n${startMap}\n<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->`;

  async function auditStartup() {
    const { stdout } = await execFileP(
      process.execPath,
      [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit", "--json"],
      { cwd: REPO_ROOT }
    );
    return JSON.parse(stdout).audit.startupReadiness;
  }

  // RED: start map present, managed delivery-workflow block absent (the lifeloot gap).
  await writeFile(
    join(root, "AGENTS.md"),
    `# Local agent guide\n\n${startMapBlock}\n\n## Local workflow\n\nKeep repo-specific rules.\n`,
    "utf8"
  );
  const red = await auditStartup();
  assert.ok(red.stale.includes("AGENTS.md"), "a missing delivery-workflow block must flag AGENTS.md as stale");
  assert.ok(!red.present.includes("AGENTS.md"));

  // GREEN: add the managed delivery-workflow block and the flag clears.
  await writeFile(
    join(root, "AGENTS.md"),
    `# Local agent guide\n\n${startMapBlock}\n\n## Local workflow\n\nKeep repo-specific rules.\n\n${await deliveryWorkflowBlock()}\n`,
    "utf8"
  );
  const green = await auditStartup();
  assert.ok(green.present.includes("AGENTS.md"), "adding the delivery-workflow block clears the AGENTS.md flag");
  assert.ok(!green.stale.includes("AGENTS.md"));
});

test("startup readiness reports stale concrete startup tooling", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const snapshotAgents = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", "AGENTS.md"), "utf8");
  const startMap = snapshotAgents.match(/<!-- BEGIN MANAGED AGENT START MAP -->[\s\S]*?<!-- END MANAGED AGENT START MAP -->/)[0];

  await mkdir(join(root, ".agent", "coordination"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "AGENTS.md"),
    `# Local agent guide\n\n<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->\n${startMap}\n<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->\n`,
    "utf8"
  );
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { ...AGENT_SCRIPTS } }, null, 2) + "\n");
  await writeFile(join(root, "docs", "repo-update-log.md"), "# Repository Update Log\n\nLocal entries.\n", "utf8");
  await writeFile(join(root, ".agent", "check-map.yml"), "version: 1\n", "utf8");
  await writeFile(join(root, ".agent", "coordination", "README.md"), "# Coordination\n", "utf8");
  await writeFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Summary\n", "utf8");

  // Lane C2 (#352): the baseline is generated per selection — seed the correct
  // agent-standard baseline so only the tampered scripts (below) read stale.
  await writeFile(join(root, ".agent", "startup-baseline.json"), generatedBaselineBody(AGENT_STANDARD), "utf8");
  for (const relativePath of [
    "docs/plans/README.md",
    ".github/workflows/anomaly-triage.yml",
    "scripts/agent/lib.mjs",
    "scripts/agent/start-task.mjs",
    "scripts/agent/prune.mjs",
    "scripts/agent/pr-body.mjs",
    "scripts/close/lib.mjs",
    "scripts/close/scan-complete.mjs",
    "scripts/doc-sweep/lib.mjs",
    "scripts/doc-sweep/git.mjs",
    "scripts/doc-sweep/sweep.mjs",
    "scripts/doc-health/lib.mjs",
    "scripts/doc-health/health.mjs",
    "docs/agent-process/doc-sweep.md",
    "docs/agent-process/document-policy.md",
    "docs/agent-process/doc-health.md",
    ...DOC_SYSTEM_FILES,
    // The required closeout and carry runtime files are present so only the
    // deliberately tampered status.mjs / ci-guard.mjs are stale.
    ...NEWLY_REQUIRED_SCRIPTS,
  ]) {
    await copySnapshot(root, relativePath);
  }
  await mkdir(join(root, "scripts", "agent"), { recursive: true });
  await writeFile(join(root, "scripts", "agent", "status.mjs"), "console.log('old status without startup map');\n", "utf8");
  await mkdir(join(root, "scripts", "close"), { recursive: true });
  await writeFile(join(root, "scripts", "close", "ci-guard.mjs"), "console.log('old close guard');\n", "utf8");
  // A tampered ROOT closeout script (not under scripts/{agent,close,doc-*}/) must
  // read stale too. The readiness check formerly compared only those subdir
  // prefixes and reported a drifted root required script present (Codex on #356).
  await writeFile(join(root, "scripts", "pr-contract.mjs"), "console.log('old pr contract');\n", "utf8");
  await writeFile(join(root, ".agent", "doc-map.yml"), "version: 1\n# stale doc floor\n", "utf8");

  const { stdout } = await execFileP(
    process.execPath,
    [
      join(REPO_ROOT, "bin", "onboard.mjs"),
      root,
      "--features",
      AGENT_STANDARD.join(","),
      "--audit",
      "--json",
    ],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.audit.startupReadiness.status, "incomplete");
  assert.equal(parsed.audit.startupReadiness.profile, "agent-standard");
  assert.deepEqual(parsed.audit.startupReadiness.missing, []);
  assert.ok(parsed.audit.startupReadiness.stale.includes("scripts/agent/status.mjs"));
  assert.ok(parsed.audit.startupReadiness.stale.includes("scripts/close/ci-guard.mjs"));
  assert.ok(parsed.audit.startupReadiness.stale.includes("scripts/pr-contract.mjs"));
  assert.ok(parsed.audit.startupReadiness.stale.includes(".agent/doc-map.yml"));
});

test("startup readiness reports stale same-version startup baseline contract", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const snapshotAgents = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", "AGENTS.md"), "utf8");
  const startMap = snapshotAgents.match(/<!-- BEGIN MANAGED AGENT START MAP -->[\s\S]*?<!-- END MANAGED AGENT START MAP -->/)[0];
  // Lane C2 premise (#352): the on-disk baseline differs from the GENERATED
  // expectation for the recorded selection — same generated version string but a
  // floor with the scripts + package.json dropped, so it reads stale.
  const generated = generateStartupBaseline(AGENT_STANDARD, REGISTRY_FEATURES);
  const staleBaseline = {
    ...generated,
    required: generated.required.filter((path) => !path.startsWith("scripts/") && path !== "package.json"),
  };

  await mkdir(join(root, ".agent", "coordination"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "AGENTS.md"),
    `# Local agent guide\n\n<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->\n${startMap}\n<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->\n`,
    "utf8"
  );
  await writeFile(join(root, ".agent", "startup-baseline.json"), JSON.stringify(staleBaseline, null, 2) + "\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { ...AGENT_SCRIPTS } }, null, 2) + "\n");
  await writeFile(join(root, "docs", "repo-update-log.md"), "# Repository Update Log\n\nLocal entries.\n", "utf8");
  await writeFile(join(root, ".agent", "check-map.yml"), "version: 1\n", "utf8");
  await writeFile(join(root, ".agent", "coordination", "README.md"), "# Coordination\n", "utf8");
  await writeFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Summary\n", "utf8");

  for (const relativePath of [
    "docs/plans/README.md",
    ".github/workflows/anomaly-triage.yml",
    "scripts/agent/lib.mjs",
    "scripts/agent/start-task.mjs",
    "scripts/agent/status.mjs",
    "scripts/agent/prune.mjs",
    "scripts/agent/pr-body.mjs",
    "scripts/close/lib.mjs",
    "scripts/close/scan-complete.mjs",
    "scripts/close/ci-guard.mjs",
    "scripts/doc-sweep/lib.mjs",
    "scripts/doc-sweep/git.mjs",
    "scripts/doc-sweep/sweep.mjs",
    "scripts/doc-health/lib.mjs",
    "scripts/doc-health/health.mjs",
    "docs/agent-process/doc-sweep.md",
    "docs/agent-process/document-policy.md",
    "docs/agent-process/doc-health.md",
    ...DOC_SYSTEM_FILES,
    // The required closeout and carry runtime files are present so only the
    // baseline itself reads stale.
    ...NEWLY_REQUIRED_SCRIPTS,
  ]) {
    await copySnapshot(root, relativePath);
  }

  const { stdout } = await execFileP(
    process.execPath,
    [
      join(REPO_ROOT, "bin", "onboard.mjs"),
      root,
      "--features",
      AGENT_STANDARD.join(","),
      "--audit",
      "--json",
    ],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.audit.startupReadiness.status, "incomplete");
  assert.equal(parsed.audit.startupReadiness.profile, "agent-standard");
  assert.deepEqual(parsed.audit.startupReadiness.missing, []);
  assert.ok(parsed.audit.startupReadiness.stale.includes(".agent/startup-baseline.json"));
});

test("human audit output names the derived profile and generated baseline", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit"],
    { cwd: REPO_ROOT }
  );

  assert.match(stdout, /Startup readiness:/);
  // foundation.agents alone => "custom"; the wording explains generation.
  assert.match(stdout, /profile: custom/);
  assert.match(stdout, /generated per profile/i);
  // The retired full/minimal wording is gone.
  assert.doesNotMatch(stdout, /workflow-only update/i);
  assert.doesNotMatch(stdout, /automation is opt-in/i);
});

test("target preflight can explicitly accept a populated existing repo", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const defaultResult = await checkTargetPath(root);
  assert.equal(defaultResult.status, "red");

  const existingResult = await checkTargetPath(root, { mode: "existing-repo" });
  assert.equal(existingResult.status, "green");
  assert.equal(existingResult.existingRepo, true);
  assert.equal(existingResult.willCreate, false);
  assert.match(existingResult.detail, /Existing repository ready/);
});
