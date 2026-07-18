import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { SOURCES } from "../scripts/refresh-snapshots.mjs";
import { validate, assertSchemaSupported } from "../src/contracts/validate.mjs";
import {
  SCRIPT_FILES,
  AGENT_SCRIPTS,
  CLOSE_SCAN_IGNORE,
} from "../src/server/tasks/writeAgentLifecycle.mjs";
import { HOOK_FILES } from "../src/server/tasks/writeGithooks.mjs";
import { TEMPLATE_LIBRARY_FILES } from "../src/server/tasks/writeTemplateLibrary.mjs";
import { AGENTS_MANAGED_FILES } from "../src/server/tasks/writeAgentsMd.mjs";
import { REQUIRED_GITIGNORE_LINES } from "../src/server/tasks/writeFrictionLedger.mjs";
import { DOC_SYSTEM_FILES } from "../src/server/tasks/writeDocSystem.mjs";

// Lane C1 (#351): the capability manifest (`installs[]` in features.json) is the
// single home for "which feature installs which files". This test proves the
// three pre-existing hand-maintained list families are still exact mirrors of
// it, so any future drift fails CI instead of silently diverging (subsumes the
// drift class of #239 / #257). Zero behavior change — data + assertions only.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

const features = JSON.parse(
  await readFile(join(REPO_ROOT, "src/registry/features.json"), "utf8")
);
const schema = JSON.parse(
  await readFile(join(REPO_ROOT, "src/registry/schema.json"), "utf8")
);

const featureById = (id) => {
  const f = features.find((x) => x.id === id);
  assert.ok(f, `feature ${id} missing from features.json`);
  return f;
};
const sorted = (a) => [...a].sort();
// Every install path this feature OWNS as a whole file/dir (kind file|dir).
// Merge entries (package.json, .gitignore) are excluded — they are real installs
// but not files the feature creates, so they never appear in creates[].
const fileDirPaths = (feature) =>
  (feature.installs || []).filter((i) => i.kind === "file" || i.kind === "dir").map((i) => i.path);

const REPO_TEMPLATE = SOURCES.find((s) => s.key === "repoTemplate");

// ---------------------------------------------------------------------------
// snapshotExtras: repo-template copyFiles the vendor snapshot ships for its own
// surfaces (nav front doors, wiki scaffold, reference copies) that NO onboarding
// feature installs — so they are legitimately absent from every installs[].source
// yet must not trip the reverse-coverage check below. One justification per entry,
// sourced from the inline comments in scripts/refresh-snapshots.mjs.
// ---------------------------------------------------------------------------
const SNAPSHOT_EXTRAS = [
  // Human + agent navigation front doors (repo-template#94). foundation.readme
  // generates README from the org STARTER template, not this reference copy.
  "README.md",
  "llms.txt",
  // Reference/inventory docs the snapshot ships for repo-template's own surfaces;
  // no onboarding feature installs them.
  "docs/template-library-inventory.md",
  "docs/agent-process/project-capsules.md",
  // Librarian wiki front-door + scaffold pages (repo-template#94): wiki:doctor
  // presence targets, not onboarding installs.
  "projects/README.md",
  "docs/LIBRARIAN.md",
  "docs/project-status.md",
  "docs/raw/README.md",
  "docs/audits/README.md",
  // repo-template's own package.json. agent-lifecycle.baseline MERGES managed
  // npm scripts into the target (kind:"merge"); it never copies this file, so it
  // is not an install source.
  "package.json",
  // foundation.codeowners GENERATES `* @<owner>` at onboard time; this vendored
  // snapshot is a reference copy, not the install source.
  ".github/CODEOWNERS",
  // agent-workflow.anomaly-triage installs the github-workflows @v1 caller
  // (src/snapshots/github-workflows/anomaly-triage.yml), so this repo-template
  // reference copy is a genuine extra. foundation.actionlint, by contrast, has
  // NO github-workflows caller — it installs FROM repo-template (snapshotSource:
  // "repo-template"), so .github/workflows/actionlint.yml is a real
  // installs[].source, not an extra, and must NOT be listed here.
  ".github/workflows/anomaly-triage.yml",
  // Wiki-lint workflow: no onboarding feature installs it.
  ".github/workflows/wiki-lint.yml",
];

// ---------------------------------------------------------------------------
// 3a — creates[] is a validated projection of installs[]
// ---------------------------------------------------------------------------
test("every feature's creates[] equals the file/dir projection of its installs[]", () => {
  for (const feature of features) {
    const creates = feature.creates || [];
    const installs = feature.installs || [];
    const installPaths = new Set(installs.map((i) => i.path));

    // A: no create without a backing install of the same path (any kind — a
    // create can be backed by a merge, e.g. agent-lifecycle's package.json).
    for (const c of creates) {
      assert.ok(installPaths.has(c), `${feature.id}: creates[] "${c}" has no matching installs[] entry`);
    }
    // B: no file/dir install missing from creates[]. Together with A this makes
    // creates[] === { file/dir installs } ∪ { merge installs already in creates }.
    for (const p of fileDirPaths(feature)) {
      assert.ok(creates.includes(p), `${feature.id}: installs[] file/dir "${p}" is not in creates[]`);
    }
  }
});

