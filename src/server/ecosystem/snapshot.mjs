// src/server/ecosystem/snapshot.mjs
import { collectPorts } from "./collectPorts.mjs";
import { collectRepos, isGitWorkTree } from "./collectRepos.mjs";
import { collectGovernance } from "./collectGovernance.mjs";
import { collectAmber } from "./collectAmber.mjs";
import { collectSignals } from "./collectSignals.mjs";
import { collectEvents } from "./collectEvents.mjs";
import { collectFriction, noLedgerFrictionSummary } from "./collectFriction.mjs";
import { collectMaintenance } from "./collectMaintenance.mjs";
import { activeRepoEntries, loadRepoRegistry } from "./repoRegistry.mjs";
import { loadEffectiveRegistry } from "./registryStore.mjs";
import { FORBIDDEN_PORTS } from "./portPolicy.mjs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";

const EMPTY_EVENTS = { id: "events", status: "green", detail: "0 events", count: 0, recent: [] };

// Port attribution is command-string evidence, not authority: a live process
// counts as the reserving repo's own when its recorded command line mentions
// the repo's registered path (normalized for case and separators).
function commandMentionsPath(command, repoPath) {
  if (!command || !repoPath) return false;
  const normalize = (s) => String(s).replaceAll("\\", "/").toLowerCase();
  return normalize(command).includes(normalize(repoPath));
}

// Pure: annotate port rows with the registry's reservations (#215, spec §4.5).
// reservedBy = the non-removed registry entry holding the port; conflict =
// a live process on a forbidden port, or a live process on a reserved port
// that cannot be attributed to the reserving repo (fail closed on unknown).
export function joinPortReservations(portRows, registryRepositories) {
  const reservations = new Map();
  for (const entry of registryRepositories ?? []) {
    if (entry.lifecycle === "removed") continue;
    for (const port of entry.reservedPorts ?? []) {
      if (!reservations.has(port)) reservations.set(port, entry);
    }
  }
  return (portRows ?? []).map((row) => {
    const owner = reservations.get(row.port) ?? null;
    const conflict = Boolean(
      row.live &&
        (FORBIDDEN_PORTS.includes(row.port) || (owner && !commandMentionsPath(row.command, owner.path))),
    );
    return { ...row, reservedBy: owner?.id ?? null, conflict };
  });
}

function normalizePathKey(path) {
  return String(path ?? "").replaceAll("\\", "/");
}

function frictionByNormalizedPath(friction) {
  return new Map(
    Object.entries(friction?.byPath ?? {}).map(([ledgerPath, summary]) => [normalizePathKey(ledgerPath), summary]),
  );
}

// Pure: combine collector results into the schemaVersion-1 snapshot object.
// `events` and `maintenance` are optional for backward compatibility — when
// absent, events defaults to an empty green section and repos pass through
// without a maintenance join (only a section a collector actually produced
// contributes to the green/yellow/red tally; maintenance is a per-repo field,
// never a summary section).
export function assembleSnapshot({ ports, repos, governance, amber, signals, events, friction, maintenance }, generatedAt) {
  const checks = [ports, repos, governance, amber, signals, events, friction].filter(Boolean);
  const summary = checks.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, { green: 0, yellow: 0, red: 0 });

  const registry = repos.registry ?? null;
  const portRows = registry
    ? joinPortReservations(ports.ports ?? [], registry.repositories ?? [])
    : ports.ports ?? [];
  const repoRows = maintenance?.byId
    ? (repos.repos ?? []).map((row) => ({ ...row, maintenance: maintenance.byId[row.id] ?? null }))
    : repos.repos ?? [];
  const frictionLookup = friction?.byPath ? frictionByNormalizedPath(friction) : null;
  const repoRowsWithFriction = frictionLookup
    ? repoRows.map((row) => ({
        ...row,
        friction: row.path
          ? frictionLookup.get(normalizePathKey(join(row.path, ".claude", "friction.md"))) ?? noLedgerFrictionSummary()
          : null,
      }))
    : repoRows;

  const snapshot = {
    schemaVersion: 1,
    generatedAt,
    summary,
    ports: portRows,
    repos: repoRowsWithFriction,
    repoRegistry: registry,
    governance: governance ?? { id: "governance", status: "yellow", detail: "not collected", repos: [] },
    amber,
    signals,
    events: events ?? EMPTY_EVENTS,
  };
  if (friction) snapshot.friction = friction;
  return snapshot;
}

export async function repoSignalPaths(githubRoot, registry, runCommand = defaultRunCommand) {
  if (registry) return activeRepoEntries(registry).map((entry) => entry.path).filter(Boolean);
  let entries;
  try {
    entries = await readdir(githubRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  // Match collectRepos' no-registry enumeration: skip worktree-pool / scratch
  // dirs (leading "_") and keep only real git work trees. An unfiltered readdir
  // feeds scratch dirs like _worktrees into collectFriction, inflating
  // friction.noLedger past the repos collectRepos actually reports (#233 review).
  const candidates = entries.filter((e) => e.isDirectory() && !e.name.startsWith("_"));
  const paths = [];
  for (const e of candidates) {
    const repoPath = join(githubRoot, e.name);
    if (await isGitWorkTree(repoPath, runCommand)) paths.push(repoPath);
  }
  return paths;
}

// Thin I/O wrapper: runs all collectors in parallel, joins the maintenance
// engine over their results, and assembles.
export async function buildSnapshot({ portRegistryPath, githubRoot, amberNode, anomaliesPath, repoRegistryPath } = {}) {
  // Per-repo signal files live under githubRoot: noticed.md at
  // <repo>/.claude/noticed.md and the event stream at <repo>/.archon/events.jsonl.
  // Path semantics (#214): undefined → effective registry (seed + user
  // overlay); null → no registry (enumerate githubRoot); string → that file only.
  const registry = repoRegistryPath === undefined
    ? await loadEffectiveRegistry()
    : await loadRepoRegistry(repoRegistryPath);
  const repoPaths = await repoSignalPaths(githubRoot, registry);
  const noticedPaths = repoPaths.map((repoPath) => join(repoPath, ".claude", "noticed.md"));
  const eventsJsonlPaths = repoPaths.map((repoPath) => join(repoPath, ".archon", "events.jsonl"));
  const frictionMdPaths = repoPaths.map((repoPath) => join(repoPath, ".claude", "friction.md"));

  const [ports, repos, governance, amber, signals, events, friction] = await Promise.all([
    collectPorts(portRegistryPath),
    collectRepos({ githubRoot, registry, repoRegistryPath }),
    collectGovernance(),
    collectAmber(amberNode),
    collectSignals(anomaliesPath, noticedPaths),
    collectEvents(eventsJsonlPaths),
    collectFriction(frictionMdPaths),
  ]);
  const maintenance = await collectMaintenance({ repos: repos.repos ?? [], events, governance });
  return assembleSnapshot({ ports, repos, governance, amber, signals, events, friction, maintenance }, new Date().toISOString());
}
