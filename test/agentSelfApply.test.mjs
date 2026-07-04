import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { selfApply, TASKS } from "../scripts/agent-self-apply.mjs";
import { REPO_TEMPLATE_SNAPSHOT, normalizeSnapshotText } from "../src/server/tasks/repoTemplateSnapshot.mjs";

const ROOT = process.cwd();

// The snapshot-owned root-baseline surface the self-apply mechanism owns. Some
// startup-baseline paths are intentionally repo-specific in archon-setup
// (AGENTS.md, check-map, PR template, package.json), so this list stays limited
// to files the root baseline derives directly from the repo-template snapshot.
const BASELINE_FILES = [
  ".agent/startup-baseline.json",
  ".github/workflows/anomaly-triage.yml",
  ".github/workflows/repo-update-log-fragment.yml",
  "docs/repo-update-log/README.md",
  "docs/agent-process/document-policy.md",
  "scripts/agent/lib.mjs",
  "scripts/agent/start-task.mjs",
  "scripts/agent/status.mjs",
  "scripts/agent/prune.mjs",
  "scripts/agent/pr-body.mjs",
  "scripts/close/lib.mjs",
  "scripts/close/scan-complete.mjs",
  "scripts/close/ci-guard.mjs",
  "scripts/doc-sweep/lib.mjs",
  "scripts/doc-sweep/git.mjs",
  "scripts/doc-sweep/sweep.mjs",
  "docs/agent-process/doc-sweep.md",
  "scripts/doc-health/lib.mjs",
  "scripts/doc-health/health.mjs",
  "docs/agent-process/doc-health.md",
];

async function snapshotBody(rel) {
  return normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, rel), "utf8"));
}

async function targetBody(root, rel) {
  return normalizeSnapshotText(await readFile(join(root, rel), "utf8"));
}

test("selfApply installs the full baseline into an empty target from the snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-self-apply-"));

  const { report } = await selfApply({ targetPath: root });

  assert.deepEqual(report.map((r) => r.status), TASKS.map(() => "applied"));
  for (const rel of BASELINE_FILES) {
    assert.equal(await targetBody(root, rel), await snapshotBody(rel), `${rel} must match the snapshot`);
  }
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["agent:status"], "node scripts/agent/status.mjs");
  assert.equal(pkg.scripts["agent:pr-body"], "node scripts/agent/pr-body.mjs");
  assert.equal(pkg.scripts["close:scan:complete"], "node scripts/close/scan-complete.mjs");
  assert.equal(pkg.scripts["close:ci:guard"], "node scripts/close/ci-guard.mjs");
});

test("current root has every path declared by the startup baseline", async () => {
  const baseline = JSON.parse(await readFile(join(ROOT, ".agent", "startup-baseline.json"), "utf8"));
  const missing = [];
  for (const rel of baseline.required) {
    try {
      await access(join(ROOT, rel));
    } catch {
      missing.push(rel);
    }
  }
  for (const rel of baseline.expectedDirectories || []) {
    try {
      await access(join(ROOT, rel));
    } catch {
      missing.push(rel);
    }
  }

  assert.deepEqual(missing, []);
});

test("selfApply is idempotent: a second run reports already-done and changes no bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-self-apply-"));
  await selfApply({ targetPath: root });

  const before = new Map();
  for (const rel of [...BASELINE_FILES, "package.json"]) {
    before.set(rel, await readFile(join(root, rel), "utf8"));
  }

  const { report, createdFiles } = await selfApply({ targetPath: root });

  assert.deepEqual(report.map((r) => r.status), TASKS.map(() => "already-done"));
  assert.deepEqual(createdFiles, []);
  for (const rel of [...BASELINE_FILES, "package.json"]) {
    assert.equal(await readFile(join(root, rel), "utf8"), before.get(rel), `${rel} must be byte-identical`);
  }
});

test("selfApply repairs drifted root copies back to the snapshot (post-refresh update path)", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-self-apply-"));
  await selfApply({ targetPath: root });

  // Simulate a stale root after a snapshot refresh changed the baseline: one
  // drifted file per task surface.
  const drifted = [
    ".agent/startup-baseline.json",
    ".github/workflows/anomaly-triage.yml",
    ".github/workflows/repo-update-log-fragment.yml",
    "docs/repo-update-log/README.md",
    "docs/agent-process/document-policy.md",
    "scripts/agent/lib.mjs",
    "scripts/doc-sweep/sweep.mjs",
    "scripts/doc-health/health.mjs",
  ];
  for (const rel of drifted) {
    await writeFile(join(root, rel), "stale root copy\n", "utf8");
  }

  const { report } = await selfApply({ targetPath: root });

  assert.deepEqual(report.map((r) => r.status), TASKS.map(() => "applied"));
  for (const rel of drifted) {
    assert.equal(await targetBody(root, rel), await snapshotBody(rel), `${rel} must be repaired from the snapshot`);
  }
});

test("checkOnly reports drift without writing anything", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-self-apply-"));
  await selfApply({ targetPath: root });
  await writeFile(join(root, "scripts/agent/lib.mjs"), "stale root copy\n", "utf8");

  const { report, createdFiles } = await selfApply({ targetPath: root, checkOnly: true });

  const byTask = Object.fromEntries(report.map((r) => [r.task, r.status]));
  assert.equal(byTask["agent-lifecycle"], "needs-apply");
  assert.equal(byTask["doc-sweep"], "already-done");
  assert.equal(byTask["root-support-docs"], "already-done");
  assert.equal(byTask["doc-health"], "already-done");
  assert.equal(byTask["startup-baseline"], "already-done");
  assert.deepEqual(createdFiles, []);
  assert.equal(await readFile(join(root, "scripts/agent/lib.mjs"), "utf8"), "stale root copy\n");
});
