import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSnapshot, joinPortReservations } from "../src/server/ecosystem/snapshot.mjs";

test("assembleSnapshot builds summary and merges payloads", () => {
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [{ port: 5174 }] },
    repos: {
      id: "repos",
      status: "green",
      detail: "",
      repos: [{ name: "x" }],
      registry: { active: 1, inactive: 1, repositories: [{ id: "x" }, { id: "old", lifecycle: "inactive" }] },
    },
    governance: { id: "governance", status: "green", detail: "", repos: [{ name: "archon-setup" }] },
    amber: { id: "amber", status: "red", detail: "", online: false, lastSeen: "z" },
    signals: { id: "signals", status: "yellow", detail: "", anomalies: 1, noticed: 0, recent: [] },
  }, "2026-05-30T20:00:00.000Z");
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.generatedAt, "2026-05-30T20:00:00.000Z");
  assert.deepEqual(snap.summary, { green: 3, yellow: 1, red: 1 });
  assert.equal(snap.ports[0].port, 5174);
  assert.equal(snap.repoRegistry.active, 1);
  assert.equal(snap.repoRegistry.inactive, 1);
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

test("assembleSnapshot joins per-repo maintenance by id (#215)", () => {
  const maintenance = {
    byId: {
      x: {
        status: "green",
        basis: "fast",
        fastStatus: "manifest_current",
        reasons: [{ code: "manifest-current-unaudited", detail: "Manifest current · run audit to verify" }],
      },
    },
  };
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [] },
    repos: {
      id: "repos",
      status: "green",
      detail: "",
      repos: [{ id: "x", name: "x" }, { id: "y", name: "y" }],
      registry: { active: 2, inactive: 0, repositories: [] },
    },
    governance: { id: "governance", status: "green", detail: "", repos: [] },
    amber: { id: "amber", status: "green", detail: "", online: true, lastSeen: "z" },
    signals: { id: "signals", status: "green", detail: "", anomalies: 0, noticed: 0, recent: [] },
    maintenance,
  }, "2026-06-12T00:00:00.000Z");

  assert.equal(snap.repos[0].maintenance.status, "green");
  assert.match(snap.repos[0].maintenance.reasons[0].detail, /run audit to verify/);
  assert.equal(snap.repos[1].maintenance, null, "repos without an assessment carry an explicit null");
  // Maintenance is a per-repo field, never a summary section.
  assert.deepEqual(snap.summary, { green: 5, yellow: 0, red: 0 });
});

test("assembleSnapshot joins per-repo friction by ledger path (#233)", () => {
  const friction = {
    id: "friction",
    status: "green",
    detail: "1 friction entries; 1 repos without ledgers",
    count: 1,
    noLedger: 1,
    sources: [],
    byPath: {
      "C:\\GitHub\\with-ledger\\.claude\\friction.md": {
        state: "present",
        count: 1,
        byCategory: { tooling: 1, docs: 0, skill: 0, hook: 0, ci: 0, env: 0 },
        byCost: { rerun: 1, blocked: 0, "context-burn": 0, none: 0 },
        lastEntryAt: "2026-06-12",
        unparsed: 0,
      },
    },
  };
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [] },
    repos: {
      id: "repos",
      status: "green",
      detail: "",
      repos: [
        { id: "with-ledger", name: "with-ledger", path: "C:\\GitHub\\with-ledger" },
        { id: "without-ledger", name: "without-ledger", path: "C:\\GitHub\\without-ledger" },
      ],
      registry: { active: 2, inactive: 0, repositories: [] },
    },
    governance: { id: "governance", status: "green", detail: "", repos: [] },
    amber: { id: "amber", status: "green", detail: "", online: true, lastSeen: "z" },
    signals: { id: "signals", status: "green", detail: "", anomalies: 0, noticed: 0, recent: [] },
    friction,
  }, "2026-06-12T00:00:00.000Z");

  assert.equal(snap.friction.count, 1);
  assert.equal(snap.repos[0].friction.byCategory.tooling, 1);
  assert.deepEqual(snap.repos[1].friction, {
    state: "no-ledger",
    count: 0,
    byCategory: { tooling: 0, docs: 0, skill: 0, hook: 0, ci: 0, env: 0 },
    byCost: { rerun: 0, blocked: 0, "context-burn": 0, none: 0 },
    lastEntryAt: null,
    unparsed: 0,
  });
  assert.equal(snap.summary.green, 6);
});

test("joinPortReservations annotates reservedBy and conflict (#215, spec §4.5)", () => {
  const registryRepos = [
    { id: "archon-setup", lifecycle: "active", path: "C:/GitHub/archon-setup", reservedPorts: [5180, 5181] },
    { id: "old-repo", lifecycle: "removed", path: "C:/GitHub/old-repo", reservedPorts: [5190] },
  ];
  const rows = joinPortReservations([
    // Reserved + live + command attributable to the reserving repo → no conflict.
    { port: 5180, live: true, command: 'node "C:\\GitHub\\archon-setup\\node_modules\\vite\\bin\\vite.js"' },
    // Reserved + live + foreign command → conflict (squatter).
    { port: 5181, live: true, command: "python -m other_tool serve" },
    // Forbidden Vite default in live use → conflict even unreserved.
    { port: 5173, live: true, command: "node vite.js" },
    // Reserved but dead recorded process → no conflict.
    { port: 5180, live: false, command: "stale" },
    // Unreserved machine tool → untouched by reservations.
    { port: 8765, live: true, command: "python -m vision_gateway serve" },
    // Tombstoned reservations do not reserve.
    { port: 5190, live: true, command: "whatever" },
  ], registryRepos);

  assert.deepEqual(
    rows.map((r) => [r.port, r.reservedBy, r.conflict]),
    [
      [5180, "archon-setup", false],
      [5181, "archon-setup", true],
      [5173, null, true],
      [5180, "archon-setup", false],
      [8765, null, false],
      [5190, null, false],
    ],
  );
});

test("assembleSnapshot annotates ports when a registry is present", () => {
  const snap = assembleSnapshot({
    ports: { id: "ports", status: "green", detail: "", ports: [{ port: 5184, live: true, command: "elsewhere" }] },
    repos: {
      id: "repos",
      status: "green",
      detail: "",
      repos: [],
      registry: {
        active: 1,
        inactive: 0,
        repositories: [{ id: "pigafetta", lifecycle: "active", path: "C:/PythonProjects/pigafetta", reservedPorts: [5184, 5185] }],
      },
    },
    governance: { id: "governance", status: "green", detail: "", repos: [] },
    amber: { id: "amber", status: "green", detail: "", online: true, lastSeen: "z" },
    signals: { id: "signals", status: "green", detail: "", anomalies: 0, noticed: 0, recent: [] },
  }, "2026-06-12T00:00:00.000Z");

  assert.equal(snap.ports[0].reservedBy, "pigafetta");
  assert.equal(snap.ports[0].conflict, true, "live process not attributable to the reserving repo");
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
