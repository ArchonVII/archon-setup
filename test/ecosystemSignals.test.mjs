import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSignalList } from "../src/server/ecosystem/collectSignals.mjs";

test("parseSignalList counts markdown list/heading items and returns recent N", () => {
  const md = "# Anomalies\n\n- [bug] x: one\n- [sec] y: two\n- [bug] z: three\n";
  const r = parseSignalList(md, 2);
  assert.equal(r.count, 3);
  assert.deepEqual(r.recent, ["- [bug] z: three", "- [sec] y: two"]); // most-recent first
});

test("parseSignalList tolerates empty/missing content", () => {
  const r = parseSignalList("", 5);
  assert.equal(r.count, 0);
  assert.deepEqual(r.recent, []);
});
