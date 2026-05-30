import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePortRegistry } from "../src/server/ecosystem/collectPorts.mjs";

const REGISTRY = {
  "5174": { pid: 49472, process: "node.exe", command: "vite --port 5174", startedAt: "a", recordedAt: "b" },
  "7881": { pid: 44868, process: "node.exe", command: "tsx zombie", startedAt: "c", recordedAt: "d" },
};

test("parsePortRegistry marks liveness via injected probe and sorts by port", () => {
  const alivePids = new Set([49472]); // 7881's pid is dead
  const r = parsePortRegistry(REGISTRY, (pid) => alivePids.has(pid));
  assert.equal(r.id, "ports");
  assert.equal(r.ports[0].port, 5174);
  assert.equal(r.ports[0].live, true);
  assert.equal(r.ports[1].port, 7881);
  assert.equal(r.ports[1].live, false);
  assert.match(r.detail, /1\/2/); // 1 of 2 live
});

test("parsePortRegistry tolerates empty registry", () => {
  const r = parsePortRegistry({}, () => true);
  assert.equal(r.status, "yellow");
  assert.deepEqual(r.ports, []);
});
