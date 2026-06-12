// src/server/ecosystem/collectRepos.mjs
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import {
  activeRepoEntries,
  loadRepoRegistry,
  summarizeRepoRegistry,
} from "./repoRegistry.mjs";
import { loadEffectiveRegistry } from "./registryStore.mjs";

export function parseLastCommit(raw) {
  const line = (raw || "").trim();
  if (!line) return null;
  const [hash, committedAt, ...rest] = line.split("|");
  return { hash, committedAt, subject: rest.join("|") };
}

export function parseWorktrees(porcelain) {
  const blocks = (porcelain || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1] ?? null;
    const branchRef = /^branch (.+)$/m.exec(block)?.[1] ?? null;
    const branch = branchRef ? branchRef.replace(/^refs\/heads\//, "") : null;
    return { path, branch };
  });
}

export function isDirty(porcelain) {
  return (porcelain || "").trim().length > 0;
}

async function git(repoPath, args, runCommand = defaultRunCommand) {
  try {
    const { code, stdout } = await runCommand("git", ["-C", repoPath, ...args], { timeoutMs: 15_000 });
    return code === 0 ? stdout : null;
  } catch {
    return null; // git missing / timed out / locked index — degrade gracefully
  }
}

async function collectOneRepo(entry, runCommand = defaultRunCommand) {
  const name = entry.name;
  const repoPath = entry.path;
  const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"], runCommand);
  if (inside?.trim() !== "true") {
    return {
      id: entry.id ?? name,
      name,
      owner: entry.owner ?? null,
      repo: entry.repo ?? null,
      role: entry.role ?? null,
      lifecycle: entry.lifecycle ?? "active",
      healthTarget: entry.healthTarget ?? true,
      path: repoPath,
      available: false,
      branch: null,
      dirty: false,
      lastCommit: null,
      worktrees: [],
      reason: "not a git worktree",
    };
  }
  const [logOut, statusOut, branchOut, wtOut] = await Promise.all([
    git(repoPath, ["log", "-1", "--format=%h|%cI|%s"], runCommand),
    git(repoPath, ["status", "--porcelain"], runCommand),
    git(repoPath, ["branch", "--show-current"], runCommand),
    git(repoPath, ["worktree", "list", "--porcelain"], runCommand),
  ]);
  if (statusOut === null || branchOut === null) {
    return {
      id: entry.id ?? name,
      name,
      owner: entry.owner ?? null,
      repo: entry.repo ?? null,
      role: entry.role ?? null,
      lifecycle: entry.lifecycle ?? "active",
      healthTarget: entry.healthTarget ?? true,
      path: repoPath,
      available: false,
      branch: null,
      dirty: false,
      lastCommit: null,
      worktrees: [],
      reason: "git state unavailable",
    };
  }
  return {
    id: entry.id ?? name,
    name,
    owner: entry.owner ?? null,
    repo: entry.repo ?? null,
    role: entry.role ?? null,
    lifecycle: entry.lifecycle ?? "active",
    healthTarget: entry.healthTarget ?? true,
    path: repoPath,
    available: true,
    branch: branchOut.trim() || null,
    dirty: isDirty(statusOut),
    lastCommit: parseLastCommit(logOut ?? ""),
    worktrees: parseWorktrees(wtOut ?? ""),
  };
}

async function collectRegisteredRepos(registry, runCommand) {
  const targets = activeRepoEntries(registry);
  const repos = [];
  for (const entry of targets) {
    repos.push(await collectOneRepo(entry, runCommand));
  }
  const dirty = repos.filter((r) => r.dirty).length;
  const unavailable = repos.filter((r) => r.available === false).length;
  return {
    id: "repos",
    status: repos.length === 0 || unavailable > 0 ? "yellow" : "green",
    detail: `${repos.length} active repos, ${dirty} dirty, ${unavailable} unavailable, ${registry.summary.inactive} inactive`,
    repos,
    registry: summarizeRepoRegistry(registry),
  };
}

// Collects registered active repos when a registry is provided; otherwise
// enumerates first-level git repos under githubRoot.
export async function collectRepos(githubRoot, options = {}) {
  if (githubRoot && typeof githubRoot === "object") {
    options = githubRoot;
    githubRoot = options.githubRoot;
  }
  const runCommand = options.runCommand ?? defaultRunCommand;
  let registry = options.registry;
  if (registry === undefined && Object.hasOwn(options, "repoRegistryPath")) {
    // Path semantics (#214): undefined → effective registry (seed + user
    // overlay); null → no registry (enumerate githubRoot); string → that file only.
    registry = options.repoRegistryPath === undefined
      ? await loadEffectiveRegistry()
      : await loadRepoRegistry(options.repoRegistryPath);
  }
  if (registry) return collectRegisteredRepos(registry, runCommand);

  let entries;
  try {
    entries = await readdir(githubRoot, { withFileTypes: true });
  } catch {
    return { id: "repos", status: "yellow", detail: `no repo root at ${githubRoot}`, repos: [] };
  }
  // Skip worktree-pool / scratch dirs (e.g. _worktrees). Keep dot-repos like .github.
  const candidates = entries.filter((e) => e.isDirectory() && !e.name.startsWith("_"));
  const repos = [];
  for (const e of candidates) {
    const repoPath = join(githubRoot, e.name);
    const head = await git(repoPath, ["rev-parse", "--is-inside-work-tree"], runCommand);
    if (head?.trim() === "true") {
      repos.push(await collectOneRepo({
        id: e.name,
        name: e.name,
        path: repoPath,
        lifecycle: "active",
        healthTarget: true,
      }, runCommand));
    }
  }
  const dirty = repos.filter((r) => r.dirty).length;
  return {
    id: "repos",
    status: repos.length === 0 ? "yellow" : "green",
    detail: `${repos.length} repos, ${dirty} dirty`,
    repos,
  };
}
