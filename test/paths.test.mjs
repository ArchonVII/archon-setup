import { test } from "node:test";
import assert from "node:assert/strict";
import { safeJoin } from "../src/server/lib/paths.mjs";

const ROOT = process.platform === "win32" ? "C:\\tmp\\proj" : "/tmp/proj";

test("safeJoin allows in-tree paths", () => {
  const r = safeJoin(ROOT, "a/b/c.txt");
  assert.ok(r.endsWith("c.txt"));
});

test("safeJoin rejects path traversal via ..", () => {
  assert.throws(() => safeJoin(ROOT, "../outside"));
  assert.throws(() => safeJoin(ROOT, "a/../../outside"));
});

test("safeJoin rejects absolute relativePath", () => {
  assert.throws(() => safeJoin(ROOT, process.platform === "win32" ? "C:\\elsewhere" : "/elsewhere"));
});
