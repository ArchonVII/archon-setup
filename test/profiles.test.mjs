import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSchemaSupported, validate } from "../src/contracts/validate.mjs";
import { loadRegistry, buildPlan, resolveProfileId } from "../src/server/planner/buildPlan.mjs";
import {
  BASELINE_VERSION_BASE,
  deriveExpectedDirectories,
  generateStartupBaseline,
  loadProfileFeatures,
  serializeStartupBaseline,
} from "../src/server/tasks/startupBaseline.mjs";

// Lane C2 (#352): named baseline profiles + per-selection startup-baseline
// generation. These tests pin (a) profiles.json is machine-validated fail-closed,
// (b) every tier resolves through buildPlan, (c) the tier nesting matches the
// owner decision, and (d) the CONTINUITY invariant: the agent-standard floor
// equals the historical 23-path baseline plus the 3 newly-required closeout
// scripts (26 paths + 6 directories).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_DIR = join(ROOT, "src", "registry");
const FIXTURES_DIR = join(ROOT, "test", "fixtures", "profiles");
const loadJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const { features, profiles, profilesSchema } = await loadRegistry();
const AGENT_STANDARD = await loadProfileFeatures("agent-standard");

// The nine locked/default foundations (docs-min), verified against the registry.
const DOCS_MIN_FEATURES = features.filter((f) => f.default).map((f) => f.id);
// The eight features agent-standard adds on top of docs-min (owner decision
// 2026-07-11, design doc §2).
const AGENT_STANDARD_ADDITIONS = [
  "agent-lifecycle.baseline",
  "agent-workflow.check-map",
  "agent-workflow.anomaly-triage",
  "agent-workflow.doc-sweep",
  "agent-workflow.doc-health",
  "foundation.pr-template",
  "workflow.required-gate",
  "foundation.hooks",
];
// The eight features flagship adds on top of agent-standard (owner decision).
const FLAGSHIP_ADDITIONS = [
  "foundation.friction-ledger",
  "foundation.changelog",
  "foundation.codeowners",
  "foundation.dependabot",
  "agent-workflow.template-library",
  "agent-workflow.coordination-board",
  "remote.labels",
  "remote.branch-protection",
];

// The pre-C2 startup-baseline.required floor (23 paths incl. package.json) — the
// historical contract, pinned here so a floor regression is caught. Source:
// src/snapshots/repo-template/.agent/startup-baseline.json required[] at ff142cf.
const HISTORICAL_REQUIRED_23 = [
  "AGENTS.md",
  "docs/plans/README.md",
  "docs/agent-process/document-policy.md",
  "docs/agent-process/doc-health.md",
  ".agent/check-map.yml",
  ".agent/coordination/README.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/anomaly-triage.yml",
  "package.json",
  "scripts/agent/lib.mjs",
  "scripts/agent/start-task.mjs",
  "scripts/agent/status.mjs",
  "scripts/agent/prune.mjs",
  "scripts/agent/pr-body.mjs",
  "scripts/close/lib.mjs",
  "scripts/close/scan-complete.mjs",
  "scripts/close/ci-guard.mjs",
  "scripts/doc-sweep/lib.mjs",
  "scripts/doc-sweep/git.mjs",
  "scripts/doc-sweep/sweep.mjs",
  "scripts/doc-health/lib.mjs",
  "scripts/doc-health/health.mjs",
  "docs/agent-process/doc-sweep.md",
];
// Flipped to contract:"required" this lane (owner decision 2026-07-11): the
// closeout commands AGENTS.md mandates.
const NEWLY_REQUIRED_SCRIPTS = [
  "scripts/pr-contract.mjs",
  "scripts/agent-close-preflight.mjs",
  "scripts/agent-pr-ready.mjs",
];
// Source: pre-C2 startup-baseline.json expectedDirectories[6].
const HISTORICAL_DIRECTORIES_6 = [
  "docs/plans/",
  "docs/agent-process/",
  "scripts/agent/",
  "scripts/close/",
  "scripts/doc-sweep/",
  "scripts/doc-health/",
];

// ---------------------------------------------------------------------------
// profiles.json is machine-validated, fail-closed
// ---------------------------------------------------------------------------
test("profiles.schema.json stays within the zero-dep validator's supported subset", () => {
  assertSchemaSupported(profilesSchema);
});

