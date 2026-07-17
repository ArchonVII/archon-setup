import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeAgentsMd from "../src/server/tasks/writeAgentsMd.mjs";
import { loadRegistry } from "../src/server/planner/buildPlan.mjs";
import { generateStartupBaseline, loadProfileFeatures } from "../src/server/tasks/startupBaseline.mjs";

// Lane C2 (#352): the startup baseline is generated per resolved selection, so
// the pinned assertions below compare against the generator's output for the
// selection under test rather than a hardcoded version/snapshot.
const { features: REGISTRY_FEATURES } = await loadRegistry();
const AGENT_STANDARD = await loadProfileFeatures("agent-standard");

test("writeAgentsMd creates the agent contract and repo update log", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-"));
  const ctx = {
    targetPath,
    taskOptions: {},
    // Bare foundation.agents selection: writeAgentsMd falls back to this when no
    // selection is threaded, so the generated baseline is that feature's floor.
    selectedFeatureIds: ["foundation.agents"],
    manifest: { createdFiles: [] },
  };

  await writeAgentsMd.apply(ctx);

  const agents = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  const updateLog = await readFile(join(targetPath, "docs", "repo-update-log.md"), "utf8");
  const startupBaseline = await readFile(join(targetPath, ".agent", "startup-baseline.json"), "utf8");
  const plansReadme = await readFile(join(targetPath, "docs", "plans", "README.md"), "utf8");
  // document-policy spec §5.1, lane 1c: foundation.agents now distributes the
  // document-policy charter alongside AGENTS.md.
  const documentPolicy = await readFile(join(targetPath, "docs", "agent-process", "document-policy.md"), "utf8");
  // #278: AGENTS.md's `## Message protocol` section links to this charter, so
  // foundation.agents must distribute it or every onboarded repo ships a
  // dangling relative link that doc-health flags.
  const messageProtocol = await readFile(join(targetPath, "docs", "agent-process", "message-protocol.md"), "utf8");

  assert.match(agents, /docs\/repo-update-log\.md/);
  assert.match(agents, /Agent Start Map/);
  // rt#179/as#366: item 7 defers to the repo's mode-resolved ## CHANGELOG
  // section instead of hardcoding rt's release-class mode.
  assert.match(agents, /Changelog policy lives in this repo's `## CHANGELOG` section/);
  assert.doesNotMatch(agents, /pick one and delete the other/);
  assert.doesNotMatch(agents, /<Mode 1: direct edit \/ Mode 2/);
  // #306: the delivery contract ships as its own managed block, guaranteed for
  // every onboarded repo and re-syncable via the same marker mechanism.
  assert.match(agents, /<!-- BEGIN ARCHONVII MANAGED BLOCK: delivery-workflow -->/);
  assert.match(agents, /<!-- END ARCHONVII MANAGED BLOCK: delivery-workflow -->/);
  assert.match(agents, /agent\/<tool>\/<issue>-<slug>/);
  assert.match(agents, /Never commit feature work to `main`/);
  assert.match(updateLog, /# Repository Update Log/);
  // Lane C2 (#352): the baseline is generated for the recorded selection, not a
  // pinned snapshot version. It equals the generator's output for foundation.agents.
  const expectedBaseline = generateStartupBaseline(["foundation.agents"], REGISTRY_FEATURES);
  assert.equal(JSON.parse(startupBaseline).version, expectedBaseline.version);
  assert.deepEqual(JSON.parse(startupBaseline), expectedBaseline);
  assert.match(plansReadme, /docs\/plans\/YYYY-MM-DD-<slug>\.md/);
  assert.ok(documentPolicy.length > 0, "document-policy.md is written");
  assert.match(messageProtocol, /# Message Protocol/, "message-protocol.md is written");
  assert.deepEqual(
    ctx.manifest.createdFiles.map((file) => file.path),
    ["AGENTS.md", "docs/repo-update-log.md", ".agent/startup-baseline.json", "docs/plans/README.md", "docs/agent-process/document-policy.md", "docs/agent-process/message-protocol.md"],
  );
});

test("writeAgentsMd reconciles an existing agent contract idempotently", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-existing-"));
  const existing = `# Existing Agent Guide

## Local workflow

Keep this repo-specific setup note.
`;
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };
  await writeFile(join(targetPath, "AGENTS.md"), existing, "utf8");

  assert.equal(await writeAgentsMd.check(ctx), "needs-apply");
  await writeAgentsMd.apply(ctx);

  const reconciled = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  const updateLog = await readFile(join(targetPath, "docs", "repo-update-log.md"), "utf8");

  assert.match(reconciled, /Keep this repo-specific setup note\./);
  assert.match(reconciled, /BEGIN ARCHONVII MANAGED BLOCK: agents-start-map/);
  assert.match(reconciled, /Agent Start Map/);
  // #306: an existing repo on the reconcile path must also receive the managed
  // delivery-workflow contract (the lifeloot gap), not just the start map.
  assert.match(reconciled, /BEGIN ARCHONVII MANAGED BLOCK: delivery-workflow/);
  assert.match(reconciled, /END ARCHONVII MANAGED BLOCK: delivery-workflow/);
  assert.match(reconciled, /agent\/<tool>\/<issue>-<slug>/);
  assert.match(reconciled, /Never commit feature work to `main`/);
  assert.doesNotMatch(reconciled, /## Checkout role \/ worktrees/);
  assert.doesNotMatch(reconciled, /Mode 1: direct edit/);
  assert.ok(
    reconciled.indexOf("BEGIN ARCHONVII MANAGED BLOCK: agents-start-map") < reconciled.indexOf("## Local workflow"),
    "managed startup block should be inserted near the top, before existing local sections",
  );
  assert.match(updateLog, /# Repository Update Log/);

  assert.equal(await writeAgentsMd.check(ctx), "already-done");
  await writeAgentsMd.apply(ctx);
  const rerun = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  assert.equal(rerun, reconciled);
});

test("writeAgentsMd moves an existing managed block near the top without duplicating it", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-buried-"));
  const existing = `# Existing Agent Guide

Intro stays first.

## Local workflow

Keep this repo-specific setup note.

<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->
old managed body
<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->
`;
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };
  await writeFile(join(targetPath, "AGENTS.md"), existing, "utf8");

  await writeAgentsMd.apply(ctx);

  const reconciled = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  assert.equal((reconciled.match(/BEGIN ARCHONVII MANAGED BLOCK: agents-start-map/g) || []).length, 1);
  assert.ok(reconciled.indexOf("Intro stays first.") < reconciled.indexOf("BEGIN ARCHONVII MANAGED BLOCK: agents-start-map"));
  assert.ok(reconciled.indexOf("BEGIN ARCHONVII MANAGED BLOCK: agents-start-map") < reconciled.indexOf("## Local workflow"));
  assert.match(reconciled, /Keep this repo-specific setup note\./);
});

