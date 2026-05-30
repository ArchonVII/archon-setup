// src/server/ecosystem/collectAmber.mjs
import { runCommand } from "../lib/commandRunner.mjs";

export function parseTailscaleStatus(statusJson, nodeRe) {
  const peers = Object.values(statusJson?.Peer ?? {});
  const node = peers.find((p) => nodeRe.test(p.HostName || ""));
  if (!node) {
    return { id: "amber", status: "yellow", detail: "amber node not found in tailnet", online: false, lastSeen: null };
  }
  const online = Boolean(node.Online);
  return {
    id: "amber",
    status: online ? "green" : "red",
    detail: online ? `${node.HostName} online` : `${node.HostName} offline (last seen ${node.LastSeen})`,
    online,
    lastSeen: node.LastSeen ?? null,
  };
}

export async function collectAmber(nodeRe = /amber/i) {
  try {
    const { code, stdout } = await runCommand("tailscale", ["status", "--json"], { timeoutMs: 8_000 }); // 8 s: generous for local IPC, short enough to not stall dashboard
    if (code !== 0) return { id: "amber", status: "yellow", detail: "tailscale status failed", online: false, lastSeen: null };
    return parseTailscaleStatus(JSON.parse(stdout), nodeRe);
  } catch (e) {
    return { id: "amber", status: "yellow", detail: "tailscale unavailable", online: false, lastSeen: null, error: e.message };
  }
}
