// src/server/ecosystem/collectPorts.mjs
import { readFile } from "node:fs/promises";

// process.kill(pid, 0) sends no signal but throws ESRCH if the pid is gone.
// EPERM means it exists but isn't ours — still "alive". (Node docs: process.kill)
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Pure: shape the registry object, marking liveness via the injected probe.
export function parsePortRegistry(registryObj, isAlive) {
  const ports = Object.entries(registryObj || {})
    .map(([port, e]) => ({
      port: Number(port),
      pid: e.pid ?? null,
      process: e.process ?? null,
      command: e.command ?? "",
      startedAt: e.startedAt ?? null,
      recordedAt: e.recordedAt ?? null,
      live: e.pid != null ? isAlive(e.pid) : false,
    }))
    .sort((a, b) => a.port - b.port);
  const liveCount = ports.filter((p) => p.live).length;
  return {
    id: "ports",
    status: ports.length === 0 ? "yellow" : "green",
    detail: ports.length === 0 ? "no ports recorded" : `${liveCount}/${ports.length} recorded ports live`,
    ports,
  };
}

export async function collectPorts(registryPath, { isAlive = pidAlive } = {}) {
  let raw;
  try {
    raw = await readFile(registryPath, "utf8");
  } catch {
    return { id: "ports", status: "yellow", detail: "no port registry found", ports: [] };
  }
  try {
    return parsePortRegistry(JSON.parse(raw), isAlive);
  } catch (e) {
    return { id: "ports", status: "red", detail: "port registry not valid JSON", error: e.message, ports: [] };
  }
}
