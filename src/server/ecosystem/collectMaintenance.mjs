// src/server/ecosystem/collectMaintenance.mjs
//
// I/O side of the maintenance engine (#215, spec §4.2): gathers each
// registered repo's inputs (fast status, workflow drift, snapshot-pin
// comparisons, fix queue, skill catalog, last event) and feeds the pure
// computeMaintenanceStatus. Runs after the snapshot collectors because it
// joins their results (repos, events, governance).
//
// The deep-audit cache (~/.archon/state/audit-cache.json) is deliberately NOT
// read here — the repo.audit RPC writes and joins it in lane 3 (#216); until
// then every application is judged on the fast basis.

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { checkWorkflowDrift } from "../../updater/checkWorkflowDrift.mjs";
import { computeFastStatus } from "./manifestStatus.mjs";
import { computeMaintenanceStatus } from "./maintenanceStatus.mjs";
import { REPO_ROLES } from "../../contracts/vocab.mjs";

// src/server/ecosystem -> src/snapshots/manifest.json
const DEFAULT_SNAPSHOT_MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "snapshots", "manifest.json",
);

// Provider role → its pin key in src/snapshots/manifest.json (the keys
// scripts/refresh-snapshots.mjs writes).
const PROVIDER_PIN_KEYS = Object.freeze({
  "workflow-provider": "githubWorkflows",
  "baseline-provider": "repoTemplate",
  "org-defaults-provider": "orgDefaults",
});

const KNOWN_ROLES = new Set(REPO_ROLES);

// Fix-queue statuses that still demand integrator action; `shipped` and
// `deferred` are settled (docs/ecosystem-status.md "Ecosystem Fix Queue").
const PENDING_QUEUE_STATUSES = new Set(["proposed", "source-pr", "ready-for-batch", "batched"]);

// Pure: count Ecosystem Fix Queue table rows in docs/ecosystem-status.md.
// Returns null when the section is missing (caller fails closed).
export function parseFixQueue(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Ecosystem Fix Queue\s*$/.test(line.trim()));
  if (start === -1) return null;

  let pending = 0;
  let total = 0;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^##\s/.test(line)) break; // next section
    if (!line.startsWith("|")) continue;
    const status = (line.split("|")[2] ?? "").replace(/`/g, "").trim().toLowerCase();
    if (!status || status === "status" || /^:?-{3,}:?$/.test(status)) continue; // header / separator
    total += 1;
    if (PENDING_QUEUE_STATUSES.has(status)) pending += 1;
  }
  return { pending, total };
}

async function git(repoPath, args, runCommand) {
  try {
    const { code, stdout } = await runCommand("git", ["-C", repoPath, ...args], { timeoutMs: 15_000 });
    return code === 0 ? stdout.trim() : null;
  } catch {
    return null; // git missing / timed out — degrade to "unverified"
  }
}

// git merge-base --is-ancestor: exit 0 = ancestor, 1 = not an ancestor, 128 =
// sha unknown to the repo (git docs). 1/128 both mean the pin is unreachable
// in provider history; anything else is "could not determine".
async function pinReachable(repoPath, sha, runCommand) {
  try {
    const { code } = await runCommand(
      "git", ["-C", repoPath, "merge-base", "--is-ancestor", sha, "HEAD"], { timeoutMs: 15_000 },
    );
    if (code === 0) return true;
    if (code === 1 || code === 128) return false;
    return null;
  } catch {
    return null;
  }
}

async function buildPin(key, pinnedSha, providerRepo, runCommand) {
  const pin = { key, pinnedSha: pinnedSha ?? null, localHead: null, pinReachable: null };
  if (!providerRepo?.path || providerRepo.available === false) return pin;
  pin.localHead = await git(providerRepo.path, ["rev-parse", "HEAD"], runCommand);
  if (pin.pinnedSha && pin.localHead) {
    pin.pinReachable = await pinReachable(providerRepo.path, pin.pinnedSha, runCommand);
  }
  return pin;
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFixQueuePending(integratorPath) {
  try {
    const body = await readFile(join(integratorPath, "docs", "ecosystem-status.md"), "utf8");
    return parseFixQueue(body)?.pending ?? null;
  } catch {
    return null; // fail closed: the engine reports fix-queue-pending/unreadable
  }
}

async function safeWorkflowDrift(targetPath) {
  try {
    return await checkWorkflowDrift({ targetPath });
  } catch {
    return null; // drift signal unavailable; the engine simply omits it
  }
}

// Computes a maintenance assessment for every repo row that carries a known
// registry role. Returns { byId } for assembleSnapshot's per-repo join.
export async function collectMaintenance({
  repos = [],
  events = null,
  governance = null,
  now = new Date().toISOString(),
  snapshotManifestPath = DEFAULT_SNAPSHOT_MANIFEST_PATH,
  runCommand = defaultRunCommand,
} = {}) {
  let pins = {};
  try {
    pins = JSON.parse(await readFile(snapshotManifestPath, "utf8")).snapshots ?? {};
  } catch {
    pins = {}; // providers/integrator degrade to snapshot-unverified
  }

  const lastEventByPath = new Map(
    (events?.sources ?? []).map((source) => [source.path, source.lastEventAt]),
  );

  // One pin comparison per provider, shared between that provider's own row
  // and the integrator rollup. Providers absent from the collected rows still
  // yield a pin object so the integrator reports them as unverified.
  const pinByRole = {};
  for (const [role, key] of Object.entries(PROVIDER_PIN_KEYS)) {
    const providerRepo = repos.find((row) => row.role === role) ?? null;
    pinByRole[role] = await buildPin(key, pins[key]?.sha ?? null, providerRepo, runCommand);
  }

  const byId = {};
  for (const row of repos) {
    if (!row.role || !KNOWN_ROLES.has(row.role)) continue;

    const entry = { id: row.id, role: row.role, healthTarget: row.healthTarget, lifecycle: row.lifecycle };
    const repoState = { available: row.available, dirty: row.dirty, reason: row.reason ?? null };
    const input = { entry, repoState, governance, now };

    if (row.available !== false) {
      if (row.role === "application") {
        input.fastStatus = await computeFastStatus(row.path, { snapshotManifestPath });
        input.workflowDrift = await safeWorkflowDrift(row.path);
        input.events = { lastEventAt: lastEventByPath.get(join(row.path, ".archon", "events.jsonl")) ?? null };
      } else if (row.role === "ecosystem-health-hub") {
        input.snapshotPin = {
          pins: Object.values(pinByRole),
          fixQueuePending: await readFixQueuePending(row.path),
        };
      } else if (row.role === "skill-source") {
        repoState.catalogPresent = await fileExists(join(row.path, "docs", "skill-catalog.md"));
      } else {
        // provider roles
        const pin = { ...pinByRole[row.role] };
        if (row.role === "workflow-provider") {
          // Public consumers ride the v1 tag; a HEAD the tag has not moved to
          // yet is pending the leased v1-retag (docs/MAINTENANCE.md).
          pin.v1Tag = await git(row.path, ["rev-parse", "refs/tags/v1"], runCommand);
        }
        input.snapshotPin = pin;
      }
    }

    byId[row.id] = computeMaintenanceStatus(input);
  }
  return { byId };
}
