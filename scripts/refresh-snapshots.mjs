#!/usr/bin/env node
// Refresh src/snapshots/ from sibling ArchonVII repos.
//
// v0.1: expects the sibling repos to be checked out locally. Future versions
// will clone-shallow from github.com directly.

import { readFile, writeFile, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SNAP = join(ROOT, "src", "snapshots");

const SOURCES = [
  {
    key: "githubWorkflows",
    source: "ArchonVII/github-workflows",
    localPath: process.env.ARCHON_GITHUB_WORKFLOWS || "C:/github/github-workflows",
    copyFrom: "examples",
    snapshotDir: "github-workflows",
    ref: "v1",
  },
  {
    key: "repoTemplate",
    source: "ArchonVII/repo-template",
    localPath: process.env.ARCHON_REPO_TEMPLATE || "C:/github/repo-template",
    copyFiles: ["AGENTS.md"],
    snapshotDir: "repo-template",
    ref: "main",
  },
  {
    key: "orgDefaults",
    source: "ArchonVII/.github",
    localPath: process.env.ARCHON_DOT_GITHUB || "C:/github/.github",
    copyFiles: ["STARTER.md"],
    snapshotDir: "org-defaults",
    ref: "main",
  },
];

function sha(path) {
  return execSync("git rev-parse HEAD", { cwd: path }).toString().trim();
}

async function run() {
  const manifest = { snapshots: {} };
  for (const s of SOURCES) {
    if (!existsSync(s.localPath)) {
      console.warn(`skip ${s.key}: ${s.localPath} not found`);
      continue;
    }
    const dest = join(SNAP, s.snapshotDir);
    await rm(dest, { recursive: true, force: true });
    if (s.copyFrom) {
      await cp(join(s.localPath, s.copyFrom), dest, { recursive: true });
    } else if (s.copyFiles) {
      for (const f of s.copyFiles) {
        await cp(join(s.localPath, f), join(dest, f), { recursive: false });
      }
    }
    manifest.snapshots[s.key] = {
      source: s.source,
      ref: s.ref,
      sha: sha(s.localPath),
      capturedAt: new Date().toISOString(),
      path: `src/snapshots/${s.snapshotDir}/`,
    };
    console.log(`refreshed ${s.key} @ ${manifest.snapshots[s.key].sha.slice(0, 7)}`);
  }
  await writeFile(join(SNAP, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("manifest written.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
