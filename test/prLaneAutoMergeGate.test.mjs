import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAutoMergeEligibility } from "../src/server/prlane/autoMergeGate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = JSON.parse(
  readFileSync(join(ROOT, "test", "fixtures", "contracts", "apply-set", "valid-agents-automerge.json"), "utf8"),
);
const PHRASE = "APPLY consumer-repo run-2026-06-09-0001";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function applySet(overrides = {}) {
  return {
    ...FIXTURE,
    guards: {
      ...FIXTURE.guards,
      requiredConfirmationPhraseHash: sha256(PHRASE),
      ...(overrides.guards ?? {}),
    },
    items: overrides.items ?? FIXTURE.items,
    repo: { ...FIXTURE.repo, ...(overrides.repo ?? {}) },
    sourceDecisionDoc: { ...FIXTURE.sourceDecisionDoc, ...(overrides.sourceDecisionDoc ?? {}) },
  };
}

function gateInput(overrides = {}) {
  const set = overrides.applySet ?? applySet();
  const { pr: prOverrides, ...rest } = overrides;
  return {
    applySet: set,
    confirmationPhrase: PHRASE,
    conflictAutoResolved: false,
    pr: {
      labels: ["automated-distribution"],
      body: [
        "Closes #123",
        `Decision doc fingerprint: ${set.sourceDecisionDoc.fingerprint}`,
      ].join("\n"),
      ...(prOverrides ?? {}),
    },
    requiredChecks: ["test"],
    checks: [{ name: "test", status: "passed" }],
    postApplyAudit: { clean: true },
    ...rest,
  };
}

test("autoMergeGate accepts the resolved agents ApplySet when all external gates are green", () => {
  const result = evaluateAutoMergeEligibility(gateInput());

  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasons, []);
});

test("autoMergeGate rejects confirmation and schema/scope mismatches fail closed", () => {
  assert.deepEqual(
    evaluateAutoMergeEligibility(gateInput({ confirmationPhrase: "APPLY another-repo run-2026-06-09-0001" })).reasons,
    ["confirmation-phrase-mismatch"],
  );

  const disallowedCategory = applySet({
    items: [{ ...FIXTURE.items[0], category: "skills" }],
  });
  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ applySet: disallowedCategory })).reasons, [
    "auto-merge-not-allowed-by-apply-set",
    "disallowed-category:skills",
  ]);

  const disallowedPath = applySet({
    items: [{ ...FIXTURE.items[0], file: "README.md" }],
  });
  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ applySet: disallowedPath })).reasons, [
    "disallowed-path:README.md",
  ]);
});

test("autoMergeGate rejects unresolved or conflict-autoresolved items", () => {
  const unresolved = applySet({
    items: [{ ...FIXTURE.items[0], resolution: "merge-manual" }],
  });

  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ applySet: unresolved })).reasons, [
    "unresolved-item:agents/AGENTS.md#2026-01-01-review-block",
  ]);

  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ conflictAutoResolved: true })).reasons, [
    "conflict-auto-resolved",
  ]);
});

test("autoMergeGate requires PR evidence, passing checks, and a clean post-apply audit", () => {
  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ pr: { labels: [] } })).reasons, [
    "missing-pr-label:automated-distribution",
  ]);

  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ pr: { body: "Closes #123" } })).reasons, [
    "missing-decision-doc-link",
  ]);

  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ checks: [{ name: "test", status: "pending" }] })).reasons, [
    "required-check-not-passing:test",
  ]);

  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ checks: [] })).reasons, [
    "required-check-missing:test",
  ]);

  assert.deepEqual(evaluateAutoMergeEligibility(gateInput({ postApplyAudit: { clean: false } })).reasons, [
    "post-apply-audit-not-clean",
  ]);
});
