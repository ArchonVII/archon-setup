import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegions, reconcile, replaceRegionInner } from "../src/distributor/regionEngine.mjs";

test("parseRegions reads one markdown managed region", () => {
  const body = [
    "# Local guide",
    "",
    "<!-- BEGIN ARCHONVII MANAGED: agents.start-map -->",
    "managed content",
    "<!-- END ARCHONVII MANAGED: agents.start-map -->",
    "",
    "repo-owned content",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "markdown");

  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.regions[0].id, "agents.start-map");
  assert.equal(parsed.regions[0].inner, "managed content");
});

test("parseRegions reads one hash-comment managed region", () => {
  const body = [
    "jobs:",
    "  decision:",
    "    # BEGIN ARCHONVII MANAGED: workflow.required-gate.uses",
    "    uses: ArchonVII/github-workflows/.github/workflows/repo-required-gate.yml@v1",
    "    # END ARCHONVII MANAGED: workflow.required-gate.uses",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "hash");

  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.regions[0].id, "workflow.required-gate.uses");
  assert.equal(
    parsed.regions[0].inner,
    "    uses: ArchonVII/github-workflows/.github/workflows/repo-required-gate.yml@v1",
  );
});

test("parseRegions reports a missing end marker", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: hooks.pre-commit",
    "managed content",
  ].join("\n");

  const parsed = parseRegions(body, "hash");

  assert.deepEqual(parsed.regions, []);
  assert.deepEqual(parsed.diagnostics, [
    { kind: "missing-end", id: "hooks.pre-commit", line: 1 },
  ]);
});

test("parseRegions reports duplicate region ids", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: one",
    "# END ARCHONVII MANAGED: workflow.pin",
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: two",
    "# END ARCHONVII MANAGED: workflow.pin",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "hash");

  assert.equal(parsed.regions.length, 2);
  assert.deepEqual(parsed.diagnostics, [
    { kind: "duplicate-id", id: "workflow.pin", line: 4 },
  ]);
});

test("parseRegions reports nested markers without changing ownership context", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: outer",
    "before",
    "# BEGIN ARCHONVII MANAGED: inner",
    "inside",
    "# END ARCHONVII MANAGED: inner",
    "after",
    "# END ARCHONVII MANAGED: outer",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "hash");

  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.regions[0].id, "outer");
  assert.deepEqual(parsed.diagnostics, [
    { kind: "nested", id: "inner", parentId: "outer", line: 3 },
  ]);
});

test("parseRegions reports malformed managed marker lines", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED:",
    "managed content",
    "# END ARCHONVII MANAGED:",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "hash");

  assert.deepEqual(parsed.regions, []);
  assert.deepEqual(parsed.diagnostics, [
    { kind: "malformed-marker", line: 1 },
    { kind: "malformed-marker", line: 3 },
  ]);
});

test("replaceRegionInner replaces only the requested region body", () => {
  const body = [
    "prefix",
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "old inner",
    "# END ARCHONVII MANAGED: workflow.pin",
    "suffix",
    "",
  ].join("\n");

  const replaced = replaceRegionInner(body, "workflow.pin", "new inner", "hash");

  assert.deepEqual(replaced, {
    changed: true,
    body: [
      "prefix",
      "# BEGIN ARCHONVII MANAGED: workflow.pin",
      "new inner",
      "# END ARCHONVII MANAGED: workflow.pin",
      "suffix",
      "",
    ].join("\n"),
  });
});

test("reconcile replaces differing desired regions as clean apply", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: old",
    "# END ARCHONVII MANAGED: workflow.pin",
    "with:",
    "  stack: node",
    "",
  ].join("\n");

  const result = reconcile(body, [{ id: "workflow.pin", inner: "uses: new" }], "hash");

  assert.equal(result.status, "clean_apply");
  assert.equal(result.changed, true);
  assert.equal(result.result, [
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: new",
    "# END ARCHONVII MANAGED: workflow.pin",
    "with:",
    "  stack: node",
    "",
  ].join("\n"));
  assert.deepEqual(result.regions, [
    { id: "workflow.pin", status: "clean_apply", changed: true },
  ]);
});

test("reconcile reports clean apply unchanged when region inner already matches", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: ArchonVII/github-workflows/.github/workflows/node-ci.yml@v1",
    "# END ARCHONVII MANAGED: workflow.pin",
    "",
  ].join("\n");

  const result = reconcile(
    body,
    [{ id: "workflow.pin", inner: "uses: ArchonVII/github-workflows/.github/workflows/node-ci.yml@v1" }],
    "hash",
  );

  assert.equal(result.status, "clean_apply");
  assert.equal(result.changed, false);
  assert.equal(result.result, body);
  assert.deepEqual(result.regions, [
    { id: "workflow.pin", status: "clean_apply", changed: false },
  ]);
});

