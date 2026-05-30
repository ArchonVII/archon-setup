import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTailscaleStatus } from "../src/server/ecosystem/collectAmber.mjs";

const STATUS = {
  Peer: {
    "k1": { HostName: "amber-wsl", Online: false, LastSeen: "2026-05-22T00:00:00Z" },
    "k2": { HostName: "phone", Online: true, LastSeen: "2026-05-30T00:00:00Z" },
  },
};

test("parseTailscaleStatus finds the amber node case-insensitively", () => {
  const r = parseTailscaleStatus(STATUS, /amber/i);
  assert.equal(r.online, false);
  assert.equal(r.lastSeen, "2026-05-22T00:00:00Z");
  assert.equal(r.status, "red");
});

test("parseTailscaleStatus yellow when node not present", () => {
  const r = parseTailscaleStatus({ Peer: {} }, /amber/i);
  assert.equal(r.status, "yellow");
  assert.equal(r.online, false);
});
