import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, buildPlan } from "../src/server/planner/buildPlan.mjs";

test("registry loads and groups exist", async () => {
  const { features, groups, schema } = await loadRegistry();
  assert.ok(features.length > 0, "features.json is non-empty");
  assert.ok(groups.length > 0, "groups.json is non-empty");
  assert.ok(schema.title, "schema has a title");
});

test("every feature.group matches a known group", async () => {
  const { features, groups } = await loadRegistry();
  const known = new Set(groups.map((g) => g.id));
  for (const f of features) {
    assert.ok(known.has(f.group), `feature ${f.id} references unknown group ${f.group}`);
  }
});

test("every feature.requires points at a real feature id", async () => {
  const { features } = await loadRegistry();
  const ids = new Set(features.map((f) => f.id));
  for (const f of features) {
    for (const dep of f.requires || []) {
      assert.ok(ids.has(dep), `feature ${f.id} requires unknown id ${dep}`);
    }
  }
});

test("plan.build closes over required features transitively", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true } },
  });
  assert.ok(plan.selectedFeatureIds.includes("remote.github"));
});

test("agent-workflow.anomaly-triage feature loads and depends on remote.github", async () => {
  const { features, groups } = await loadRegistry();
  const triage = features.find((f) => f.id === "agent-workflow.anomaly-triage");
  assert.ok(triage, "anomaly-triage feature missing");
  assert.equal(triage.group, "agent-workflow");
  assert.ok(triage.requires.includes("remote.github"));
  assert.ok(triage.creates.includes(".github/workflows/anomaly-triage.yml"));
  const group = groups.find((g) => g.id === "agent-workflow");
  assert.ok(group, "agent-workflow group missing from groups.json");
});

test("foundation.agents plans the repo update log with AGENTS.md", async () => {
  const { features } = await loadRegistry();
  const agents = features.find((f) => f.id === "foundation.agents");

  assert.ok(agents, "foundation.agents feature missing");
  assert.ok(agents.creates.includes("AGENTS.md"));
  assert.ok(agents.creates.includes("docs/repo-update-log.md"));
});

test("planning anomaly-triage pulls in remote.github transitively", async () => {
  const plan = await buildPlan({
    selection: ["agent-workflow.anomaly-triage"],
    options: {},
    context: {
      targetPath: "X",
      owner: "o",
      repo: "r",
      visibility: "private",
      capabilities: { "gh.repoCreateAllowed": true },
    },
  });
  assert.ok(plan.selectedFeatureIds.includes("remote.github"));
  assert.ok(
    plan.files.some((f) => f.path === ".github/workflows/anomaly-triage.yml"),
    "anomaly-triage workflow should be planned for creation"
  );
});

test("plan with branch protection adds deferred post-check", async () => {
  const plan = await buildPlan({
    selection: ["remote.branch-protection"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true, "gh.branchProtectionAllowed": true } },
  });
  assert.ok(
    plan.postChecks.some((p) => p.type === "branchProtection.tightenRequiredChecks"),
    "expected a tightenRequiredChecks post-check"
  );
});

// --- issue #17 / F1: language-CI features ---

test("workflows.ci group is enabled and contains node/python/minimal CI features", async () => {
  const { features, groups } = await loadRegistry();
  const group = groups.find((g) => g.id === "workflows.ci");
  assert.ok(group, "workflows.ci group missing");
  assert.ok(!group.disabled, "workflows.ci group should be enabled");

  for (const id of ["workflow.node-ci", "workflow.python-ci", "workflow.minimal-ci"]) {
    const f = features.find((x) => x.id === id);
    assert.ok(f, `${id} feature missing`);
    assert.equal(f.group, "workflows.ci");
    assert.ok(f.requires.includes("remote.github"));
    assert.equal(f.tasks[0], "installWorkflow");
  }
});

test("language-CI features declare mutual conflictsWith", async () => {
  const { features } = await loadRegistry();
  const ciIds = ["workflow.node-ci", "workflow.python-ci", "workflow.minimal-ci"];
  for (const id of ciIds) {
    const f = features.find((x) => x.id === id);
    const others = ciIds.filter((x) => x !== id);
    for (const other of others) {
      assert.ok(
        f.conflictsWith?.includes(other),
        `${id} should declare conflictsWith ${other}`
      );
    }
  }
});