test("writeAgentsMd preserves plans README YAML frontmatter while repairing baseline content", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-plans-frontmatter-"));
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };
  await mkdir(join(targetPath, "docs", "plans"), { recursive: true });
  await writeFile(
    join(targetPath, "docs", "plans", "README.md"),
    "---\nsummary: Local plans guide\nstatus: active\n---\n\n# Old Plans\n\nRepo-local wiki metadata must survive repair.\n",
    "utf8"
  );

  await writeAgentsMd.apply(ctx);

  const plansReadme = await readFile(join(targetPath, "docs", "plans", "README.md"), "utf8");
  assert.match(plansReadme, /^---\nsummary: Local plans guide\nstatus: active\n---\n\n# Plans/m);
  assert.match(plansReadme, /docs\/plans\/YYYY-MM-DD-<slug>\.md/);
  assert.doesNotMatch(plansReadme, /# Old Plans/);
  assert.equal(await writeAgentsMd.check(ctx), "already-done");
});

test("writeAgentsMd repairs a startup baseline that drifts from the generated expectation", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-baseline-contract-"));
  // agent-standard selection so the generated floor contains the closeout
  // scripts + package.json we tamper with below.
  const ctx = {
    targetPath,
    taskOptions: {},
    selectedFeatureIds: AGENT_STANDARD,
    manifest: { createdFiles: [] },
  };

  await writeAgentsMd.apply(ctx);
  const baselinePath = join(targetPath, ".agent", "startup-baseline.json");
  const generated = JSON.parse(await readFile(baselinePath, "utf8"));
  // Lane C2 premise: the on-disk baseline no longer equals the generated
  // expectation for the recorded selection (a hand-tampered floor with the
  // scripts + package.json dropped), so check/verify must flag and repair it.
  const stale = {
    ...generated,
    required: generated.required.filter((path) => !path.startsWith("scripts/") && path !== "package.json"),
  };
  await writeFile(baselinePath, JSON.stringify(stale, null, 2) + "\n", "utf8");

  assert.equal(await writeAgentsMd.check(ctx), "needs-apply");
  assert.equal((await writeAgentsMd.verify(ctx)).ok, false);

  await writeAgentsMd.apply(ctx);

  assert.deepEqual(JSON.parse(await readFile(baselinePath, "utf8")), generated);
  assert.equal(await writeAgentsMd.check(ctx), "already-done");
});

