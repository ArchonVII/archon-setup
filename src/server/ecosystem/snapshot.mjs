// src/server/ecosystem/snapshot.mjs
import { collectPorts } from "./collectPorts.mjs";
import { collectRepos } from "./collectRepos.mjs";
import { collectGovernance } from "./collectGovernance.mjs";
import { collectAmber } from "./collectAmber.mjs";
import { collectSignals } from "./collectSignals.mjs";
import { collectEvents } from "./collectEvents.mjs";
import { activeRepoEntries, loadRepoRegistry } from "./repoRegistry.mjs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

const EMPTY_EVENTS = { id: "events", status: "green", detail: "0 events", count: 0, recent: [] };

// Pure: combine collector results into the schemaVersion-1 snapshot object.
// `events` is optional for backward compatibility — when absent it defaults to
// an empty green section and is NOT counted in the summary (only a section a
// collector actually produced contributes to the green/yellow/red tally).
export function assembleSnapshot({ ports, repos, governance, amber, signals, events }, generatedAt) {
  const checks = [ports, repos, governance, amber, signals, events].filter(Boolean);
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
    repoRegistry: repos.registry ?? null,
    governance: governance ?? { id: "governance", status: "yellow", detail: "not collected", repos: [] },
    amber,
    signals,
    events: events ?? EMPTY_EVENTS,
  };
}

async function repoSignalPaths(githubRoot, registry) {
  if (registry) return activeRepoEntries(registry).map((entry) => entry.path).filter(Boolean);
  try {
    const dirs = (await readdir(githubRoot, { withFileTypes: true })).filter((e) => e.isDirectory());
    return dirs.map((e) => join(githubRoot, e.name));
  } catch {
    return [];
  }
}

// Thin I/O wrapper: runs all collectors in parallel and assembles.
export async function buildSnapshot({ portRegistryPath, githubRoot, amberNode, anomaliesPath, repoRegistryPath } = {}) {
  // Per-repo signal files live under githubRoot: noticed.md at
  // <repo>/.claude/noticed.md and the event stream at <repo>/.archon/events.jsonl.
  const registry = await loadRepoRegistry(repoRegistryPath);
  const repoPaths = await repoSignalPaths(githubRoot, registry);
  const noticedPaths = repoPaths.map((repoPath) => join(repoPath, ".claude", "noticed.md"));
  const eventsJsonlPaths = repoPaths.map((repoPath) => join(repoPath, ".archon", "events.jsonl"));

  const [ports, repos, governance, amber, signals, events] = await Promise.all([
    collectPorts(portRegistryPath),
    collectRepos({ githubRoot, registry, repoRegistryPath }),
    collectGovernance(),
    collectAmber(amberNode),
    collectSignals(anomaliesPath, noticedPaths),
    collectEvents(eventsJsonlPaths),
  ]);
  return assembleSnapshot({ ports, repos, governance, amber, signals, events }, new Date().toISOString());
}
