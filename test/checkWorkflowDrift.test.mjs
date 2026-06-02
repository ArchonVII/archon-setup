import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowDrift } from "../src/updater/checkWorkflowDrift.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, "..", "src", "snapshots", "github-workflows");
const MANIFEST = join(__dirname, "..", "src", "snapshots", "manifest.json");

function snapshotBody(name) {
  return readFile(join(SNAPSHOT_DIR, name), "utf8");
}

async function makeTarget() {
  const root = await mkdtemp(join(tmpdir(), "archon-drift-"));
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  return root;
}

function installCaller(root, fileName, body) {
  return writeFile(join(root, ".github", "workflows", fileName), body);
}

function entryFor(report, fileName) {
  return report.files.find((f) => f.path.endsWith(`/${fileName}`));
}

test("a freshly installed managed caller reports current", async () => {
  const root = await makeTarget();
  await installCaller(root, "node-ci.yml", await snapshotBody("node-ci.yml"));

  const report = await checkWorkflowDrift({ targetPath: root });

  assert.equal(entryFor(report, "node-ci.yml").status, "current");
});

test("a caller whose body diverges from the snapshot reports drifted", async () => {
  const root = await makeTarget();
  // Simulate a stale snapshot base: a non-budget line the caller no longer
  // matches (upstream github-workflows moved on since this caller was installed).
  const stale = (await snapshotBody("node-ci.yml")).replace(
    "# Caller workflow for the reusable Node CI",
    "# Caller workflow (UPSTREAM CHANGED)"
  );
  await installCaller(root, "node-ci.yml", stale);

  const report = await checkWorkflowDrift({ targetPath: root });

  assert.equal(entryFor(report, "node-ci.yml").status, "drifted");
});

test("a caller with customized inputs reports drifted (C1: upgrade replaces it)", async () => {
  const root = await makeTarget();
  const custom = (await snapshotBody("node-ci.yml")).replace(
    `node-versions: '["22"]'`,
    `node-versions: '["18"]'`
  );
  await installCaller(root, "node-ci.yml", custom);

  const report = await checkWorkflowDrift({ targetPath: root });

  assert.equal(entryFor(report, "node-ci.yml").status, "drifted");
});

test("a non-managed local workflow reports unmanaged", async () => {
  const root = await makeTarget();
  await installCaller(root, "local.yml", "name: Local\non: push\njobs: {}\n");

  const report = await checkWorkflowDrift({ targetPath: root });

  assert.equal(entryFor(report, "local.yml").status, "unmanaged");
});

test("the report is annotated with the manifest sha and capturedAt", async () => {
  const root = await makeTarget();
  await installCaller(root, "node-ci.yml", await snapshotBody("node-ci.yml"));
  const expected = JSON.parse(await readFile(MANIFEST, "utf8")).snapshots.githubWorkflows;

  const report = await checkWorkflowDrift({ targetPath: root });

  assert.equal(report.sha, expected.sha);
  assert.equal(report.capturedAt, expected.capturedAt);
});

test("a target with no workflows directory yields an empty report without throwing", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-drift-"));

  const report = await checkWorkflowDrift({ targetPath: root });

  assert.deepEqual(report.files, []);
  assert.equal(report.drifted, 0);
  assert.equal(report.current, 0);
});

test("a fresh install of every snapshot reports current with zero drift (header/normalization guard)", async () => {
  const root = await makeTarget();
  const names = (await readdir(SNAPSHOT_DIR)).filter((n) => n.endsWith(".yml"));
  for (const name of names) {
    await installCaller(root, name, await snapshotBody(name));
  }

  const report = await checkWorkflowDrift({ targetPath: root });

  const drifted = report.files.filter((f) => f.status === "drifted");
  assert.deepEqual(
    drifted.map((f) => f.path),
    [],
    "no freshly-installed snapshot should be reported as drifted"
  );
  // 15 of the 16 snapshots are reusable callers; only labeler.yml is standalone.
  assert.ok(report.current >= 15, `expected >=15 current callers, got ${report.current}`);
});