test("delivery-workflow block carries no changelog-mode specifics (as#366)", async () => {
  // rt#179: Workflow item 7 defers to each repo's mode-resolved ## CHANGELOG
  // section. The distributed block is consumer-invariant, so a Mode-2 fragment
  // consumer (e.g. hudson-bend) must never receive release-class instructions
  // ("PRs carry no changelog edits" / `npm run docs:changelog`) inside it.
  const snapshot = await readFile(
    new URL("../src/snapshots/repo-template/AGENTS.md", import.meta.url), "utf8");
  const rendered = writeAgentsMd.renderAgentsBody(snapshot);
  const block = writeAgentsMd.extractDeliveryWorkflowBody(rendered);
  assert.match(block, /Changelog policy lives in this repo's `## CHANGELOG` section/);
  assert.doesNotMatch(block, /release-class/);
  assert.doesNotMatch(block, /docs:changelog/);
  assert.doesNotMatch(block, /PRs carry no changelog edits/);
});

// as#372: the Start Map managed block renders per resolved selection — bullets
// whose providing feature is not selected are dropped at emit time, so docs-min
// consumers never receive pointers to uninstalled tooling (pigafetta#1814).
const DOCSMIN_LIKE = [
  "foundation.readme", "foundation.gitignore", "foundation.agents",
  "foundation.claude-md", "foundation.gemini-md", "foundation.coordination",
  "foundation.gitattributes", "foundation.git-init",
];
const FULL_TOOLING = [
  ...DOCSMIN_LIKE, "foundation.pr-template", "foundation.friction-ledger",
  "agent-workflow.check-map", "agent-lifecycle.baseline",
  "agent-workflow.doc-sweep", "agent-workflow.doc-health",
];

async function renderedStartMap(selectedFeatureIds) {
  const snapshot = await readFile(
    new URL("../src/snapshots/repo-template/AGENTS.md", import.meta.url), "utf8");
  const rendered = writeAgentsMd.renderAgentsBody(snapshot, { selectedFeatureIds });
  const start = rendered.indexOf("<!-- BEGIN MANAGED AGENT START MAP -->");
  const end = rendered.indexOf("<!-- END MANAGED AGENT START MAP -->");
  assert.ok(start !== -1 && end > start, "start map markers survive rendering");
  return rendered.slice(start, end);
}

test("start map drops uninstalled-feature bullets for a docs-min selection (as#372)", async () => {
  const map = await renderedStartMap(DOCSMIN_LIKE);
  for (const dropped of [
    "- Check map:", "- PR process:", "- Agent scripts:", "- Close guards:",
    "- Doc sweep:", "- Doc health:", "- Friction ledger:", "- Feature-gated bullets:",
  ]) {
    assert.ok(!map.includes(dropped), `${dropped} must be dropped for docs-min`);
  }
  for (const kept of ["- Document policy:", "- Plans:", "- Changelog:", "- Coordination:"]) {
    assert.ok(map.includes(kept), `${kept} must survive for docs-min`);
  }
});

test("start map keeps gated bullets when their features are selected (as#372)", async () => {
  const map = await renderedStartMap(FULL_TOOLING);
  for (const kept of [
    "- Check map:", "- PR process:", "- Agent scripts:", "- Close guards:",
    "- Doc sweep:", "- Doc health:", "- Friction ledger:",
  ]) {
    assert.ok(map.includes(kept), `${kept} must survive when its feature is selected`);
  }
  // The prose caveat is superseded by emit-time filtering and never ships.
  assert.ok(!map.includes("- Feature-gated bullets:"), "caveat bullet never ships");
});

test("renderAgentsBody without a selection stays byte-identical (backward compat, as#372)", async () => {
  const snapshot = await readFile(
    new URL("../src/snapshots/repo-template/AGENTS.md", import.meta.url), "utf8");
  assert.equal(writeAgentsMd.renderAgentsBody(snapshot),
    writeAgentsMd.renderAgentsBody(snapshot, {}),
    "omitted and empty options agree");
});

test("start map gating table matches the vendored snapshot (as#372 checked-mirror guard)", async () => {
  const snapshot = await readFile(
    new URL("../src/snapshots/repo-template/AGENTS.md", import.meta.url), "utf8");
  for (const prefix of Object.keys(writeAgentsMd.START_MAP_BULLET_FEATURES)) {
    const hits = snapshot.split(/\r?\n/).filter((l) => l.startsWith(prefix)).length;
    assert.equal(hits, 1,
      `gated prefix "${prefix}" must match exactly one snapshot line (refresh renamed it?)`);
  }
});
