// src/server/ecosystem/registryStore.mjs
//
// Effective repo registry = tracked seed + user overlay (#214, spec §4.1 in
// docs/superpowers/specs/2026-06-12-ecosystem-registry-and-maintenance-design.md).
//
// The seed (src/server/ecosystem/repoRegistry.json) stays tracked source so the
// meta-layer repos exist in any checkout/npx install. All user edits — add,
// update, lifecycle change, remove — are written to an overlay file under the
// user's archon home, never to the seed, so the UI/RPC can never dirty the
// archon-setup working tree. Registry = configuration; live status is computed
// elsewhere and never stored here.

import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validate } from "../../contracts/validate.mjs";
import { FORBIDDEN_PORTS, validateEntryPorts } from "./portPolicy.mjs";
import { writeAtomic } from "./writeAtomic.mjs";
import {
  DEFAULT_REPO_REGISTRY_PATH,
  isActiveHealthTarget,
  normalizeRepoRegistry,
} from "./repoRegistry.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(MODULE_DIR, "..", "..", "..");
const SCHEMA_PATH = join(ROOT, "src", "contracts", "schemas", "repo-registry.schema.json");
export const DEFAULT_ECOSYSTEM_MAP_PATH = join(ROOT, "config", "ecosystem-map.json");

// Keys an overlay file may persist per entry — mirrors the schema's $defs/entry.
// Runtime-only stamps (origin) must never be written back to disk.
const WRITABLE_ENTRY_KEYS = [
  "id", "name", "owner", "repo", "path", "lifecycle", "healthTarget", "role",
  "reservedPorts", "devServer", "notes", "reason", "addedAt", "updatedAt", "removedAt",
];

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function archonHome() {
  return process.env.ARCHON_HOME || join(homedir(), ".archon");
}

export function defaultOverlayPath() {
  return join(archonHome(), "repo-registry.json");
}

