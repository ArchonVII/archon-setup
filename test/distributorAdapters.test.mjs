import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "../src/distributor/adapters/index.mjs";

test("markdown adapter uses the markdown comment style", () => {
  assert.equal(getAdapter("markdown").commentStyle, "markdown");
});

test("yaml adapter uses the hash comment style", () => {
  assert.equal(getAdapter("yaml").commentStyle, "hash");
});

test("shell adapter uses the hash style and preserves exec bit + shebang (A7)", () => {
  const a = getAdapter("shell");
  assert.equal(a.commentStyle, "hash");
  assert.equal(a.metadataPolicy.preserveExecBit, true);
  assert.equal(a.metadataPolicy.shebangFirstLine, true);
});

test("getAdapter throws on an unknown adapter", () => {
  assert.throws(() => getAdapter("nope"), /unknown adapter/);
});

test("yaml detectDanger flags a duplicate key at the same mapping path", () => {
  const body = ["permissions:", "  contents: read", "  contents: write", ""].join("\n");
  const dangers = getAdapter("yaml").detectDanger(body);
  assert.equal(dangers.length, 1);
  assert.equal(dangers[0].kind, "duplicate-key");
  assert.equal(dangers[0].path, "permissions.contents");
  assert.deepEqual(dangers[0].lines, [2, 3]);
});

test("yaml detectDanger does not flag same-named keys at different paths (A9)", () => {
  const body = [
    "permissions:",
    "  contents: read",
    "jobs:",
    "  build:",
    "    permissions:",
    "      contents: write",
    "",
  ].join("\n");
  assert.deepEqual(getAdapter("yaml").detectDanger(body), []);
});

test("yaml detectDanger distinguishes sibling jobs (A9)", () => {
  const body = [
    "jobs:",
    "  a:",
    "    permissions:",
    "      contents: read",
    "  b:",
    "    permissions:",
    "      contents: write",
    "",
  ].join("\n");
  assert.deepEqual(getAdapter("yaml").detectDanger(body), []);
});

test("yaml detectDanger returns empty for a clean caller", () => {
  const body = [
    "name: CI",
    "on:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  ci:",
    "    uses: ArchonVII/github-workflows/.github/workflows/node-ci.yml@v1",
    "",
  ].join("\n");
  assert.deepEqual(getAdapter("yaml").detectDanger(body), []);
});

test("markdown and shell adapters report no danger findings", () => {
  assert.deepEqual(getAdapter("markdown").detectDanger("anything"), []);
  assert.deepEqual(getAdapter("shell").detectDanger("#!/usr/bin/env bash\n"), []);
});
