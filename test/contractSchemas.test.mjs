import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSchemaSupported, validate } from "../src/contracts/validate.mjs";
import {
  CATEGORIES,
  CURRENT_STATES,
  OPERATION_ACTIONS,
  RAW_FILE_STATUSES,
  RAW_REPO_STATUSES,
  RECOMMENDATION_REASONS,
  REPO_LIFECYCLES,
  REPO_ROLES,
  REPO_SKIP_REASONS,
  RESOLUTION_OPTIONS,
} from "../src/contracts/vocab.mjs";

// M0.5 contract fixtures (#156): schema-validation coverage for valid AND
// invalid documents on every seam, plus consistency pins so the JSON schema
// files, the shared vocab module, and the run-state machine cannot drift
// apart without a test failing.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMAS_DIR = join(ROOT, "src", "contracts", "schemas");
const FIXTURES_DIR = join(ROOT, "test", "fixtures", "contracts");

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const schemaOf = (name) => loadJson(join(SCHEMAS_DIR, name));

// ---- validator unit coverage ----

test("validate: type, required, enum, const, pattern, bounds", () => {
  const schema = {
    type: "object",
    required: ["name", "count"],
    additionalProperties: false,
    properties: {
      name: { type: "string", pattern: "^[a-z]+$", minLength: 2 },
      count: { type: "integer", minimum: 0, maximum: 10 },
      mode: { enum: ["a", "b", null] },
      version: { const: 1 },
    },
  };

  assert.deepEqual(validate(schema, { name: "ok", count: 3, mode: null, version: 1 }), {
    valid: true,
    errors: [],
  });

  const bad = validate(schema, { name: "NOPE", count: 11, mode: "c", version: 2 });
  assert.equal(bad.valid, false);
  const text = bad.errors.map((e) => `${e.path}: ${e.message}`).join("\n");
  assert.match(text, /name: string does not match pattern/);
  assert.match(text, /count: number above maximum/);
  assert.match(text, /mode: value "c" not in enum/);
  assert.match(text, /version: expected const 1/);

  const missing = validate(schema, { name: "ok" });
  assert.match(missing.errors[0].message, /missing required property "count"/);
});

test("validate: union types, arrays, additionalProperties as schema and as false", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      maybe: { type: ["string", "null"] },
      list: { type: "array", minItems: 1, items: { type: "string" } },
      hashes: { type: "object", additionalProperties: { type: "string", pattern: "^[0-9a-f]{4}$" } },
    },
  };

  assert.equal(validate(schema, { maybe: null, list: ["x"], hashes: { "a.md": "0abc" } }).valid, true);

  const extra = validate(schema, { unexpected: true });
  assert.equal(extra.valid, false);
  assert.equal(extra.errors[0].path, "unexpected");
  assert.match(extra.errors[0].message, /unexpected additional property/);

  const badHash = validate(schema, { hashes: { "a.md": "ZZZZ" } });
  assert.equal(badHash.valid, false);
  assert.equal(badHash.errors[0].path, "hashes.a.md");

  const shortList = validate(schema, { list: [] });
  assert.match(shortList.errors[0].message, /minItems/);
});

test("validate: $ref resolves local $defs; unsupported refs and keywords fail closed", () => {
  const schema = {
    type: "object",
    properties: { sha: { $ref: "#/$defs/sha" } },
    $defs: { sha: { type: "string", pattern: "^[0-9a-f]{4}$" } },
  };
  assert.equal(validate(schema, { sha: "0abc" }).valid, true);
  assert.equal(validate(schema, { sha: "nope" }).valid, false);

  assert.throws(() => validate({ $ref: "#/definitions/x" }, {}), /unsupported \$ref/);
  assert.throws(() => validate({ oneOf: [{ type: "string" }] }, "x"), /unsupported schema keyword "oneOf"/);
  assert.throws(
    () => assertSchemaSupported({ type: "object", properties: { x: { anyOf: [] } } }),
    /unsupported schema keyword "anyOf"/,
  );
});

// ---- every contract schema uses only implemented keywords ----

test("all contract schemas pass the static fail-closed keyword walk", () => {
  const schemaFiles = readdirSync(SCHEMAS_DIR).filter((name) => name.endsWith(".schema.json"));
  assert.ok(schemaFiles.length >= 6, `expected at least 6 schemas, found ${schemaFiles.length}`);
  for (const name of schemaFiles) {
    assertSchemaSupported(schemaOf(name));
  }
});

// ---- valid and invalid fixtures per contract ----

