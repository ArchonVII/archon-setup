import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  expectedRef,
  refreshSnapshots,
  validateSourceCheckout,
} from "../scripts/refresh-snapshots.mjs";

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function gitQuiet(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function captureThrow(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw.");
}

async function tempDir(prefix = "archon-refresh-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function initRepo(prefix = "archon-refresh-repo-") {
  const root = await tempDir(prefix);
  gitQuiet(root, ["init", "-b", "main"]);
  gitQuiet(root, ["config", "user.name", "Archon Test"]);
  gitQuiet(root, ["config", "user.email", "archon-test@example.com"]);
  return root;
}

async function commitFile(root, relativePath, body, message) {
  await mkdir(dirname(join(root, relativePath)), { recursive: true });
  await writeFile(join(root, relativePath), body, "utf8");
  gitQuiet(root, ["add", relativePath]);
  gitQuiet(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function cloneWithOrigin() {
  const seed = await initRepo("archon-refresh-seed-");
  const first = await commitFile(seed, "STARTER.md", "one\n", "first");
  const origin = await tempDir("archon-refresh-origin-");
  gitQuiet(origin, ["init", "--bare"]);
  gitQuiet(origin, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  gitQuiet(seed, ["remote", "add", "origin", origin]);
  gitQuiet(seed, ["push", "-u", "origin", "main"]);

  const local = await tempDir("archon-refresh-local-");
  execFileSync("git", ["clone", origin, local], { stdio: "ignore" });
  gitQuiet(local, ["config", "user.name", "Archon Test"]);
  gitQuiet(local, ["config", "user.email", "archon-test@example.com"]);

  return { first, local, origin };
}

const workflowSource = (localPath) => ({
  key: "githubWorkflows",
  source: "ArchonVII/github-workflows",
  localPath,
  copyFrom: "examples",
  snapshotDir: "github-workflows",
  ref: "v1",
});

test("expectedRef maps moving release refs to concrete local git refs", () => {
  assert.equal(expectedRef({ ref: "main" }), "refs/remotes/origin/main");
  assert.equal(expectedRef({ ref: "v1" }), "refs/tags/v1");
  assert.equal(expectedRef({ ref: "release-candidate" }), "release-candidate");
});

test("validateSourceCheckout accepts a clean checkout whose HEAD matches v1", async () => {
  const root = await initRepo();
  const first = await commitFile(root, "examples/repo-required-gate.yml", "gate\n", "first");
  gitQuiet(root, ["tag", "v1"]);

  const result = validateSourceCheckout(workflowSource(root));

  assert.equal(result.head, first);
  assert.equal(result.ref, "refs/tags/v1");
  assert.equal(result.refSha, first);
});

test("validateSourceCheckout rejects a dirty provider checkout", async () => {
  const root = await initRepo();
  await commitFile(root, "examples/repo-required-gate.yml", "gate\n", "first");
  gitQuiet(root, ["tag", "v1"]);
  await writeFile(join(root, "scratch.txt"), "dirty\n", "utf8");

  assert.throws(
    () => validateSourceCheckout(workflowSource(root)),
    /Cannot refresh githubWorkflows: source checkout .* is dirty .*scratch\.txt/
  );
});

test("validateSourceCheckout rejects HEAD that does not match declared v1", async () => {
  const root = await initRepo();
  const first = await commitFile(root, "examples/repo-required-gate.yml", "gate v1\n", "first");
  gitQuiet(root, ["tag", "v1"]);
  const second = await commitFile(root, "examples/repo-required-gate.yml", "gate main\n", "second");

  const error = captureThrow(() => validateSourceCheckout(workflowSource(root)));

  assert.match(error.message, /declared ref v1 \(refs\/tags\/v1\)/);
  assert.match(error.message, new RegExp(second));
  assert.match(error.message, new RegExp(first));
});

test("validateSourceCheckout rejects local main that is behind fetched origin/main", async () => {
  const { first, local, origin } = await cloneWithOrigin();
  const upstream = await tempDir("archon-refresh-upstream-");
  execFileSync("git", ["clone", origin, upstream], { stdio: "ignore" });
  gitQuiet(upstream, ["config", "user.name", "Archon Test"]);
  gitQuiet(upstream, ["config", "user.email", "archon-test@example.com"]);
  const second = await commitFile(upstream, "STARTER.md", "two\n", "second");
  gitQuiet(upstream, ["push", "origin", "HEAD:main"]);
  gitQuiet(local, ["fetch", "origin"]);

  const error = captureThrow(() =>
    validateSourceCheckout({
      key: "orgDefaults",
      source: "ArchonVII/.github",
      localPath: local,
      copyFiles: ["STARTER.md"],
      snapshotDir: "org-defaults",
      ref: "main",
    })
  );

  assert.match(error.message, /declared ref main \(refs\/remotes\/origin\/main\)/);
  assert.match(error.message, new RegExp(first));
  assert.match(error.message, new RegExp(second));
});

test("refreshSnapshots preflights every source before deleting any snapshot directory", async () => {
  const root = await initRepo();
  await commitFile(root, "examples/repo-required-gate.yml", "gate v1\n", "first");
  gitQuiet(root, ["tag", "v1"]);
  await commitFile(root, "examples/repo-required-gate.yml", "gate main\n", "second");

  const snapshotRoot = await tempDir("archon-refresh-snap-");
  await mkdir(join(snapshotRoot, "github-workflows"), { recursive: true });
  await writeFile(join(snapshotRoot, "github-workflows", "keep.txt"), "keep\n", "utf8");

  await assert.rejects(
    refreshSnapshots({ sources: [workflowSource(root)], snapshotRoot }),
    /Cannot refresh githubWorkflows/
  );

  assert.equal(await readFile(join(snapshotRoot, "github-workflows", "keep.txt"), "utf8"), "keep\n");
  assert.equal(existsSync(join(snapshotRoot, "manifest.json")), false);
});

test("refreshSnapshots writes copied files and a manifest after a clean preflight", async () => {
  const root = await initRepo();
  const head = await commitFile(root, "examples/repo-required-gate.yml", "gate v1\n", "first");
  gitQuiet(root, ["tag", "v1"]);
  const snapshotRoot = await tempDir("archon-refresh-snap-");

  await refreshSnapshots({
    sources: [workflowSource(root)],
    snapshotRoot,
    now: () => new Date("2026-06-09T00:00:00.000Z"),
  });

  assert.equal(await readFile(join(snapshotRoot, "github-workflows", "repo-required-gate.yml"), "utf8"), "gate v1\n");
  assert.deepEqual(JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8")), {
    snapshots: {
      githubWorkflows: {
        source: "ArchonVII/github-workflows",
        ref: "v1",
        sha: head,
        capturedAt: "2026-06-09T00:00:00.000Z",
        path: "src/snapshots/github-workflows/",
      },
    },
  });
});
