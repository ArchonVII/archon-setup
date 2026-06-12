import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compareManifestToPins, computeFastStatus } from "../src/server/ecosystem/manifestStatus.mjs";

// Fast status = manifest read vs current snapshot pins (#215; statuses from
// docs/FRONTEND_REDESIGN_SPEC.md §5.1).

const PINS = {
  githubWorkflows: { sha: "gw-current" },
  repoTemplate: { sha: "rt-current" },
  orgDefaults: { sha: "od-current" },
};

function manifest(sourceSnapshots) {
  return { tool: "archon-setup", sourceSnapshots };
}

test("compareManifestToPins: all pins recorded and matching is manifest_current", () => {
  const recorded = {
    githubWorkflows: { sha: "gw-current" },
    repoTemplate: { sha: "rt-current" },
    orgDefaults: { sha: "od-current" },
  };
  assert.equal(compareManifestToPins(manifest(recorded), PINS), "manifest_current");
});

test("compareManifestToPins: an older sha or a missing pin key is manifest_outdated", () => {
  assert.equal(
    compareManifestToPins(manifest({ ...PINS, repoTemplate: { sha: "rt-old" } }), PINS),
    "manifest_outdated",
  );
  assert.equal(
    compareManifestToPins(manifest({ githubWorkflows: { sha: "gw-current" } }), PINS),
    "manifest_outdated",
  );
});

test("compareManifestToPins: extra recorded keys beyond the current pins are ignored", () => {
  const recorded = { ...PINS, retired: { sha: "whatever" } };
  assert.equal(compareManifestToPins(manifest(recorded), PINS), "manifest_current");
});

test("compareManifestToPins: not comparable inputs fail to unknown_needs_audit", () => {
  assert.equal(compareManifestToPins({ tool: "other-tool" }, PINS), "unknown_needs_audit");
  assert.equal(compareManifestToPins(manifest(undefined), PINS), "unknown_needs_audit");
  assert.equal(compareManifestToPins(manifest({}), PINS), "unknown_needs_audit");
  assert.equal(compareManifestToPins(manifest(PINS), {}), "unknown_needs_audit");
  assert.equal(compareManifestToPins(null, PINS), "not_onboarded");
});

test("computeFastStatus reads the repo manifest and the snapshot pins from disk", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manifest-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const repoPath = join(root, "repo");
  await mkdir(join(repoPath, ".github"), { recursive: true });
  const pinsPath = join(root, "snapshot-manifest.json");
  await writeFile(pinsPath, JSON.stringify({ snapshots: PINS }), "utf8");
  const options = { snapshotManifestPath: pinsPath };

  // No manifest file yet.
  assert.equal(await computeFastStatus(repoPath, options), "not_onboarded");

  // Current manifest.
  await writeFile(
    join(repoPath, ".github", "archon-setup.json"),
    JSON.stringify(manifest(PINS)),
    "utf8",
  );
  assert.equal(await computeFastStatus(repoPath, options), "manifest_current");

  // Outdated manifest.
  await writeFile(
    join(repoPath, ".github", "archon-setup.json"),
    JSON.stringify(manifest({ ...PINS, githubWorkflows: { sha: "gw-old" } })),
    "utf8",
  );
  assert.equal(await computeFastStatus(repoPath, options), "manifest_outdated");

  // Corrupt manifest fails closed.
  await writeFile(join(repoPath, ".github", "archon-setup.json"), "{not json", "utf8");
  assert.equal(await computeFastStatus(repoPath, options), "unknown_needs_audit");

  // Unreadable pins file fails closed.
  await writeFile(join(repoPath, ".github", "archon-setup.json"), JSON.stringify(manifest(PINS)), "utf8");
  assert.equal(
    await computeFastStatus(repoPath, { snapshotManifestPath: join(root, "missing.json") }),
    "unknown_needs_audit",
  );
});
