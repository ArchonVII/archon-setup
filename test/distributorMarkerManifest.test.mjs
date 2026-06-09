import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, diffManifest } from "../src/distributor/markerManifest.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "managed-regions");
const fixtureSources = JSON.parse(readFileSync(join(FIXTURES, "sources.json"), "utf8"));
const readFixture = (rel) => readFileSync(join(FIXTURES, rel), "utf8");

function source(overrides = {}) {
  return {
    provider: "p",
    snapshotFile: "x.yml",
    targetRelpath: "x",
    adapter: "yaml",
    group: "callers",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    ...overrides,
  };
}

test("buildManifest expands marked sources into sorted per-region entries", () => {
  const { entries, diagnostics } = buildManifest(fixtureSources, readFixture);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    [
      "agents.start-map",
      "hooks.pre-push.core",
      "workflow.required-gate.permissions.base",
      "workflow.required-gate.uses",
    ],
  );

  const perm = entries.find((entry) => entry.id === "workflow.required-gate.permissions.base");
  assert.deepEqual(perm, {
    id: "workflow.required-gate.permissions.base",
    provider: "github-workflows",
    snapshotFile: "callers/repo-required-gate.yml",
    targetRelpath: ".github/workflows/repo-required-gate.yml",
    adapter: "yaml",
    group: "callers",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
  });
});

test("buildManifest flags a globally duplicate region id across files", () => {
  const sources = [source({ snapshotFile: "a.yml" }), source({ snapshotFile: "b.yml" })];
  const content = "# BEGIN ARCHONVII MANAGED: dup.id\nx: 1\n# END ARCHONVII MANAGED: dup.id\n";

  const { diagnostics } = buildManifest(sources, () => content);

  assert.ok(
    diagnostics.some((d) => d.kind === "duplicate-id-global" && d.id === "dup.id"),
    "expected a duplicate-id-global diagnostic",
  );
});

test("buildManifest propagates a missing end marker with file context", () => {
  const { diagnostics } = buildManifest([source({ snapshotFile: "x.yml" })], () =>
    "# BEGIN ARCHONVII MANAGED: x.pin\nx: 1\n",
  );

  assert.deepEqual(diagnostics, [
    { kind: "missing-end", id: "x.pin", line: 1, snapshotFile: "x.yml" },
  ]);
});

test("buildManifest flags comment-style mismatch (markdown markers under the yaml adapter)", () => {
  const content = "<!-- BEGIN ARCHONVII MANAGED: a.b -->\nx\n<!-- END ARCHONVII MANAGED: a.b -->\n";

  const { diagnostics } = buildManifest([source({ snapshotFile: "x.md", adapter: "yaml" })], () => content);

  assert.ok(diagnostics.some((d) => d.kind === "style-mismatch"), "expected a style-mismatch diagnostic");
});

test("buildManifest surfaces an unknown adapter as a diagnostic, not a throw", () => {
  const { diagnostics } = buildManifest([source({ adapter: "nope" })], () => "");
  assert.ok(diagnostics.some((d) => d.kind === "unknown-adapter"));
});

test("diffManifest is ok only when committed equals freshly built and there are no diagnostics", () => {
  const built = buildManifest(fixtureSources, readFixture);

  assert.equal(diffManifest({ entries: built.entries }, built).ok, true);
  assert.equal(diffManifest({ entries: [] }, built).ok, false); // committed drifted (a dropped id)
});
