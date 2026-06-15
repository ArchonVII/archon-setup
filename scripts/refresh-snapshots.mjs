#!/usr/bin/env node
// Refresh src/snapshots/ from sibling ArchonVII repos.
//
// v0.1: expects the sibling repos to be checked out locally. Future versions
// will clone-shallow from github.com directly.

import { writeFile, cp, rm, mkdir, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

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
      // Navigation front doors paired with README: llms.txt is the agent front
      // door, README the human one (repo-template#94 Librarian wiki).
      "llms.txt",
      "AGENTS.md",
      ".claude/friction.md",
      ".agent/startup-baseline.json",
      "docs/repo-update-log.md",
      "docs/plans/README.md",
      "docs/template-library-inventory.md",
      "docs/agent-process/doc-sweep.md",
      "docs/agent-process/project-capsules.md",
      "projects/README.md",
      // Librarian wiki front-door + scaffold pages (repo-template#94). scripts/wiki/*
      // already flows via copyDirs:"scripts"; these are the docs/ pages a new repo
      // needs so wiki:doctor's presence checks and the front-door re-sync rule start green.
      "docs/LIBRARIAN.md",
      "docs/CANON.md",
      "docs/INDEX.md",
      "docs/project-status.md",
      "docs/raw/README.md",
      "docs/audits/README.md",
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
      ".github/workflows/anomaly-triage.yml",
      ".github/workflows/wiki-lint.yml",
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

// User-facing provider names (CLI `--only`) → source keys. A scoped refresh is
// restricted to the known ArchonVII providers; an unknown name is rejected so a
// typo cannot silently no-op or clobber the wrong snapshot.
export const PROVIDER_ALIASES = {
  "repo-template": "repoTemplate",
  "github-workflows": "githubWorkflows",
  ".github": "orgDefaults",
  "org-defaults": "orgDefaults",
};

export function resolveProviderKeys(names, sources = SOURCES) {
  const valid = new Set(sources.map((s) => s.key));
  const keys = [];
  for (const raw of names) {
    const norm = String(raw).trim();
    const key = valid.has(norm) ? norm : PROVIDER_ALIASES[norm.toLowerCase()];
    if (!key || !valid.has(key)) {
      throw new Error(
        `unknown --only provider "${raw}". Known: ${[...valid].join(", ")} ` +
          `(aliases: ${Object.keys(PROVIDER_ALIASES).join(", ")}).`
      );
    }
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

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

// Like gitOutput but without trim(): snapshot integrity compares exact file
// bodies, so trailing newlines must survive.
export function gitOutputRaw(path, args) {
  try {
    return execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr?.toString().trim();
    throw new Error(`git -C ${path} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export function normalizeEol(text) {
  // The comparison is EOL-tolerant (Windows checkouts hold CRLF working
  // copies of LF-committed provider content) but otherwise byte-exact.
  return String(text).replace(/\r\n/g, "\n");
}

export function providerPathFor(source, snapshotRelPath) {
  return source.copyFrom ? `${source.copyFrom}/${snapshotRelPath}` : snapshotRelPath;
}

export async function listSnapshotFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    // parentPath landed in node 20.12; fall back to the deprecated .path
    // spelling so the package.json engines floor (>=20) keeps working.
    .map((entry) => relative(dir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join("/"))
    .sort();
}

function gitListTree(path, pin, prefix) {
  const out = gitOutput(path, ["ls-tree", "-r", "--name-only", pin, "--", prefix]);
  return out ? out.split(/\r?\n/) : [];
}

function existsAtPin(path, pin, file) {
  try {
    gitOutput(path, ["cat-file", "-e", `${pin}:${file}`]);
    return true;
  } catch {
    return false;
  }
}

// The snapshot's contractual file set: what refresh would copy from the
// provider at the pin, per the current source config. copyFiles entries
// absent at the pin are excluded (the config can be newer than the capture).
export function expectedSnapshotFiles(source, pin) {
  const files = new Set();
  if (source.copyFrom) {
    for (const p of gitListTree(source.localPath, pin, source.copyFrom)) {
      files.add(p.slice(source.copyFrom.length + 1));
    }
  }
  for (const f of source.copyFiles || []) {
    if (existsAtPin(source.localPath, pin, f)) files.add(f);
  }
  for (const d of source.copyDirs || []) {
    for (const p of gitListTree(source.localPath, pin, d)) files.add(p);
  }
  return files;
}

// Verifies that the existing snapshot directory is what its manifest entry
// claims: the provider's content at the recorded sha. Every return path is an
// in-band status record; callers decide what blocks.
//   fresh        — no snapshot dir or no manifest entry; nothing to verify
//   unverifiable — the pinned sha is not present in the provider checkout
//   ok           — the snapshot file set and bodies match the pin (EOL-tolerant)
//   divergent    — per-file mismatches: "modified" (body differs from the pin),
//                  "extra" (file not expected at the pin), or "missing"
//                  (expected at the pin but deleted from the snapshot)
export async function verifySnapshotAgainstPin({ source, snapshotRoot, manifestEntry }) {
  const dest = join(snapshotRoot, source.snapshotDir);
  if (!manifestEntry || !existsSync(dest)) return { key: source.key, status: "fresh" };

  const pin = manifestEntry.sha;
  try {
    gitOutput(source.localPath, ["rev-parse", "--verify", `${pin}^{commit}`]);
  } catch {
    return {
      key: source.key,
      status: "unverifiable",
      pin,
      reason: `pinned sha ${pin} is not available in ${source.localPath} (fetch the provider history before refreshing)`,
    };
  }

  const mismatches = [];
  const present = await listSnapshotFiles(dest);
  const presentSet = new Set(present);
  const expected = expectedSnapshotFiles(source, pin);

  for (const rel of present) {
    if (!expected.has(rel)) {
      mismatches.push({ path: rel, kind: "extra" });
      continue;
    }
    const pinnedBody = gitOutputRaw(source.localPath, ["show", `${pin}:${providerPathFor(source, rel)}`]);
    const snapshotBody = await readFile(join(dest, rel), "utf8");
    if (normalizeEol(snapshotBody) !== normalizeEol(pinnedBody)) {
      mismatches.push({ path: rel, kind: "modified" });
    }
  }
  for (const rel of [...expected].sort()) {
    if (!presentSet.has(rel)) mismatches.push({ path: rel, kind: "missing" });
  }

  if (mismatches.length) return { key: source.key, status: "divergent", pin, mismatches };
  return { key: source.key, status: "ok", pin, checkedFiles: present.length };
}

export async function verifySnapshots({ sources = SOURCES, snapshotRoot = SNAP } = {}) {
  const manifestPath = join(snapshotRoot, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : { snapshots: {} };

  const reports = [];
  for (const source of sources) {
    if (!existsSync(source.localPath)) {
      reports.push({ key: source.key, status: "skipped", reason: `${source.localPath} not found` });
      continue;
    }
    reports.push(
      await verifySnapshotAgainstPin({
        source,
        snapshotRoot,
        manifestEntry: manifest.snapshots?.[source.key],
      })
    );
  }
  return reports;
}

export function formatDivergenceReport(reports) {
  const lines = [];
  for (const report of reports) {
    if (report.status === "divergent") {
      // 7-char short sha: git's default abbreviated display length.
      lines.push(`${report.key}: snapshot does not match its manifest pin ${report.pin.slice(0, 7)}:`);
      for (const mismatch of report.mismatches) lines.push(`  ${mismatch.kind}: ${mismatch.path}`);
    } else if (report.status === "unverifiable") {
      lines.push(`${report.key}: ${report.reason}`);
    }
  }
  return lines.join("\n");
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
  acceptSnapshotDivergence = false,
  only = null,
} = {}) {
  const scoped = Array.isArray(only) && only.length > 0;
  const selected = scoped ? sources.filter((s) => only.includes(s.key)) : sources;
  if (scoped && selected.length === 0) {
    throw new Error(`--only matched no known providers: ${only.join(", ")}`);
  }
  const planned = validateSourceCheckouts(selected);

  // Integrity gate (#200): before deleting/overwriting anything, prove the
  // existing snapshot still matches the provider at the recorded pin. A
  // mismatch means a hand-edit (or a broken pin) — surface and reconcile it
  // rather than silently clobbering it.
  const reports = await verifySnapshots({ sources: planned.map((p) => p.source), snapshotRoot });
  const blocking = reports.filter((r) => r.status === "divergent" || r.status === "unverifiable");
  if (blocking.length && !acceptSnapshotDivergence) {
    throw new Error(
      "Cannot refresh: existing snapshot content does not match its manifest pin.\n" +
        `${formatDivergenceReport(blocking)}\n` +
        "A snapshot must be a machine-written mirror of its provider at the recorded sha. " +
        "Reconcile the divergence (fix the provider, then refresh), or re-run with " +
        "--accept-snapshot-divergence to knowingly discard the listed content."
    );
  }
  if (blocking.length) {
    console.warn(
      "WARNING: --accept-snapshot-divergence is discarding snapshot content that does not match its pin:\n" +
        formatDivergenceReport(blocking)
    );
  }
  for (const report of reports) {
    if (report.status === "ok") console.log(`verified ${report.key} @ ${report.pin.slice(0, 7)} (${report.checkedFiles} files match the pin)`);
  }

  // A scoped refresh MERGES into the existing manifest so unselected providers'
  // pins survive byte-for-byte; a full refresh rebuilds from scratch (unchanged).
  const manifestPath = join(snapshotRoot, "manifest.json");
  const manifest =
    scoped && existsSync(manifestPath)
      ? JSON.parse(await readFile(manifestPath, "utf8"))
      : { snapshots: {} };
  if (!manifest.snapshots) manifest.snapshots = {};

  for (const { source: s, checkout } of planned) {
    const dest = join(snapshotRoot, s.snapshotDir);
    await rm(dest, { recursive: true, force: true });
    if (s.copyFrom) {
      await cp(join(s.localPath, s.copyFrom), dest, { recursive: true });
    } else if (s.copyFiles) {
      for (const f of s.copyFiles) {
        // The copyFiles config may be ahead of the checkout (e.g. front-door
        // paths staged before the provider pin that introduces them). Skip what
        // the source does not have, mirroring expectedSnapshotFiles()'s
        // existsAtPin tolerance so refresh and verify stay symmetric instead of
        // ENOENT-crashing on a not-yet-present entry.
        if (!existsSync(join(s.localPath, f))) continue;
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
  if (scoped) {
    const preserved = Object.keys(manifest.snapshots).filter((k) => !only.includes(k));
    console.log(
      `scope: refreshed ${only.join(", ")}; preserved ${preserved.join(", ") || "(none)"}`
    );
  }
  await mkdir(snapshotRoot, { recursive: true });
  await writeFile(join(snapshotRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("manifest written.");
}

if (resolve(process.argv[1] || "") === MODULE_PATH) {
  const argv = process.argv.slice(2);
  const onlyNames = [];
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--verify" || arg === "--accept-snapshot-divergence") continue;
    if (arg === "--only") {
      const val = argv[++i];
      if (!val) {
        console.error("--only requires a provider name");
        process.exit(2);
      }
      onlyNames.push(...val.split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (arg.startsWith("--only=")) {
      onlyNames.push(...arg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    unknown.push(arg);
  }
  if (unknown.length) {
    console.error(`unknown option(s): ${unknown.join(" ")}`);
    process.exit(2);
  }
  let onlyKeys = null;
  if (onlyNames.length) {
    try {
      onlyKeys = resolveProviderKeys(onlyNames);
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
  }

  if (argv.includes("--verify")) {
    // Read-only integrity check (npm run snapshots:verify): same comparison
    // the refresh gate runs, with no writes and a non-zero exit on divergence.
    verifySnapshots()
      .then((reports) => {
        for (const report of reports) {
          if (report.status === "ok") console.log(`ok ${report.key} @ ${report.pin.slice(0, 7)} (${report.checkedFiles} files)`);
          else if (report.status === "fresh") console.log(`fresh ${report.key} (no pinned snapshot to verify)`);
          else if (report.status === "skipped") console.warn(`skip ${report.key}: ${report.reason}`);
        }
        const blocking = reports.filter((r) => r.status === "divergent" || r.status === "unverifiable");
        if (blocking.length) {
          console.error(formatDivergenceReport(blocking));
          process.exit(1);
        }
        if (reports.every((r) => r.status === "skipped")) {
          console.warn("nothing verifiable: no provider checkouts found (verification was skipped, not passed).");
        }
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    refreshSnapshots({
      acceptSnapshotDivergence: argv.includes("--accept-snapshot-divergence"),
      only: onlyKeys,
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
