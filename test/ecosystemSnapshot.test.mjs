import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSnapshot } from "../src/server/ecosystem/snapshot.mjs";

test("assembleSnapshot builds summary and merges payloads", () => {
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [{ port: 5174 }] },
    repos: { id: "repos", status: "green", detail: "", repos: [{ name: "x" }] },
    amber: { id: "amber", status: "red", detail: "", online: false, lastSeen: "z" },
    signals: { id: "signals", status: "yellow", detail: "", anomalies: 1, noticed: 0, recent: [] },
  }, "2026-05-30T20:00:00.000Z");
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.generatedAt, "2026-05-30T20:00:00.000Z");
  assert.deepEqual(snap.summary, { green: 2, yellow: 1, red: 1 });
  assert.equal(snap.ports[0].port, 5174);
  assert.equal(snap.amber.online, false);
});