// Each invalid fixture breaks exactly one named rule; the expected fragment
// must appear in the validator's error path+message output.
const CONTRACTS = [
  {
    schema: "repo-refresh-report.schema.json",
    dir: "repo-refresh-report",
    invalid: {
      "invalid-unknown-status.json": 'status: value "maybe" not in enum',
      "invalid-missing-recommendation-reason.json": 'missing required property "recommendationReason"',
      "invalid-extra-top-level-key.json": "surprise: unexpected additional property",
    },
  },
  {
    schema: "decision-doc.schema.json",
    dir: "decision-doc",
    invalid: {
      "invalid-bad-resolution-choice.json": "items[0].resolution.choice",
      "invalid-missing-fingerprints.json": 'missing required property "fingerprints"',
      "invalid-wrong-schema-version.json": "schemaVersion: expected const 1",
    },
  },
  {
    schema: "apply-set.schema.json",
    dir: "apply-set",
    invalid: {
      "invalid-missing-guards.json": 'missing required property "guards"',
      "invalid-empty-items.json": "items: array shorter than minItems 1",
      "invalid-bad-resolution.json": "items[0].resolution",
    },
  },
  {
    schema: "run-report.schema.json",
    dir: "run-report",
    invalid: {
      "invalid-unknown-state.json": 'state: value "merging" not in enum',
      "invalid-missing-rollback-command.json": 'missing required property "rollbackCommand"',
    },
  },
  {
    schema: "skill-selection.schema.json",
    dir: "skill-selection",
    invalid: {
      "invalid-bad-hash.json": "selections[0].skillSha256",
      "invalid-bad-discovery-status.json": "discovery.status",
      "invalid-blank-rationale.json": "selections[0].whySelected",
      "invalid-missing-rationale.json": 'missing required property "whySelected"',
    },
  },
  {
    schema: "repo-registry.schema.json",
    dir: "repo-registry",
    invalid: {
      "invalid-bad-lifecycle.json": 'repositories[0].lifecycle: value "archived" not in enum',
      "invalid-missing-role.json": 'missing required property "role"',
      "invalid-port-out-of-bounds.json": "repositories[0].reservedPorts[0]: number above maximum",
      // Live status is computed, never stored in the registry (#214 spec §4.1).
      "invalid-live-status-key.json": "repositories[0].status: unexpected additional property",
    },
  },
];

for (const contract of CONTRACTS) {
  test(`${contract.dir}: valid fixtures validate, invalid fixtures fail with the named violation`, () => {
    const schema = schemaOf(contract.schema);
    const files = readdirSync(join(FIXTURES_DIR, contract.dir));

    const validFiles = files.filter((name) => name.startsWith("valid-"));
    const invalidFiles = files.filter((name) => name.startsWith("invalid-"));
    assert.ok(validFiles.length >= 1, "every contract needs at least one valid fixture");
    assert.deepEqual(invalidFiles.sort(), Object.keys(contract.invalid).sort());

    for (const name of validFiles) {
      const result = validate(schema, loadJson(join(FIXTURES_DIR, contract.dir, name)));
      assert.deepEqual(result.errors, [], `${name} should be valid`);
    }

    for (const [name, fragment] of Object.entries(contract.invalid)) {
      const result = validate(schema, loadJson(join(FIXTURES_DIR, contract.dir, name)));
      assert.equal(result.valid, false, `${name} should be invalid`);
      const text = result.errors.map((e) => `${e.path}: ${e.message}`).join("\n");
      assert.ok(text.includes(fragment), `${name}: expected "${fragment}" in:\n${text}`);
    }
  });
}

// ---- contract artifacts in src/contracts validate against their schemas ----

test("run-states.json and operation-mapping.json validate against their own schemas", () => {
  const runStates = loadJson(join(ROOT, "src", "contracts", "run-states.json"));
  assert.deepEqual(validate(schemaOf("run-state-machine.schema.json"), runStates).errors, []);

  const mapping = loadJson(join(ROOT, "src", "contracts", "operation-mapping.json"));
  assert.deepEqual(validate(schemaOf("operation-mapping.schema.json"), mapping).errors, []);
});

// ---- run state machine consistency ----

test("run state machine: states, transitions, terminals, and reachability are consistent", () => {
  const machine = loadJson(join(ROOT, "src", "contracts", "run-states.json"));
  const ids = machine.states.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate state id");
  const idSet = new Set(ids);
  const terminal = new Set(machine.states.filter((s) => s.terminal).map((s) => s.id));

  assert.ok(idSet.has(machine.initial), "initial state must exist");

  for (const { from, to } of machine.transitions) {
    assert.ok(idSet.has(from), `unknown transition source ${from}`);
    assert.ok(idSet.has(to), `unknown transition target ${to}`);
  }
  for (const wildcard of machine.wildcardTransitions) {
    assert.ok(idSet.has(wildcard.to), `unknown wildcard target ${wildcard.to}`);
    for (const excluded of wildcard.excludeFrom ?? []) {
      assert.ok(idSet.has(excluded), `unknown wildcard exclusion ${excluded}`);
    }
  }

  // Terminal rule: a settled run may only be reopened through the rollback
  // chain (F8/F9), never through retry.
  for (const { from, to } of machine.transitions) {
    if (terminal.has(from)) {
      assert.equal(to, "rollback_requested", `terminal state ${from} may only transition to rollback_requested`);
    }
  }

  // Every state is reachable from the initial state via explicit or wildcard
  // transitions.
  const reachable = new Set([machine.initial]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { from, to } of machine.transitions) {
      if (reachable.has(from) && !reachable.has(to)) {
        reachable.add(to);
        grew = true;
      }
    }
    for (const wildcard of machine.wildcardTransitions) {
      const excluded = new Set(wildcard.excludeFrom ?? []);
      const hasLiveSource = machine.states.some(
        (s) => !s.terminal && !excluded.has(s.id) && reachable.has(s.id),
      );
      if (hasLiveSource && !reachable.has(wildcard.to)) {
        reachable.add(wildcard.to);
        grew = true;
      }
    }
  }
  for (const id of ids) {
    assert.ok(reachable.has(id), `state ${id} is unreachable`);
  }

  // Invariants: every state's record requires at least runId.
  for (const state of machine.states) {
    assert.ok(state.requires.includes("runId"), `${state.id} must require runId`);
  }
});