test("reconcile reports adoption_needed when a desired region is absent", () => {
  const body = [
    "permissions:",
    "  issues: write",
    "",
  ].join("\n");

  const result = reconcile(
    body,
    [{ id: "workflow.required-gate.permissions.base", inner: "contents: read\npull-requests: read" }],
    "hash",
  );

  assert.equal(result.status, "adoption_needed");
  assert.equal(result.changed, false);
  assert.equal(result.result, null);
  assert.deepEqual(result.regions, [
    { id: "workflow.required-gate.permissions.base", status: "adoption_needed", changed: false },
  ]);
});

test("reconcile reports conflict for consumer regions absent from desired ids", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.old-pin",
    "uses: old",
    "# END ARCHONVII MANAGED: workflow.old-pin",
    "",
  ].join("\n");

  const result = reconcile(body, [{ id: "workflow.new-pin", inner: "uses: new" }], "hash");

  assert.equal(result.status, "conflict");
  assert.equal(result.changed, false);
  assert.equal(result.result, null);
  assert.deepEqual(result.regions, [
    { id: "workflow.old-pin", status: "conflict", reason: "unknown-id", changed: false },
    { id: "workflow.new-pin", status: "adoption_needed", changed: false },
  ]);
});

test("reconcile reports conflict when existing markers are malformed", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: old",
    "",
  ].join("\n");

  const result = reconcile(body, [{ id: "workflow.pin", inner: "uses: new" }], "hash");

  assert.equal(result.status, "conflict");
  assert.equal(result.changed, false);
  assert.equal(result.result, null);
  assert.deepEqual(result.diagnostics, [
    { kind: "missing-end", id: "workflow.pin", line: 1 },
  ]);
});

test("reconcile leaves a known-but-unselected region untouched (A1: --id scopes action, not validity)", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.pin",
    "uses: old",
    "# END ARCHONVII MANAGED: workflow.pin",
    "permissions:",
    "  # BEGIN ARCHONVII MANAGED: workflow.permissions.base",
    "  contents: read",
    "  # END ARCHONVII MANAGED: workflow.permissions.base",
    "",
  ].join("\n");

  // Only workflow.pin is selected this run, but BOTH ids are in the known catalog.
  const result = reconcile(body, [{ id: "workflow.pin", inner: "uses: new" }], "hash", {
    knownIds: ["workflow.pin", "workflow.permissions.base"],
  });

  assert.equal(result.status, "clean_apply");
  assert.equal(result.changed, true);
  // The unselected-but-known region is preserved verbatim and NOT flagged.
  assert.match(result.result, /contents: read/);
  assert.deepEqual(result.regions, [
    { id: "workflow.pin", status: "clean_apply", changed: true },
  ]);
});

test("reconcile conflicts a consumer region whose id is absent from the known catalog (A1)", () => {
  const body = [
    "# BEGIN ARCHONVII MANAGED: workflow.deprecated-pin",
    "uses: old",
    "# END ARCHONVII MANAGED: workflow.deprecated-pin",
    "",
  ].join("\n");

  const result = reconcile(body, [{ id: "workflow.pin", inner: "uses: new" }], "hash", {
    knownIds: ["workflow.pin"], // deprecated-pin is NOT in the catalog
  });

  assert.equal(result.status, "conflict");
  assert.deepEqual(result.regions, [
    { id: "workflow.deprecated-pin", status: "conflict", reason: "unknown-id", changed: false },
    { id: "workflow.pin", status: "adoption_needed", changed: false },
  ]);
});

test("parseRegions recognizes legacy AGENTS managed-block markers as a known region (A8)", () => {
  const body = [
    "# Repo guide",
    "",
    "<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->",
    "managed agents content",
    "<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "markdown");

  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.regions[0].id, "agents-start-map");
  assert.equal(parsed.regions[0].inner, "managed agents content");
});

test("parseRegions recognizes legacy global-update markers as a known region (A8)", () => {
  const body = [
    "<!-- BEGIN ARCHONVII GLOBAL UPDATE: 2026-05-31-browser-backend-preflight -->",
    "managed content",
    "<!-- END ARCHONVII GLOBAL UPDATE: 2026-05-31-browser-backend-preflight -->",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "markdown");

  assert.deepEqual(parsed.diagnostics, []);
  assert.equal(parsed.regions.length, 1);
  assert.equal(parsed.regions[0].id, "2026-05-31-browser-backend-preflight");
});

test("parseRegions reports malformed legacy global-update marker lines", () => {
  const body = [
    "<!-- BEGIN ARCHONVII GLOBAL UPDATE: -->",
    "managed content",
    "<!-- END ARCHONVII GLOBAL UPDATE: -->",
    "",
  ].join("\n");

  const parsed = parseRegions(body, "markdown");

  assert.deepEqual(parsed.regions, []);
  assert.deepEqual(parsed.diagnostics, [
    { kind: "malformed-marker", line: 1 },
    { kind: "malformed-marker", line: 3 },
  ]);
});