let schemaCache = null;
async function registrySchema() {
  if (!schemaCache) schemaCache = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  return schemaCache;
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function assertValidRegistryDoc(doc, label) {
  const result = validate(await registrySchema(), doc);
  if (!result.valid) {
    const detail = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw codedError("registry-schema-invalid", `${label} failed repo-registry schema: ${detail}`);
  }
  assertUniqueIds(doc.repositories ?? [], label);
}

// Cross-entry invariants the per-item JSON schema cannot express (#222 review
// finding 2). Enforced on every load AND every write, so hand-edited seed or
// overlay files fail closed instead of silently winning by Map-merge order.
function assertUniqueIds(repositories, label) {
  const seen = new Set();
  for (const entry of repositories) {
    if (seen.has(entry.id)) {
      throw codedError("duplicate-repo-id", `${label}: duplicate registry id "${entry.id}"`);
    }
    seen.add(entry.id);
  }
}

function assertEffectivePortInvariants(repositories, label) {
  const owners = new Map();
  for (const entry of repositories) {
    if (entry.lifecycle === "removed") continue;
    const ports = entry.reservedPorts ?? [];
    for (const port of ports) {
      if (FORBIDDEN_PORTS.includes(port)) {
        throw codedError("port-forbidden", `${label}: "${entry.id}" reserves forbidden port ${port}`);
      }
      const owner = owners.get(port);
      if (owner && owner !== entry.id) {
        throw codedError("port-conflict", `${label}: port ${port} reserved by both "${owner}" and "${entry.id}"`);
      }
      owners.set(port, entry.id);
    }
    const primaryPort = entry.devServer?.primaryPort;
    if (primaryPort !== undefined && !ports.includes(primaryPort)) {
      throw codedError(
        "dev-server-port-unreserved",
        `${label}: "${entry.id}" devServer.primaryPort ${primaryPort} is not in its reservedPorts`,
      );
    }
  }
}

// Ids defined by config/ecosystem-map.json form the protected meta-layer:
// they cannot be removed and their owner/repo/role are locked (spec §4.1).
// Fail closed: a missing/unreadable map refuses mutations rather than silently
// disabling the locks (the npx-packaging failure mode from the #222 review).
export async function metaLayerIds(mapPath = DEFAULT_ECOSYSTEM_MAP_PATH) {
  const map = await readJsonOrNull(mapPath);
  if (!map || !Array.isArray(map.repos)) {
    throw codedError("ecosystem-map-missing", `ecosystem map not readable at ${mapPath}; refusing registry mutation`);
  }
  return new Set(map.repos.map((repo) => repo.id));
}

function pickWritable(entry) {
  const out = {};
  for (const key of WRITABLE_ENTRY_KEYS) {
    if (entry[key] !== undefined && entry[key] !== null) out[key] = entry[key];
  }
  return out;
}

function summarize(repositories) {
  let active = 0;
  let inactive = 0;
  let removed = 0;
  for (const entry of repositories) {
    if (entry.lifecycle === "removed") removed += 1;
    else if (isActiveHealthTarget(entry)) active += 1;
    else inactive += 1;
  }
  return { active, inactive, removed, total: repositories.length };
}

// Merge semantics (spec §4.1): index by id; an overlay entry with a seed id
// replaces the seed entry wholesale (no per-field inheritance — auditable);
// overlay-only entries are additions. Every entry is stamped with its origin.
export async function loadEffectiveRegistry({
  seedPath = DEFAULT_REPO_REGISTRY_PATH,
  overlayPath = defaultOverlayPath(),
  mapPath = DEFAULT_ECOSYSTEM_MAP_PATH,
} = {}) {
  const seedRaw = await readJsonOrNull(seedPath);
  if (!seedRaw) throw codedError("registry-seed-missing", `repo registry seed not found at ${seedPath}`);
  await assertValidRegistryDoc(seedRaw, `seed ${seedPath}`);

  const overlayRaw = await readJsonOrNull(overlayPath);
  if (overlayRaw) {
    await assertValidRegistryDoc(overlayRaw, `overlay ${overlayPath}`);
    // Meta-layer lock at the load seam (#222 review): the tracked SEED is the
    // lock source, never the overlay — a hand-edited overlay that redefines a
    // protected repo's identity must fail closed here, not become the baseline
    // every consumer (and a later upsert comparison) silently trusts.
    const protectedIds = await metaLayerIds(mapPath);
    for (const entry of overlayRaw.repositories) {
      if (!protectedIds.has(entry.id)) continue;
      const seedEntry = seedRaw.repositories.find((e) => e.id === entry.id);
      if (!seedEntry) {
        throw codedError("meta-layer-locked", `overlay ${overlayPath}: meta-layer id "${entry.id}" has no seed entry`);
      }
      if (entry.lifecycle === "removed") {
        throw codedError("meta-layer-locked", `overlay ${overlayPath}: meta-layer repo "${entry.id}" cannot be tombstoned`);
      }
      for (const key of ["owner", "repo", "role"]) {
        if (entry[key] !== seedEntry[key]) {
          throw codedError(
            "meta-layer-locked",
            `overlay ${overlayPath}: locked "${key}" redefined for meta-layer repo "${entry.id}"`,
          );
        }
      }
    }
  }

  const merged = new Map();
  for (const entry of seedRaw.repositories) merged.set(entry.id, { ...entry, origin: "seed" });
  for (const entry of overlayRaw?.repositories ?? []) merged.set(entry.id, { ...entry, origin: "overlay" });

  const registry = normalizeRepoRegistry(
    {
      schemaVersion: seedRaw.schemaVersion,
      updatedAt: overlayRaw?.updatedAt ?? seedRaw.updatedAt ?? null,
      description: seedRaw.description ?? "",
      repositories: [...merged.values()],
    },
    seedPath,
  );
  registry.summary = summarize(registry.repositories);
  registry.overlayPath = overlayPath;
  registry.overlayPresent = Boolean(overlayRaw);
  assertEffectivePortInvariants(registry.repositories, "effective registry");
  return registry;
}

async function loadOverlayEntries(overlayPath) {
  const overlayRaw = await readJsonOrNull(overlayPath);
  if (overlayRaw) await assertValidRegistryDoc(overlayRaw, `overlay ${overlayPath}`);
  return overlayRaw?.repositories ?? [];
}

async function writeOverlayDoc(overlayPath, repositories, now) {
  const doc = {
    schemaVersion: 1,
    updatedAt: now,
    description: "User overlay for the archon-setup repo registry. Managed by archon-setup; edits via the Dashboard/CLI.",
    repositories: [...repositories].sort((a, b) => a.id.localeCompare(b.id)),
  };
  await assertValidRegistryDoc(doc, `overlay ${overlayPath}`);
  await mkdir(dirname(overlayPath), { recursive: true });
  await writeAtomic(overlayPath, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

function todayStamp(now) {
  return (now ?? new Date().toISOString()).slice(0, 10);
}

// Insert or replace one overlay entry. Fail-closed: schema, meta-layer locks,
// and the port policy are all enforced here so every caller (CLI, RPC, tests)
// goes through one gate.
export async function upsertOverlayEntry(input, {
  seedPath = DEFAULT_REPO_REGISTRY_PATH,
  overlayPath = defaultOverlayPath(),
  mapPath = DEFAULT_ECOSYSTEM_MAP_PATH,
  now = null,
} = {}) {
  const stamp = todayStamp(now);

  const effective = await loadEffectiveRegistry({ seedPath, overlayPath, mapPath });
  const existing = effective.repositories.find((entry) => entry.id === input?.id) ?? null;

  const candidate = pickWritable({
    name: input?.name ?? input?.repo,
    lifecycle: "active",
    healthTarget: input?.healthTarget ?? (input?.lifecycle ?? "active") === "active",
    ...input,
    addedAt: existing?.origin === "overlay" ? (existing.addedAt ?? stamp) : input?.addedAt ?? stamp,
    updatedAt: stamp,
  });
  await assertValidRegistryDoc({ schemaVersion: 1, repositories: [candidate] }, `entry "${candidate.id ?? "?"}"`);

  if (candidate.lifecycle === "removed") {
    throw codedError("use-remove", "use removeOverlayEntry to tombstone an entry");
  }

  // Lock source is the tracked SEED, never the (possibly hand-edited) overlay
  // copy that loadEffectiveRegistry merged over it (#222 review).
  const protectedIds = await metaLayerIds(mapPath);
  if (protectedIds.has(candidate.id)) {
    const seedRaw = await readJsonOrNull(seedPath);
    const seedEntry = (seedRaw?.repositories ?? []).find((e) => e.id === candidate.id);
    if (!seedEntry) {
      throw codedError("meta-layer-locked", `"${candidate.id}" is a meta-layer id with no seed entry; refusing`);
    }
    for (const key of ["owner", "repo", "role"]) {
      if (candidate[key] !== seedEntry[key]) {
        throw codedError("meta-layer-locked", `"${candidate.id}" is a meta-layer repo; "${key}" is locked`);
      }
    }
  }

  const ports = validateEntryPorts(candidate, effective, { excludeId: candidate.id });
  if (!ports.ok) {
    const first = ports.errors[0];
    throw codedError(first.code, `port validation failed for "${candidate.id}": ${first.detail} (port ${first.port})`);
  }

  const overlayEntries = await loadOverlayEntries(overlayPath);
  const next = overlayEntries.filter((entry) => entry.id !== candidate.id);
  next.push(candidate);
  await writeOverlayDoc(overlayPath, next, stamp);
  return { entry: candidate, overlayPath, warnings: ports.warnings };
}

// Remove an entry. Soft by default: writes a lifecycle:"removed" tombstone so
// history survives. Hard delete is only legal when the seed does not define the
// id (a pure overlay addition); meta-layer ids refuse both (spec §4.1).
export async function removeOverlayEntry(id, {
  reason = null,
  hard = false,
  seedPath = DEFAULT_REPO_REGISTRY_PATH,
  overlayPath = defaultOverlayPath(),
  mapPath = DEFAULT_ECOSYSTEM_MAP_PATH,
  now = null,
} = {}) {
  const stamp = todayStamp(now);
  const effective = await loadEffectiveRegistry({ seedPath, overlayPath, mapPath });
  const existing = effective.repositories.find((entry) => entry.id === id);
  if (!existing) throw codedError("unknown-repo", `no registry entry with id "${id}"`);

  const protectedIds = await metaLayerIds(mapPath);
  if (protectedIds.has(id)) {
    throw codedError("meta-layer-locked", `"${id}" is a meta-layer repo and cannot be removed`);
  }

  const seedRaw = await readJsonOrNull(seedPath);
  const seedHasId = (seedRaw?.repositories ?? []).some((entry) => entry.id === id);
  const overlayEntries = await loadOverlayEntries(overlayPath);

  if (hard) {
    if (seedHasId) {
      throw codedError("hard-delete-seed-entry", `"${id}" exists in the tracked seed; only soft removal is allowed`);
    }
    const next = overlayEntries.filter((entry) => entry.id !== id);
    await writeOverlayDoc(overlayPath, next, stamp);
    return { id, removed: "hard", overlayPath };
  }

  const tombstone = pickWritable({
    ...existing,
    lifecycle: "removed",
    healthTarget: false,
    removedAt: stamp,
    updatedAt: stamp,
    ...(reason ? { reason } : {}),
  });
  delete tombstone.devServer;
  const next = overlayEntries.filter((entry) => entry.id !== id);
  next.push(tombstone);
  await writeOverlayDoc(overlayPath, next, stamp);
  return { id, removed: "soft", entry: tombstone, overlayPath };
}
