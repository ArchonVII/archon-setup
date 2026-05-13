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