test("planner warns when remote.github is selected without a language CI", async () => {
  const plan = await buildPlan({
    selection: ["remote.github"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true } },
  });
  assert.ok(
    plan.warnings.some((w) => w.feature === "workflows.ci" && /no required gate/.test(w.message)),
    "expected missing-CI warning"
  );
});

test("planner does not warn about CI when a language-CI feature is selected", async () => {
  const plan = await buildPlan({
    selection: ["workflow.node-ci"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true } },
  });
  assert.ok(plan.selectedFeatureIds.includes("workflow.node-ci"));
  assert.ok(plan.selectedFeatureIds.includes("remote.github"), "transitive remote.github");
  assert.ok(
    !plan.warnings.some((w) => w.feature === "workflows.ci"),
    "should not warn about CI when one is selected"
  );
});

test("planner warns and flags conflict when two language-CI features are selected", async () => {
  const plan = await buildPlan({
    selection: ["workflow.node-ci", "workflow.python-ci"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true } },
  });
  assert.ok(
    plan.warnings.some((w) => /more than one language CI selected/.test(w.message)),
    "expected duplicate-CI warning"
  );
  assert.ok(
    plan.warnings.some((w) => /conflicts with selected feature/.test(w.message)),
    "expected conflictsWith warning"
  );
});

test("language-CI features point at existing snapshot files", async () => {
  const { features } = await loadRegistry();
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const snapDir = join(here, "..", "src", "snapshots", "github-workflows");
  for (const id of ["workflow.node-ci", "workflow.python-ci", "workflow.minimal-ci"]) {
    const f = features.find((x) => x.id === id);
    const name = f.options.workflowName.value;
    const body = await readFile(join(snapDir, `${name}.yml`), "utf8");
    assert.ok(body.includes("ci-success:"), `${name}.yml should define a ci-success job`);
    assert.ok(body.includes("@v1"), `${name}.yml must reference @v1 for installWorkflow validator`);
  }
});

// --- issue #16 / required gate + check map ---

test("required-gate feature is the default CI contract", async () => {
  const { features } = await loadRegistry();
  const gate = features.find((f) => f.id === "workflow.required-gate");

  assert.ok(gate, "workflow.required-gate feature missing");
  assert.equal(gate.group, "workflows.ci");
  assert.equal(gate.default, true);
  assert.ok(gate.requires.includes("remote.github"));
  assert.ok(gate.creates.includes(".github/workflows/repo-required-gate.yml"));
  assert.equal(gate.tasks[0], "installWorkflow");
  assert.equal(gate.options.workflowName.value, "repo-required-gate");
});

test("check-map feature is installed with agent foundations", async () => {
  const { features } = await loadRegistry();
  const checkMap = features.find((f) => f.id === "agent-workflow.check-map");

  assert.ok(checkMap, "agent-workflow.check-map feature missing");
  assert.equal(checkMap.group, "agent-workflow");
  assert.equal(checkMap.default, true);
  assert.ok(checkMap.creates.includes(".agent/check-map.yml"));
  assert.equal(checkMap.tasks[0], "writeCheckMap");
});

test("planning the required gate also plans the check map and avoids legacy CI warning", async () => {
  const plan = await buildPlan({
    selection: ["workflow.required-gate"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true } },
  });

  assert.ok(plan.selectedFeatureIds.includes("remote.github"));
  assert.ok(plan.selectedFeatureIds.includes("agent-workflow.check-map"));
  assert.ok(
    plan.files.some((f) => f.path === ".github/workflows/repo-required-gate.yml"),
    "required gate workflow should be planned"
  );
  assert.ok(
    plan.files.some((f) => f.path === ".agent/check-map.yml"),
    "check map should be planned"
  );
  assert.ok(
    !plan.warnings.some((w) => w.feature === "workflows.ci"),
    "required gate should satisfy the CI contract"
  );
});
