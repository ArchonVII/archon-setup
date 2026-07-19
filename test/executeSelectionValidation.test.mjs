import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { executePlan } from "../src/server/executor/executePlan.mjs";
import { buildPlan } from "../src/server/planner/buildPlan.mjs";

test("shared plan execution refuses a selection-contract finding before writes", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-execute-selection-"));
  const plan = await buildPlan({
    selection: ["foundation.readme"],
    options: {},
    context: {
      targetPath,
      owner: "",
      repo: "",
      visibility: "private",
      capabilities: {},
      sourceSnapshots: {},
    },
  });
  const selectionValidation = {
    ok: false,
    selectedFeatureIds: plan.selectedFeatureIds,
    baselineVersion: "test",
    checked: { baselineRequiredPaths: 1, repoTemplateMarkdownSources: 1 },
    findings: [
      {
        code: "dangling-selected-markdown-link",
        sourcePath: "README.md",
        targetPath: "docs/missing.md",
        message: "README.md links to docs/missing.md, but the selected feature closure does not install that target.",
      },
    ],
  };

  const result = await executePlan(plan, {
    validateSelection: async () => selectionValidation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.selectionValidation, selectionValidation);
  assert.equal(result.blockingWarnings[0].feature, "onboarding.selection-contract");
  await assert.rejects(access(join(targetPath, "README.md")));
});