test("shipped profiles.json validates against profiles.schema.json", () => {
  assert.deepEqual(validate(profilesSchema, profiles).errors, []);
});

test("every profile feature id exists in features.json", () => {
  const known = new Set(features.map((f) => f.id));
  for (const profile of profiles.profiles) {
    for (const id of profile.features) {
      assert.ok(known.has(id), `profile ${profile.id} references unknown feature ${id}`);
    }
  }
});

// ---------------------------------------------------------------------------
// golden valid/invalid fixtures (contractSchemas pattern)
// ---------------------------------------------------------------------------
const INVALID_FIXTURES = {
  "invalid-wrong-schema-version.json": "schemaVersion: expected const 1",
  "invalid-missing-features.json": 'missing required property "features"',
  "invalid-bad-feature-id.json": "profiles[0].features[0]: string does not match pattern",
  "invalid-extra-key.json": "surprise: unexpected additional property",
  "invalid-empty-profiles.json": "profiles: array shorter than minItems 1",
};

test("profiles fixtures: valid pass, invalid fail with the named violation", () => {
  const files = readdirSync(FIXTURES_DIR);
  const validFiles = files.filter((name) => name.startsWith("valid-"));
  const invalidFiles = files.filter((name) => name.startsWith("invalid-"));
  assert.ok(validFiles.length >= 1, "need at least one valid fixture");
  assert.deepEqual(invalidFiles.sort(), Object.keys(INVALID_FIXTURES).sort());

  for (const name of validFiles) {
    assert.deepEqual(validate(profilesSchema, loadJson(join(FIXTURES_DIR, name))).errors, [], `${name} should be valid`);
  }
  for (const [name, fragment] of Object.entries(INVALID_FIXTURES)) {
    const result = validate(profilesSchema, loadJson(join(FIXTURES_DIR, name)));
    assert.equal(result.valid, false, `${name} should be invalid`);
    const text = result.errors.map((e) => `${e.path}: ${e.message}`).join("\n");
    assert.ok(text.includes(fragment), `${name}: expected "${fragment}" in:\n${text}`);
  }
});

// ---------------------------------------------------------------------------
// every profile resolves through buildPlan without blocking errors
// ---------------------------------------------------------------------------
test("every profile resolves through buildPlan without blocking warnings", async () => {
  // A known GitHub target so flagship's api-target remote features are satisfied
  // (they legitimately block only when no target is set). buildPlan is pure — it
  // never touches targetPath on disk.
  const context = { targetPath: join(ROOT, "does-not-exist"), owner: "acme", repo: "widget", capabilities: {} };
  for (const profile of profiles.profiles) {
    const plan = await buildPlan({ selection: profile.features, context });
    const blocking = (plan.warnings || []).filter((w) => w.blocking);
    assert.deepEqual(blocking, [], `${profile.id} produced blocking warnings: ${JSON.stringify(blocking)}`);
    assert.equal(plan.profile, profile.id, `${profile.id} must resolve to its own tier id`);
  }
});

// ---------------------------------------------------------------------------
// tier nesting matches the owner decision
// ---------------------------------------------------------------------------
test("profile feature sets match the owner-decisioned tiers and nest", () => {
  const byId = Object.fromEntries(profiles.profiles.map((p) => [p.id, new Set(p.features)]));

  assert.deepEqual([...byId["docs-min"]].sort(), [...DOCS_MIN_FEATURES].sort());
  assert.deepEqual(
    [...byId["agent-standard"]].sort(),
    [...DOCS_MIN_FEATURES, ...AGENT_STANDARD_ADDITIONS].sort()
  );
  assert.deepEqual(
    [...byId["flagship"]].sort(),
    [...DOCS_MIN_FEATURES, ...AGENT_STANDARD_ADDITIONS, ...FLAGSHIP_ADDITIONS].sort()
  );

  // docs-min ⊂ agent-standard ⊂ flagship
  assert.ok([...byId["docs-min"]].every((id) => byId["agent-standard"].has(id)));
  assert.ok([...byId["agent-standard"]].every((id) => byId["flagship"].has(id)));
});

