import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCloseScanScope, evaluateRequiredChecks } from "../scripts/close/lib.mjs";

// The refreshed provider removed automatic local full-suite execution. Verify
// the actual boundary: focused local policy checks remain, and required CI
// cannot be substituted by a successful local scan.
test("close keeps focused checks locally and requires successful CI", () => {
  const scope = classifyCloseScanScope({
    files: ["scripts/close/ci-guard.mjs", ".agent/check-map.yml"],
    labels: [],
    stack: "node",
  });
  const checks = scope.requiredChecks.map((check) => check.name);
  assert.ok(checks.includes("policy-validation"));
  assert.ok(!checks.includes("node-test"));
  assert.equal(evaluateRequiredChecks({ checkRuns: [] }).ok, false);
  assert.equal(evaluateRequiredChecks({ checkRuns: [{
    name: "repo-required-gate / decision", status: "completed", conclusion: "failure",
  }] }).ok, false);
  assert.equal(evaluateRequiredChecks({ checkRuns: [{
    name: "repo-required-gate / decision", status: "completed", conclusion: "success",
  }] }).ok, true);
});
