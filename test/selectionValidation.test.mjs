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
import { renderSelectionAwareSeed } from "../src/server/tasks/selectionAwareMarkdown.mjs";

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

test("selection validation reports runtime imports outside the selected install closure", async () => {
  const validation = await validateSelectionSurface({
    selectedFeatureIds: ["foundation.example"],
    features: [
      {
        id: "foundation.example",
        installs: [{ path: "scripts/main.mjs", source: "repo-template:scripts/main.mjs", kind: "file", contract: "required" }],
      },
    ],
    baseline: { version: "test", required: ["scripts/main.mjs"], expectedDirectories: [], legacy: [] },
    readSnapshot: async () => "import './missing.mjs';\n",
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.findings, [
    {
      code: "dangling-selected-runtime-import",
      sourcePath: "scripts/main.mjs",
      targetPath: "scripts/missing.mjs",
      message: "scripts/main.mjs imports scripts/missing.mjs, but the selected feature closure does not install that runtime file.",
    },
  ]);
});

test("documentation runtime imports are conditional only until the doc-map is selected", async () => {
  const runtime = {
    id: "agent-workflow.health",
    installs: [{ path: "scripts/health.mjs", source: "repo-template:scripts/health.mjs", kind: "file", contract: "required" }],
  };
  const readSnapshot = async (path) => path === "scripts/health.mjs"
    ? "await import('./docs/lib.mjs');\n"
    : [
        "version: 1",
        "generated:",
        "checked:",
        "human:",
        "required:",
        "  base:",
        "code_roots:",
        "",
      ].join("\n");

  const withoutDocMap = await validateSelectionSurface({
    selectedFeatureIds: [runtime.id],
    features: [runtime],
    baseline: { version: "test", required: ["scripts/health.mjs"], expectedDirectories: [], legacy: [] },
    readSnapshot,
  });
  assert.equal(withoutDocMap.ok, true);

  const withDocMap = await validateSelectionSurface({
    selectedFeatureIds: [runtime.id, "foundation.docs"],
    features: [
      runtime,
      {
        id: "foundation.docs",
        installs: [{ path: ".agent/doc-map.yml", source: "repo-template:.agent/doc-map.yml", kind: "file", contract: "required" }],
      },
    ],
    baseline: { version: "test", required: ["scripts/health.mjs", ".agent/doc-map.yml"], expectedDirectories: [], legacy: [] },
    readSnapshot,
  });
  assert.deepEqual(withDocMap.findings, [
    {
      code: "dangling-selected-runtime-import",
      sourcePath: "scripts/health.mjs",
      targetPath: "scripts/docs/lib.mjs",
      message: "scripts/health.mjs imports scripts/docs/lib.mjs, but the selected feature closure does not install that runtime file.",
    },
  ]);
});

test("selection validation reports doc-map generators without selected package scripts", async () => {
  const validation = await validateSelectionSurface({
    selectedFeatureIds: ["foundation.example"],
    features: [
      {
        id: "foundation.example",
        installs: [
          { path: ".agent/doc-map.yml", source: "repo-template:.agent/doc-map.yml", kind: "file", contract: "required" },
          { path: "docs/INDEX.md", source: "repo-template:docs/INDEX.md", kind: "file", contract: "required" },
        ],
      },
    ],
    baseline: { version: "test", required: [".agent/doc-map.yml", "docs/INDEX.md"], expectedDirectories: [], legacy: [] },
    readSnapshot: async (path) => path === ".agent/doc-map.yml"
      ? [
          "version: 1",
          "generated:",
          "  - path: docs/INDEX.md",
          "    class: committed",
          "    generator: docs:render",
          "    block: index-pages",
          "    inputs: [\"docs/**/*.md\"]",
          "checked:",
          "human:",
          "required:",
          "  base:",
          "    - docs/INDEX.md",
          "code_roots:",
          "  docs: self",
          "",
        ].join("\n")
      : "# Index\n",
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.findings, [
    {
      code: "missing-selected-package-script",
      sourcePath: ".agent/doc-map.yml",
      command: "docs:render",
      message: ".agent/doc-map.yml references npm script docs:render, but the selected feature closure does not provide it.",
    },
  ]);
});

test("consumer-owned documentation seeds omit links to unselected provider pages", () => {
  const installed = new Set(["docs/CANON.md", "docs/INDEX.md"]);
  const canon = renderSelectionAwareSeed(
    [
      "---",
      "relates:",
      '  - "[[INDEX]]"',
      '  - "[[LIBRARIAN]]"',
      "---",
      "",
      "Read [INDEX](INDEX.md).",
      "",
      "Read [LIBRARIAN](LIBRARIAN.md).",
      "",
    ].join("\n"),
    "docs/CANON.md",
    installed
  );
  assert.match(canon, /\[\[INDEX\]\]/);
  assert.match(canon, /\[INDEX\]\(INDEX\.md\)/);
  assert.doesNotMatch(canon, /LIBRARIAN/);

  const index = renderSelectionAwareSeed(
    "# Index\n\n- [CANON](CANON.md)\n- [LIBRARIAN](LIBRARIAN.md)\n",
    "docs/INDEX.md",
    installed
  );
  assert.match(index, /\[CANON\]\(CANON\.md\)/);
  assert.doesNotMatch(index, /LIBRARIAN/);
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
