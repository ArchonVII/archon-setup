import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO_REGISTRY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "repoRegistry.json"
);

export function isActiveHealthTarget(entry) {
  return entry.lifecycle === "active" && entry.healthTarget !== false;
}

export function normalizeRepoRegistry(raw, sourcePath = null) {
  if (!raw || typeof raw !== "object") {
    throw new Error("repo registry must be a JSON object");
  }
  if (!Array.isArray(raw.repositories)) {
    throw new Error("repo registry must contain repositories[]");
  }

  const repositories = raw.repositories.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`repo registry entry ${index} must be an object`);
    }
    const id = String(entry.id || entry.name || entry.repo || "").trim();
    if (!id) throw new Error(`repo registry entry ${index} is missing id/name/repo`);
    const lifecycle = String(entry.lifecycle || (entry.active === false ? "inactive" : "active")).trim();
    const healthTarget = entry.healthTarget ?? lifecycle === "active";
    return {
      ...entry,
      id,
      name: String(entry.name || entry.repo || id),
      repo: entry.repo ? String(entry.repo) : null,
      owner: entry.owner ? String(entry.owner) : null,
      path: entry.path ? String(entry.path) : null,
      lifecycle,
      healthTarget: Boolean(healthTarget),
    };
  });

  const active = repositories.filter(isActiveHealthTarget).length;
  const inactive = repositories.length - active;
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    updatedAt: raw.updatedAt ?? null,
    description: raw.description ?? "",
    sourcePath,
    repositories,
    summary: { active, inactive, total: repositories.length },
  };
}

export async function loadRepoRegistry(registryPath = DEFAULT_REPO_REGISTRY_PATH) {
  if (!registryPath) return null;
  try {
    const raw = JSON.parse(await readFile(registryPath, "utf8"));
    return normalizeRepoRegistry(raw, registryPath);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export function activeRepoEntries(registry) {
  return (registry?.repositories || []).filter(isActiveHealthTarget);
}

export function summarizeRepoRegistry(registry) {
  if (!registry) return null;
  return {
    schemaVersion: registry.schemaVersion,
    updatedAt: registry.updatedAt,
    description: registry.description,
    sourcePath: registry.sourcePath,
    active: registry.summary.active,
    inactive: registry.summary.inactive,
    total: registry.summary.total,
    repositories: registry.repositories.map((entry) => ({
      id: entry.id,
      name: entry.name,
      owner: entry.owner,
      repo: entry.repo,
      path: entry.path,
      lifecycle: entry.lifecycle,
      healthTarget: entry.healthTarget,
      role: entry.role ?? null,
      reason: entry.reason ?? null,
    })),
  };
}