test("every install path is unique within a feature", () => {
  for (const feature of features) {
    const paths = (feature.installs || []).map((i) => i.path);
    assert.equal(new Set(paths).size, paths.length, `${feature.id}: duplicate installs[].path`);
  }
});

// ---------------------------------------------------------------------------
// 3b — repo-template sources agree with refresh-snapshots SOURCES
// ---------------------------------------------------------------------------
test("every repo-template installs[].source is covered by refresh-snapshots SOURCES.repoTemplate", () => {
  const copyFiles = new Set(REPO_TEMPLATE.copyFiles || []);
  const copyDirs = REPO_TEMPLATE.copyDirs || [];
  const coveredByDir = (rel) => copyDirs.some((d) => rel === d || rel.startsWith(`${d}/`));

  for (const feature of features) {
    for (const install of feature.installs || []) {
      if (!install.source || !install.source.startsWith("repo-template:")) continue;
      const rel = install.source.slice("repo-template:".length);
      assert.ok(
        copyFiles.has(rel) || coveredByDir(rel),
        `${feature.id}: repo-template source "${rel}" is neither a copyFiles entry nor under a copyDirs prefix`
      );
    }
  }
});

test("every repo-template copyFiles entry is an installs[].source or a justified snapshotExtra", () => {
  const referenced = new Set();
  for (const feature of features) {
    for (const install of feature.installs || []) {
      if (install.source && install.source.startsWith("repo-template:")) {
        referenced.add(install.source.slice("repo-template:".length));
      }
    }
  }
  const extras = new Set(SNAPSHOT_EXTRAS);

  // Every copyFiles entry is accounted for exactly once (feature source XOR extra).
  for (const rel of REPO_TEMPLATE.copyFiles || []) {
    const isRef = referenced.has(rel);
    const isExtra = extras.has(rel);
    assert.ok(isRef || isExtra, `copyFiles "${rel}" is neither an installs[].source nor a snapshotExtra — add an installs[] entry or justify it in SNAPSHOT_EXTRAS`);
    assert.ok(!(isRef && isExtra), `copyFiles "${rel}" is both an installs[].source and a snapshotExtra — remove the redundant SNAPSHOT_EXTRAS entry`);
  }

  // No stale allowlist: every snapshotExtra must still be a real copyFiles entry.
  const copyFiles = new Set(REPO_TEMPLATE.copyFiles || []);
  for (const rel of SNAPSHOT_EXTRAS) {
    assert.ok(copyFiles.has(rel), `SNAPSHOT_EXTRAS "${rel}" is no longer in refresh-snapshots copyFiles — drop it`);
  }
});

// Provider prefix -> committed snapshot root. Fail-closed: a source naming a
// provider not listed here fails the existence test below rather than silently
// passing, so a new snapshot family (or a mislabeled provider, e.g. PR #355's
// actionlint pointing at github-workflows where the file only lives under
// repo-template) can't slip through unvalidated.
const SNAPSHOT_ROOTS = {
  "repo-template": "src/snapshots/repo-template",
  "github-workflows": "src/snapshots/github-workflows",
};

