// src/server/ecosystem/collectRepos.mjs
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../lib/commandRunner.mjs";

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

async function git(repoPath, args) {
  try {
    const { code, stdout } = await runCommand("git", ["-C", repoPath, ...args], { timeoutMs: 15_000 });
    return code === 0 ? stdout : "";
  } catch {
    return ""; // git missing / timed out / locked index — degrade gracefully
  }
}

async function collectOneRepo(name, repoPath) {
  const [logOut, statusOut, branchOut, wtOut] = await Promise.all([
    git(repoPath, ["log", "-1", "--format=%h|%cI|%s"]),
    git(repoPath, ["status", "--porcelain"]),
    git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(repoPath, ["worktree", "list", "--porcelain"]),
  ]);
  return {
    name,
    path: repoPath,
    branch: branchOut.trim() || null,
    dirty: isDirty(statusOut),
    lastCommit: parseLastCommit(logOut),
    worktrees: parseWorktrees(wtOut),
  };
}

// Enumerates first-level git repos under githubRoot and collects health for each.
export async function collectRepos(githubRoot) {
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
    const head = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    if (head.trim() === "true") repos.push(await collectOneRepo(e.name, repoPath));
  }
  const dirty = repos.filter((r) => r.dirty).length;
  return {
    id: "repos",
    status: repos.length === 0 ? "yellow" : "green",
    detail: `${repos.length} repos, ${dirty} dirty`,
    repos,
  };
}
