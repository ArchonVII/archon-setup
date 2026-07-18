import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { loadRegistry } from "../src/server/planner/buildPlan.mjs";
import { loadProfileFeatures } from "../src/server/tasks/startupBaseline.mjs";
import {
  selectionValidationWarnings,
  validateSelectionSurface,
  validateSelectedRepoTemplateSurface,
} from "../src/server/onboard/selectionValidation.mjs";

test("selection validation reports a baseline path outside the selected install closure", async () => {
  const validation = await validateSelectionSurface({
    selectedFeatureIds: ["foundation.example"],
    features: [
      {
        id: "foundation.example",
        installs: [{ path: "AGENTS.md", source: "repo-template:AGENTS.md", contract: "required" }],
      },
    ],
    baseline: {
      version: "test",
      required: ["AGENTS.md", "docs/missing.md"],
      expectedDirectories: [],
      legacy: [],
    },
    readSnapshot: async () => "No links here.\n",
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.findings, [
    {
      code: "missing-selected-baseline-path",
      path: "docs/missing.md",
      message: "Generated startup baseline requires docs/missing.md, but the selected feature closure does not install it.",
    },
  ]);
  assert.deepEqual(selectionValidationWarnings(validation), [
    {
      feature: "onboarding.selection-contract",
      code: "missing-selected-baseline-path",
      path: "docs/missing.md",
      message: "Generated startup baseline requires docs/missing.md, but the selected feature closure does not install it.",
      severity: "error",
      blocking: true,
    },
  ]);
});

test("selection validation reports relative Markdown links outside the selected install closure", async () => {
  const validation = await validateSelectionSurface({
    selectedFeatureIds: ["foundation.example"],
    features: [
      {
        id: "foundation.example",
        installs: [{ path: "docs/start.md", source: "repo-template:docs/start.md", contract: "required" }],
      },
    ],
    baseline: {
      version: "test",
      required: ["docs/start.md"],
      expectedDirectories: ["docs/"],
      legacy: [],
    },
    readSnapshot: async () =>
      "The syntax `[example](ignored.md)` is illustrative. Read [`the missing contract`](missing.md#rules).\n",
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.findings, [
    {
      code: "dangling-selected-markdown-link",
      sourcePath: "docs/start.md",
      targetPath: "docs/missing.md",
      message: "docs/start.md links to docs/missing.md, but the selected feature closure does not install that target.",
    },
  ]);
});

test("every named profile has a closed startup and repo-template link surface", async () => {
  const { profiles } = await loadRegistry();
  for (const profile of profiles.profiles) {
    const validation = await validateSelectedRepoTemplateSurface(profile.features);
    assert.equal(validation.ok, true, `${profile.id}: ${JSON.stringify(validation.findings)}`);
    assert.deepEqual(validation.findings, []);
  }
});

test("every individually selectable feature has a closed repo-template link surface", async () => {
  const { features } = await loadRegistry();
  for (const feature of features.filter((candidate) => !candidate.disabled)) {
    const validation = await validateSelectedRepoTemplateSurface([feature.id]);
    assert.equal(validation.ok, true, `${feature.id}: ${JSON.stringify(validation.findings)}`);
  }
});

test("runOnboard exposes selection validation in dry-run and audit results", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-selection-validation-"));
  const features = await loadProfileFeatures("docs-min");

  const dryRun = await runOnboard({ targetPath, features, dryRun: true });
  assert.equal(dryRun.selectionValidation.ok, true);
  assert.deepEqual(dryRun.selectionValidation.findings, []);

  const audit = await runOnboard({ targetPath, features, audit: true });
  assert.equal(audit.selectionValidation.ok, true);
  assert.deepEqual(audit.selectionValidation.findings, []);
});
