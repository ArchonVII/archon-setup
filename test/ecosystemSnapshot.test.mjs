import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSnapshot } from "../src/server/ecosystem/snapshot.mjs";

test("assembleSnapshot builds summary and merges payloads", () => {
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [{ port: 5174 }] },
    repos: { id: "repos", status: "green", detail: "", repos: [{ name: "x" }] },
    governance: { id: "governance", status: "green", detail: "", repos: [{ name: "archon-setup" }] },
    amber: { id: "amber", status: "red", detail: "", online: false, lastSeen: "z" },
    signals: { id: "signals", status: "yellow", detail: "", anomalies: 1, noticed: 0, recent: [] },
  }, "2026-05-30T20:00:00.000Z");
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.generatedAt, "2026-05-30T20:00:00.000Z");
  assert.deepEqual(snap.summary, { green: 3, yellow: 1, red: 1 });
  assert.equal(snap.ports[0].port, 5174);
  assert.equal(snap.governance.repos[0].name, "archon-setup");
  assert.equal(snap.amber.online, false);
});

test("assembleSnapshot carries an events section through and counts it in the summary", () => {
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [] },
    repos: { id: "repos", status: "green", detail: "", repos: [] },
    governance: { id: "governance", status: "green", detail: "", repos: [] },
    amber: { id: "amber", status: "green", detail: "", online: true, lastSeen: "z" },
    signals: { id: "signals", status: "green", detail: "", anomalies: 0, noticed: 0, recent: [] },
    events: { id: "events", status: "green", detail: "2 events", count: 2, recent: [{ ts: "z", type: "plan-end" }] },
  }, "2026-06-02T00:00:00.000Z");
  assert.equal(snap.events.count, 2);
  assert.equal(snap.events.recent[0].type, "plan-end");
  assert.equal(snap.summary.green, 6); // ports, repos, governance, amber, signals, events
});

test("assembleSnapshot tolerates a missing events section (backward compatible)", () => {
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [] },
    repos: { id: "repos", status: "green", detail: "", repos: [] },
    governance: { id: "governance", status: "green", detail: "", repos: [] },
    amber: { id: "amber", status: "green", detail: "", online: true, lastSeen: "z" },
    signals: { id: "signals", status: "green", detail: "", anomalies: 0, noticed: 0, recent: [] },
  }, "2026-06-02T00:00:00.000Z");
  assert.equal(snap.summary.green, 5);
  assert.deepEqual(snap.events, { id: "events", status: "green", detail: "0 events", count: 0, recent: [] });
});