test("every installs[].source resolves to an existing file in its named snapshot", async () => {
  for (const feature of features) {
    for (const install of feature.installs || []) {
      if (!install.source) continue; // merge installs (package.json/.gitignore) carry no source
      const idx = install.source.indexOf(":");
      assert.ok(idx > 0, `${feature.id}: malformed installs[].source "${install.source}" (expected "<provider>:<path>")`);
      const provider = install.source.slice(0, idx);
      const rel = install.source.slice(idx + 1);
      const root = SNAPSHOT_ROOTS[provider];
      assert.ok(root, `${feature.id}: unknown source provider "${provider}" in "${install.source}" — add it to SNAPSHOT_ROOTS`);
      const abs = join(REPO_ROOT, root, ...rel.split("/"));
      await assert.doesNotReject(
        access(abs, constants.F_OK),
        `${feature.id}: snapshot file missing for source "${install.source}" (looked under ${root})`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3c — per-task path constants agree with the manifest
// ---------------------------------------------------------------------------
test("writeAgentLifecycle SCRIPT_FILES === agent-lifecycle.baseline file installs", () => {
  const lifecycle = featureById("agent-lifecycle.baseline");
  assert.deepEqual(sorted(fileDirPaths(lifecycle)), sorted(SCRIPT_FILES));
});

test("writeAgentLifecycle AGENT_SCRIPTS === agent-lifecycle.baseline package.json merge npmScripts", () => {
  const lifecycle = featureById("agent-lifecycle.baseline");
  const pkg = (lifecycle.installs || []).find((i) => i.path === "package.json" && i.kind === "merge");
  assert.ok(pkg, "agent-lifecycle.baseline is missing its package.json merge install");
  assert.deepEqual(pkg.npmScripts, AGENT_SCRIPTS);
});

test("writeAgentLifecycle CLOSE_SCAN_IGNORE === agent-lifecycle.baseline .gitignore merge append", () => {
  const lifecycle = featureById("agent-lifecycle.baseline");
  const gi = (lifecycle.installs || []).find((i) => i.path === ".gitignore" && i.kind === "merge");
  assert.ok(gi, "agent-lifecycle.baseline is missing its .gitignore merge install");
  assert.deepEqual(gi.appends, [CLOSE_SCAN_IGNORE]);
});

test("writeGithooks HOOK_FILES === foundation.hooks file installs", () => {
  const hooks = featureById("foundation.hooks");
  assert.deepEqual(sorted(fileDirPaths(hooks)), sorted(HOOK_FILES));
});

test("foundation.hooks installs are all marked executable", () => {
  const hooks = featureById("foundation.hooks");
  for (const install of hooks.installs || []) {
    assert.equal(install.execBit, true, `${install.path} must carry execBit:true`);
  }
});

test("writeTemplateLibrary TEMPLATE_LIBRARY_FILES === template-library file installs", () => {
  const tl = featureById("agent-workflow.template-library");
  assert.deepEqual(sorted(fileDirPaths(tl)), sorted(TEMPLATE_LIBRARY_FILES));
});

test("writeAgentsMd AGENTS_MANAGED_FILES === foundation.agents file installs", () => {
  const agents = featureById("foundation.agents");
  assert.deepEqual(sorted(fileDirPaths(agents)), sorted(AGENTS_MANAGED_FILES));
});

test("writeDocSystem DOC_SYSTEM_FILES === foundation.doc-system file installs", () => {
  const docSystem = featureById("foundation.doc-system");
  assert.deepEqual(sorted(fileDirPaths(docSystem)), sorted(DOC_SYSTEM_FILES));
  assert.equal(docSystem.docFloor, true);
});

test("writeFrictionLedger REQUIRED_GITIGNORE_LINES === friction-ledger .gitignore merge append", () => {
  const friction = featureById("foundation.friction-ledger");
  const gi = (friction.installs || []).find((i) => i.path === ".gitignore" && i.kind === "merge");
  assert.ok(gi, "foundation.friction-ledger is missing its .gitignore merge install");
  assert.deepEqual(gi.appends, REQUIRED_GITIGNORE_LINES);
});

// ---------------------------------------------------------------------------
// installs[] shape is mechanically enforced (not just documented in schema.json)
// ---------------------------------------------------------------------------
test("the installs[] sub-schema stays within the zero-dep validator's supported subset", () => {
  const installsSchema = schema.properties?.installs;
  assert.ok(installsSchema, "schema.json is missing properties.installs");
  // Fail-closed: a future edit that adds an unsupported keyword throws here.
  assertSchemaSupported(installsSchema);
});

test("every feature's installs[] validates against the installs[] sub-schema", () => {
  const installsSchema = schema.properties.installs;
  for (const feature of features) {
    if (!feature.installs) continue;
    const result = validate(installsSchema, feature.installs);
    assert.ok(
      result.valid,
      `${feature.id}: installs[] fails schema — ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`
    );
  }
});

test("required merge entries carry npmScripts/appends and no source", () => {
  for (const feature of features) {
    for (const install of feature.installs || []) {
      if (install.kind !== "merge") continue;
      assert.ok(!install.source, `${feature.id}: merge install "${install.path}" must not carry a source`);
      assert.ok(
        install.npmScripts || install.appends,
        `${feature.id}: merge install "${install.path}" must carry npmScripts or appends`
      );
    }
  }
});

// Tracks the pre-existing full-registry validation gap (#351 PR body): schema.json
// still uses the JSON-Schema `default` keyword, which the zero-dep validator
// (src/contracts/validate.mjs) rejects by policy, so we cannot yet run
// assertSchemaSupported over the WHOLE registry schema. When the schema is
// migrated off `default` (follow-up), this expectation flips and full-registry
// validation can replace the installs-only scoping above.
test("full registry schema is not yet machine-validatable (known gap — see PR #351 follow-up)", () => {
  assert.throws(() => assertSchemaSupported(schema), /unsupported schema keyword "default"/);
});
