#!/usr/bin/env node
// Refresh src/snapshots/ from sibling ArchonVII repos.
//
// v0.1: expects the sibling repos to be checked out locally. Future versions
// will clone-shallow from github.com directly.

import { writeFile, cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const MODULE_PATH = fileURLToPath(import.meta.url);
const __dirname = dirname(MODULE_PATH);
export const ROOT = join(__dirname, "..");
export const SNAP = join(ROOT, "src", "snapshots");

export const SOURCES = [
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
      ".agent/startup-baseline.json",
      "docs/repo-update-log.md",
      "docs/plans/README.md",
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

export function gitOutput(path, args) {
  try {
    return execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const stderr = err.stderr?.toString().trim();
    throw new Error(`git -C ${path} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export function sha(path) {
  return gitOutput(path, ["rev-parse", "HEAD"]);
}

export function expectedRef(source) {
  if (source.ref === "main") return "refs/remotes/origin/main";
  if (/^v\d+(?:[.-].*)?$/.test(source.ref)) return `refs/tags/${source.ref}`;
  return source.ref;
}

export function validateSourceCheckout(source) {
  gitOutput(source.localPath, ["rev-parse", "--is-inside-work-tree"]);

  const dirty = gitOutput(source.localPath, ["status", "--porcelain", "--untracked-files=all"]);
  if (dirty) {
    const sample = dirty.split(/\r?\n/).slice(0, 5).join("; ");
    throw new Error(
      `Cannot refresh ${source.key}: source checkout ${source.localPath} is dirty (${sample}). ` +
        "Commit, stash, or use a clean provider worktree before refreshing snapshots."
    );
  }

  const head = sha(source.localPath);
  const ref = expectedRef(source);
  let refSha;
  try {
    refSha = gitOutput(source.localPath, ["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch (err) {
    throw new Error(
      `Cannot refresh ${source.key}: declared ref ${source.ref} (${ref}) is not available in ` +
        `${source.localPath}. Fetch the provider refs/tags or update refresh-snapshots.mjs. ${err.message}`
    );
  }

  if (head !== refSha) {
    throw new Error(
      `Cannot refresh ${source.key}: source checkout ${source.localPath} is at HEAD ${head}, ` +
        `but declared ref ${source.ref} (${ref}) resolves to ${refSha}. ` +
        "Check out the declared ref or intentionally update the snapshot source ref before refreshing."
    );
  }

  return { head, ref, refSha };
}

export function validateSourceCheckouts(sources = SOURCES) {
  const planned = [];
  for (const source of sources) {
    if (!existsSync(source.localPath)) {
      console.warn(`skip ${source.key}: ${source.localPath} not found`);
      continue;
    }
    planned.push({ source, checkout: validateSourceCheckout(source) });
  }
  return planned;
}

export async function refreshSnapshots({
  sources = SOURCES,
  snapshotRoot = SNAP,
  now = () => new Date(),
} = {}) {
  const planned = validateSourceCheckouts(sources);
  const manifest = { snapshots: {} };

  for (const { source: s, checkout } of planned) {
    const dest = join(snapshotRoot, s.snapshotDir);
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
      sha: checkout.head,
      capturedAt: now().toISOString(),
      path: `src/snapshots/${s.snapshotDir}/`,
    };
    console.log(`refreshed ${s.key} @ ${manifest.snapshots[s.key].sha.slice(0, 7)}`);
  }
  await mkdir(snapshotRoot, { recursive: true });
  await writeFile(join(snapshotRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("manifest written.");
}

if (resolve(process.argv[1] || "") === MODULE_PATH) {
  refreshSnapshots().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
