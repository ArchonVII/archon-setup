#!/usr/bin/env node
// Refresh src/snapshots/ from sibling ArchonVII repos.
//
// v0.1: expects the sibling repos to be checked out locally. Future versions
// will clone-shallow from github.com directly.

import { writeFile, cp, rm, mkdir } from "node:fs/promises";
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
    localPath: process.env.ARCHON_GITHUB_WORKFLOWS || "C:/GitHub/github-workflows",
    copyFrom: "examples",
    snapshotDir: "github-workflows",
    ref: "v1",
  },
  {
    key: "repoTemplate",
    source: "ArchonVII/repo-template",
    localPath: process.env.ARCHON_REPO_TEMPLATE || "C:/GitHub/repo-template",
    copyFiles: [
      "README.md",
      "AGENTS.md",
      "docs/repo-update-log.md",
      "docs/template-library-inventory.md",
      "docs/agent-process/doc-sweep.md",
      "package.json",
      // repo-template is depless: it has no package-lock.json to copy. It now
      // ships a `.npmrc` (package-lock=false) instead; that is not mirrored here
      // because npm never packs `.npmrc`, so it could not ship in the snapshot
      // and no onboarding task installs it (scaffolded repos get no package.json).
      // See repo-template#52.
      ".agent/check-map.yml",
      ".agent/coordination/README.md",
      ".agent/coordination/board.md",
      ".githooks/commit-msg",
      ".githooks/pre-commit",
      ".githooks/scripts/install-githooks.sh",
      ".githooks/scripts/owner-maintenance.sh",
      ".githooks/scripts/test-owner-maintenance.sh",
      ".githooks/scripts/checkout-role.sh",
      ".githooks/scripts/checkout-doctor.sh",
      ".githooks/scripts/test-checkout-role.sh",
      ".gitattributes",
      "CHANGELOG.md",
      ".changelog/unreleased/README.md",
      ".github/CODEOWNERS",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/dependabot.yml",
      ".github/workflows/actionlint.yml",
    ],
    copyDirs: [
      "examples",
      "schemas",
      "scripts",
      "styles",
      "templates",
      "test",
    ],
    snapshotDir: "repo-template",
    ref: "main",
  },
  {
    key: "orgDefaults",
    source: "ArchonVII/.github",
    localPath: process.env.ARCHON_DOT_GITHUB || "C:/GitHub/.github",
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
        await mkdir(dirname(join(dest, f)), { recursive: true });
        await cp(join(s.localPath, f), join(dest, f), { recursive: false });
      }
    }
    if (s.copyDirs) {
      for (const d of s.copyDirs) {
        await cp(join(s.localPath, d), join(dest, d), { recursive: true });
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