// ---- cross-contract enum pinning (schemas may not drift from vocab.mjs) ----

test("schema enums match the shared vocab module exactly", () => {
  const refresh = schemaOf("repo-refresh-report.schema.json");
  const decision = schemaOf("decision-doc.schema.json");
  const applySet = schemaOf("apply-set.schema.json");
  const runReport = schemaOf("run-report.schema.json");
  const mappingSchema = schemaOf("operation-mapping.schema.json");

  const recommendedEnum = [...RESOLUTION_OPTIONS, null];

  // RepoRefreshReport
  assert.deepEqual(refresh.properties.status.enum, RAW_REPO_STATUSES);
  assert.deepEqual(refresh.properties.reason.enum, REPO_SKIP_REASONS);
  assert.deepEqual(refresh.$defs.category.enum, CATEGORIES);
  assert.deepEqual(refresh.$defs.refreshItem.properties.raw.properties.status.enum, RAW_FILE_STATUSES);
  assert.deepEqual(refresh.$defs.operationProjection.properties.action.enum, OPERATION_ACTIONS);
  assert.deepEqual(refresh.$defs.operationProjection.properties.currentState.enum, CURRENT_STATES);
  assert.deepEqual(refresh.$defs.refreshItem.properties.recommended.enum, recommendedEnum);
  assert.deepEqual(refresh.$defs.refreshItem.properties.recommendationReason.enum, RECOMMENDATION_REASONS);

  // DecisionDoc
  assert.deepEqual(decision.$defs.category.enum, CATEGORIES);
  assert.deepEqual(decision.$defs.resolutionChoice.enum, RESOLUTION_OPTIONS);
  const decisionItem = decision.$defs.decisionItem.properties;
  assert.deepEqual(decisionItem.raw.properties.status.enum, RAW_FILE_STATUSES);
  assert.deepEqual(decisionItem.operation.properties.action.enum, OPERATION_ACTIONS);
  assert.deepEqual(decisionItem.operation.properties.currentState.enum, CURRENT_STATES);
  assert.deepEqual(decisionItem.recommended.enum, recommendedEnum);
  assert.deepEqual(decisionItem.recommendationReason.enum, RECOMMENDATION_REASONS);
  assert.deepEqual(decisionItem.resolution.properties.choice.enum, recommendedEnum);

  // ApplySet
  assert.deepEqual(applySet.$defs.applyItem.properties.category.enum, CATEGORIES);
  assert.deepEqual(applySet.$defs.applyItem.properties.resolution.enum, RESOLUTION_OPTIONS);

  // RunReport: the state enum is exactly the run-state machine's state ids.
  const machine = loadJson(join(ROOT, "src", "contracts", "run-states.json"));
  assert.deepEqual(
    runReport.properties.state.enum,
    machine.states.map((s) => s.id),
  );
  assert.deepEqual(runReport.$defs.resultItem.properties.action.enum, OPERATION_ACTIONS);

  // Operation-mapping schema
  const row = mappingSchema.properties.rows.items.properties;
  assert.deepEqual(row.when.properties.status.enum, RAW_FILE_STATUSES);
  assert.deepEqual(row.operation.properties.action.enum, OPERATION_ACTIONS);
  assert.deepEqual(row.operation.properties.currentState.enum, [...CURRENT_STATES, null]);
  assert.deepEqual(row.recommended.enum, recommendedEnum);
  assert.deepEqual(row.recommendationReason.enum, RECOMMENDATION_REASONS);
  assert.deepEqual(row.options.items.enum, RESOLUTION_OPTIONS);

  // Repo registry (#214)
  const repoRegistry = schemaOf("repo-registry.schema.json");
  assert.deepEqual(repoRegistry.$defs.entry.properties.lifecycle.enum, REPO_LIFECYCLES);
  assert.deepEqual(repoRegistry.$defs.entry.properties.role.enum, REPO_ROLES);
});

// ---- the shipped seed registry must satisfy its own contract ----

test("seed repo registry validates against repo-registry.schema.json", () => {
  const seed = loadJson(join(ROOT, "src", "server", "ecosystem", "repoRegistry.json"));
  assert.deepEqual(validate(schemaOf("repo-registry.schema.json"), seed).errors, []);
});