// ---------------------------------------------------------------------------
// resolveProfileId: exact resolved-selection match, else "custom"
// ---------------------------------------------------------------------------
test("resolveProfileId names exact tiers and calls everything else custom", () => {
  for (const profile of profiles.profiles) {
    assert.equal(resolveProfileId(profile.features, features, profiles), profile.id);
  }
  // A superset of a tier is not that tier.
  assert.equal(
    resolveProfileId([...AGENT_STANDARD, "agent-workflow.template-library"], features, profiles),
    "custom"
  );
  // A bare foundation matches no tier.
  assert.equal(resolveProfileId(["foundation.agents"], features, profiles), "custom");
});

// ---------------------------------------------------------------------------
// CONTINUITY: agent-standard floor == 23 historical + 3 new scripts (26), 6 dirs
// ---------------------------------------------------------------------------
test("agent-standard generated floor == historical 23-path baseline + 3 newly-required scripts (26+6)", () => {
  const baseline = generateStartupBaseline(AGENT_STANDARD, features);
  const expectedRequired = [...HISTORICAL_REQUIRED_23, ...NEWLY_REQUIRED_SCRIPTS].sort();

  assert.equal(baseline.required.length, 26, "the agent-standard floor is 23 historical + 3 flipped scripts");
  assert.deepEqual(baseline.required, expectedRequired);
  assert.deepEqual(baseline.expectedDirectories, [...HISTORICAL_DIRECTORIES_6].sort());
  assert.deepEqual(baseline.legacy, ["docs/superpowers/plans/"]);
  assert.ok(baseline.version.startsWith(`${BASELINE_VERSION_BASE}+`), "version is base + content hash");
});

test("docs-min floor is the four foundation required installs, two grouping dirs", () => {
  const baseline = generateStartupBaseline(DOCS_MIN_FEATURES, features);
  assert.deepEqual(baseline.required, [
    ".agent/coordination/README.md",
    "AGENTS.md",
    "docs/agent-process/document-policy.md",
    "docs/plans/README.md",
  ]);
  assert.deepEqual(baseline.expectedDirectories, ["docs/agent-process/", "docs/plans/"]);
});

// ---------------------------------------------------------------------------
// generator unit rules
// ---------------------------------------------------------------------------
test("deriveExpectedDirectories emits only docs/<sub>/ and scripts/<sub>/ grouping dirs", () => {
  const dirs = deriveExpectedDirectories([
    "AGENTS.md", // root file -> nothing
    "package.json", // root file -> nothing
    ".agent/coordination/README.md", // dot-config tree -> nothing
    ".github/workflows/ci.yml", // dot-config tree -> nothing
    "scripts/pr-contract.mjs", // single-segment script -> nothing
    "docs/plans/README.md", // -> docs/plans/
    "scripts/agent/lib.mjs", // -> scripts/agent/
    "scripts/agent/status.mjs", // dedupes with the above
  ]);
  assert.deepEqual(dirs, ["docs/plans/", "scripts/agent/"]);
});

test("generateStartupBaseline is deterministic and version tracks the floor", () => {
  const a = generateStartupBaseline(AGENT_STANDARD, features);
  const b = generateStartupBaseline([...AGENT_STANDARD].reverse(), features);
  // Order-independent: same resolved floor -> identical output incl. version.
  assert.deepEqual(a, b);
  // A different floor yields a different version.
  const docsMin = generateStartupBaseline(DOCS_MIN_FEATURES, features);
  assert.notEqual(a.version, docsMin.version);
});

test("serializeStartupBaseline round-trips and pins key order + trailing newline", () => {
  const baseline = generateStartupBaseline(DOCS_MIN_FEATURES, features);
  const text = serializeStartupBaseline(baseline);
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(JSON.parse(text), baseline);
  assert.deepEqual(Object.keys(JSON.parse(text)), ["version", "required", "expectedDirectories", "legacy"]);
});

// ---------------------------------------------------------------------------
// registry data hygiene
// ---------------------------------------------------------------------------
test("profiles.json is at src/registry/profiles.json alongside features.json", () => {
  const shipped = loadJson(join(REGISTRY_DIR, "profiles.json"));
  assert.equal(shipped.schemaVersion, 1);
  assert.deepEqual(shipped.profiles.map((p) => p.id), ["docs-min", "agent-standard", "flagship"]);
});
