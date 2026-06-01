// src/server/ecosystem/snapshot.mjs
import { collectPorts } from "./collectPorts.mjs";
import { collectRepos } from "./collectRepos.mjs";
import { collectGovernance } from "./collectGovernance.mjs";
import { collectAmber } from "./collectAmber.mjs";
import { collectSignals } from "./collectSignals.mjs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

// Pure: combine collector results into the schemaVersion-1 snapshot object.
export function assembleSnapshot({ ports, repos, governance, amber, signals }, generatedAt) {
  const checks = [ports, repos, governance, amber, signals].filter(Boolean);
  const summary = checks.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, { green: 0, yellow: 0, red: 0 });
  return {
    schemaVersion: 1,
    generatedAt,
    summary,
    ports: ports.ports ?? [],
    repos: repos.repos ?? [],
    governance: governance ?? { id: "governance", status: "yellow", detail: "not collected", repos: [] },
    amber,
    signals,
  };
}

// Thin I/O wrapper: runs all collectors in parallel and assembles.
export async function buildSnapshot({ portRegistryPath, githubRoot, amberNode, anomaliesPath }) {
  // noticed.md lives at <repo>/.claude/noticed.md for each repo under githubRoot
  let noticedPaths = [];
  try {
    const entries = await readdir(githubRoot, { withFileTypes: true });
    noticedPaths = entries.filter((e) => e.isDirectory()).map((e) => join(githubRoot, e.name, ".claude", "noticed.md"));
  } catch { /* no root */ }

  const [ports, repos, governance, amber, signals] = await Promise.all([
    collectPorts(portRegistryPath),
    collectRepos(githubRoot),
    collectGovernance(),
    collectAmber(amberNode),
    collectSignals(anomaliesPath, noticedPaths),
  ]);
  return assembleSnapshot({ ports, repos, governance, amber, signals }, new Date().toISOString());
}
