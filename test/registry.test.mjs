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

test("plan.build closes over feature-id requires transitively", async () => {
  // required-gate requires the check-map feature (a real feature-id dependency)
  const plan = await buildPlan({
    selection: ["workflow.required-gate"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  assert.ok(plan.selectedFeatureIds.includes("agent-workflow.check-map"));
  assert.ok(!plan.selectedFeatureIds.includes("remote.github"), "must NOT pull in repo-create");
});

test("agent-workflow.anomaly-triage is a runtime feature, not coupled to repo-create", async () => {
  const { features, groups } = await loadRegistry();
  const triage = features.find((f) => f.id === "agent-workflow.anomaly-triage");
  assert.ok(triage, "anomaly-triage feature missing");
  assert.equal(triage.group, "agent-workflow");
  assert.equal(triage.remoteRequirement, "runtime");
  assert.ok(!(triage.requires || []).includes("remote.github"));
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
  assert.ok(agents.creates.includes(".agent/startup-baseline.json"));
  assert.ok(agents.creates.includes("docs/plans/README.md"));
});

test("planning anomaly-triage plans the workflow without repo-create", async () => {
  const plan = await buildPlan({
    selection: ["agent-workflow.anomaly-triage"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(!plan.selectedFeatureIds.includes("remote.github"));
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
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
    assert.equal(f.remoteRequirement, "runtime");
    assert.ok(!(f.requires || []).includes("remote.github"));
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
  assert.ok(
    !plan.warnings.some((w) => w.feature === "workflows.ci"),
    "should not warn about CI when one is selected"
  );
});

test("planner warns and flags conflict when two language-CI features are selected", async () => {
  // remote.github gives the plan a github target so the CI-contract block runs;
  // the conflictsWith warning fires regardless, the duplicate-CI warning needs a target.
  const plan = await buildPlan({
    selection: ["remote.github", "workflow.node-ci", "workflow.python-ci"],
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
  assert.equal(gate.remoteRequirement, "runtime");
  assert.ok(gate.requires.includes("agent-workflow.check-map"));
  assert.ok(!gate.requires.includes("remote.github"));
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

// --- issue #32 / repo-local coordination standard ---

test("coordination contract is a locked foundation that creates the README", async () => {
  const { features } = await loadRegistry();
  const coord = features.find((f) => f.id === "foundation.coordination");

  assert.ok(coord, "foundation.coordination feature missing");
  assert.equal(coord.group, "foundations");
  assert.equal(coord.locked, true);
  assert.equal(coord.default, true);
  assert.ok(coord.creates.includes(".agent/coordination/README.md"));
  assert.equal(coord.tasks[0], "writeCoordinationReadme");
});

test("coordination board is an opt-in agent-workflow feature", async () => {
  const { features } = await loadRegistry();
  const board = features.find((f) => f.id === "agent-workflow.coordination-board");

  assert.ok(board, "agent-workflow.coordination-board feature missing");
  assert.equal(board.group, "agent-workflow");
  assert.equal(board.default, false);
  assert.ok(!board.locked, "active board must not be locked on");
  assert.ok(board.creates.includes(".agent/coordination/board.md"));
  assert.equal(board.tasks[0], "writeCoordinationBoard");
});

test("coordination features point at existing snapshot files", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const snapDir = join(here, "..", "src", "snapshots", "repo-template", ".agent", "coordination");

  const readme = await readFile(join(snapDir, "README.md"), "utf8");
  assert.ok(readme.includes("coordination-isolated"), "README must state coordination-isolated");
  assert.ok(!/pigafetta/i.test(readme), "README must not name another repo");

  const board = await readFile(join(snapDir, "board.md"), "utf8");
  assert.ok(board.includes("Active claims"), "board must have an Active claims section");
  assert.ok(!/pigafetta/i.test(board), "board must not name another repo");
});

test("coordination contract is ordered before the initial commit", async () => {
  const plan = await buildPlan({
    selection: ["foundation.coordination", "foundation.git-init"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  const tasks = plan.ordered.map((u) => u.taskId);
  const readmeIdx = tasks.indexOf("writeCoordinationReadme");
  const commitIdx = tasks.indexOf("initGitAndCommit");
  assert.ok(readmeIdx !== -1, "writeCoordinationReadme should be planned");
  assert.ok(commitIdx !== -1, "initGitAndCommit should be planned");
  assert.ok(readmeIdx < commitIdx, "the coordination contract must land in the initial commit");
});

test("all local file-writing tasks are ordered before the initial push", async () => {
  const { features } = await loadRegistry();
  const selection = features.filter((feature) => feature.default).map((feature) => feature.id);
  if (!selection.includes("remote.github")) selection.push("remote.github");

  const plan = await buildPlan({
    selection,
    context: {
      targetPath: "X",
      owner: "ArchonVII",
      repo: "r",
      visibility: "private",
      capabilities: {
        "gh.repoCreateAllowed": true,
        "gh.branchProtectionAllowed": true,
      },
    },
  });

  const tasks = plan.ordered.map((unit) => unit.taskId);
  const initIndex = tasks.indexOf("initGitAndCommit");
  const pushIndex = tasks.indexOf("ghRepoCreateAndPush");
  assert.ok(initIndex > tasks.indexOf("writeCheckMap"));
  assert.ok(initIndex > tasks.lastIndexOf("installWorkflow"));
  assert.ok(pushIndex > initIndex);
  assert.ok(tasks.indexOf("applyLabels") > pushIndex);
  assert.ok(tasks.indexOf("applyBaselineBranchProtection") > tasks.indexOf("applyLabels"));
});

test("planning the required gate also plans the check map and avoids legacy CI warning", async () => {
  const plan = await buildPlan({
    selection: ["workflow.required-gate"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: { "gh.repoCreateAllowed": true } },
  });

  assert.ok(!plan.selectedFeatureIds.includes("remote.github"), "required gate alone does not create a repo");
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

// --- #48: remoteRequirement gate + repo target ---

test("workflow alone: installs locally, no repo-create, non-blocking runtime warning", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(plan.ordered.some((u) => u.taskId === "installWorkflow"));
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  const runtimeWarn = plan.warnings.filter((w) => w.feature === "remote.runtime");
  assert.equal(runtimeWarn.length, 1, "exactly one deduped runtime warning");
  assert.equal(runtimeWarn[0].severity, "warn");
  assert.equal(runtimeWarn[0].blocking, false);
});

test("workflow needs no gh.authenticated (no blocking auth warning)", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(!plan.warnings.some((w) => w.blocking && /capability/.test(w.message)));
});

test("multiple runtime features with no target -> one deduped runtime warning", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy", "workflow.branch-naming", "agent-workflow.anomaly-triage"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.equal(plan.warnings.filter((w) => w.feature === "remote.runtime").length, 1);
});

test("api-target with no target and no remote.github -> blocking error", async () => {
  const plan = await buildPlan({
    selection: ["remote.labels"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  const err = plan.warnings.find((w) => w.feature === "remote.labels" && w.severity === "error");
  assert.ok(err, "expected blocking error diagnostic");
  assert.equal(err.blocking, true);
  assert.ok(!plan.warnings.some((w) => w.feature === "remote.runtime"), "no misleading runtime warning");
});

test("api-target with detected origin -> known target, no repo-create", async () => {
  const plan = await buildPlan({
    selection: ["remote.labels"],
    options: {},
    context: {
      targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {},
      originDetected: { owner: "ArchonVII", repo: "example" },
    },
  });
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  assert.equal(plan.context.owner, "ArchonVII");
  assert.equal(plan.context.repo, "example");
  assert.equal(plan.context.githubRepoTarget.status, "known");
  assert.ok(!plan.warnings.some((w) => w.feature === "remote.labels" && w.severity === "error"));
});

test("remote.github + remote.labels: create present, labels phase-ordered after", async () => {
  const plan = await buildPlan({
    selection: ["remote.github", "remote.labels", "foundation.git-init"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  const tasks = plan.ordered.map((u) => u.taskId);
  assert.ok(tasks.includes("ghRepoCreateAndPush"));
  assert.ok(tasks.indexOf("applyLabels") > tasks.indexOf("ghRepoCreateAndPush"));
});

test("api-target + will-create with empty identity -> blocking error", async () => {
  const plan = await buildPlan({
    selection: ["remote.github", "remote.labels", "foundation.git-init"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(plan.warnings.some((w) => w.feature === "remote.labels" && w.severity === "error"));
});

// --- #103: doc-sweep feature ---

test("doc-sweep is a locked default agent-workflow feature installing the runner + spec", async () => {
  const { features } = await loadRegistry();
  const ds = features.find((f) => f.id === "agent-workflow.doc-sweep");
  assert.ok(ds, "agent-workflow.doc-sweep feature missing");
  assert.equal(ds.group, "agent-workflow");
  assert.equal(ds.default, true);
  assert.equal(ds.locked, true);
  assert.equal(ds.tasks[0], "writeDocSweep");
  for (const f of [
    "scripts/doc-sweep/lib.mjs",
    "scripts/doc-sweep/git.mjs",
    "scripts/doc-sweep/sweep.mjs",
    "docs/agent-process/doc-sweep.md",
  ]) {
    assert.ok(ds.creates.includes(f), `doc-sweep creates ${f}`);
  }
  assert.ok(!(ds.requires || []).includes("remote.github"), "doc-sweep must not pull in repo-create");
});

test("doc-sweep points at existing snapshot files and lands in the initial commit", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const snapDir = join(here, "..", "src", "snapshots", "repo-template");
  for (const f of ["scripts/doc-sweep/lib.mjs", "scripts/doc-sweep/sweep.mjs", "docs/agent-process/doc-sweep.md"]) {
    const body = await readFile(join(snapDir, f), "utf8");
    assert.ok(body.length > 0, `${f} snapshot present`);
  }
  const agents = await readFile(join(snapDir, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("## Doc Sweep-Up"), "AGENTS.md snapshot ships the Doc Sweep-Up contract");

  const plan = await buildPlan({
    selection: ["agent-workflow.doc-sweep", "foundation.git-init"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  const tasks = plan.ordered.map((u) => u.taskId);
  assert.ok(tasks.includes("writeDocSweep"), "writeDocSweep should be planned");
  assert.ok(
    tasks.indexOf("writeDocSweep") < tasks.indexOf("initGitAndCommit"),
    "the doc-sweep runner must land in the initial commit"
  );
});

test("doc-orphan-detector is an opt-in runtime cron caller pinned to @v1", async () => {
  const { features } = await loadRegistry();
  const cron = features.find((f) => f.id === "agent-workflow.doc-orphan-detector");
  assert.ok(cron, "agent-workflow.doc-orphan-detector feature missing");
  assert.equal(cron.group, "agent-workflow");
  assert.equal(cron.default, false);
  assert.ok(!cron.locked, "the cron backstop is opt-in, not locked");
  assert.equal(cron.remoteRequirement, "runtime");
  assert.ok(!(cron.requires || []).includes("remote.github"));
  assert.equal(cron.tasks[0], "installWorkflow");
  assert.equal(cron.options.workflowName.value, "doc-orphan-detector");
  assert.ok(cron.creates.includes(".github/workflows/doc-orphan-detector.yml"));

  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const body = await readFile(
    join(here, "..", "src", "snapshots", "github-workflows", "doc-orphan-detector.yml"),
    "utf8"
  );
  assert.ok(body.includes("@v1"), "caller must reference the reusable at @v1 (workflowReferencesPinnedV1)");
});

test("planning doc-orphan-detector installs the caller without repo-create", async () => {
  const plan = await buildPlan({
    selection: ["agent-workflow.doc-orphan-detector"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  assert.ok(
    plan.files.some((f) => f.path === ".github/workflows/doc-orphan-detector.yml"),
    "doc-orphan-detector caller should be planned for creation"
  );
});
