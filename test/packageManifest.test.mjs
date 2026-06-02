import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for the published npm package: `npm pack --dry-run --json`
// reports exactly which files `files[]` would ship. We assert the runtime set
// is complete and that tests / docs / CI config never leak into the tarball.
// (Packaging config guard — locks current correct behavior + catches drift.)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function tarballFiles() {
  // execSync (shell) so `npm`/`npm.cmd` resolves cross-platform. --json output
  // is on stdout; npm notices go to stderr, so parse from the first '['.
  const out = execSync("npm pack --dry-run --json", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const data = JSON.parse(out.slice(out.indexOf("[")));
  return data[0].files.map((f) => f.path.replace(/\\/g, "/"));
}

const FILES = tarballFiles();

// Files the package cannot run without (the CLI entrypoints, the registry, and
// the snapshots the wizard installs from).
const REQUIRED = [
  "package.json",
  "bin/archon-setup.mjs",
  "bin/onboard.mjs",
  "bin/ecosystem-snapshot.mjs",
  "src/server/index.mjs",
  "src/registry/features.json",
  "src/registry/schema.json",
  "src/snapshots/manifest.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "install.ps1", // Windows npx bootstrap (#90)
];

test("published tarball includes every runtime file", () => {
  for (const path of REQUIRED) {
    assert.ok(FILES.includes(path), `missing from published package: ${path}`);
  }
});

test("published tarball excludes tests, docs, and CI config", () => {
  const leaks = FILES.filter(
    (p) =>
      p.startsWith("test/") ||
      p.startsWith("docs/") ||
      p.startsWith(".github/") ||
      p.includes("node_modules")
  );
  assert.deepEqual(leaks, [], `unexpected files in published package: ${leaks.join(", ")}`);
});

test("published tarball ships the snapshots the wizard installs from", () => {
  assert.ok(
    FILES.some((p) => p.startsWith("src/snapshots/github-workflows/")),
    "github-workflows snapshots must ship (wizard installs callers from them)"
  );
  assert.ok(
    FILES.some((p) => p.startsWith("src/snapshots/repo-template/")),
    "repo-template snapshots must ship (wizard installs baseline files from them)"
  );
});
