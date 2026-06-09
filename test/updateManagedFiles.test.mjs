import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { updateManagedFiles, upgradeWorkflowCallers } from "../src/updater/updateManagedFiles.mjs";

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "snapshots", "github-workflows");

function snapshotBody(name) {
  return readFile(join(SNAPSHOT_DIR, name), "utf8");
}

async function makeWorkflowTarget() {
  const root = await mkdtemp(join(tmpdir(), "archon-upgrade-"));
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  return root;
}

function callerPath(root, file) {
  return join(root, ".github", "workflows", file);
}

test("updates existing managed workflow callers from snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-update-"));
  const workflowDir = join(root, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    join(workflowDir, "dependency-review.yml"),
    [
      "name: Dependency Review",
      "",
      "on:",
      "  pull_request:",
      "    branches: [main]",
      "",
      "jobs:",
      "  review:",
      "    uses: ArchonVII/github-workflows/.github/workflows/dependency-review.yml@v1",
      "",
    ].join("\n")
  );

  const result = await updateManagedFiles({ targetPath: root });
  const updated = await readFile(join(workflowDir, "dependency-review.yml"), "utf8");

  assert.equal(result.updated, 1);
  assert.match(updated, /paths:/);
  assert.match(updated, /fail-on-severity/);
});

test("preserves node-ci custom inputs while adding budget defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-update-"));
  const workflowDir = join(root, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    join(workflowDir, "ci.yml"),
    [
      "name: CI",
      "",
      "on:",
      "  pull_request:",
      "  push:",
      "    branches: [main]",
      "",
      "jobs:",
      "  ci:",
      "    uses: ArchonVII/github-workflows/.github/workflows/node-ci.yml@v1",
      "    with:",
      "      node-versions: '[\"24\"]'",
      "      typecheck-script: typecheck",
      "",
    ].join("\n")
  );

  const result = await updateManagedFiles({ targetPath: root });
  const updated = await readFile(join(workflowDir, "ci.yml"), "utf8");

  assert.equal(result.updated, 1);
  assert.match(updated, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(updated, /github\.event\.pull_request\.draft == false/);
  assert.match(updated, /node-versions: '\["24"\]'/);
  assert.match(updated, /typecheck-script: typecheck/);
  assert.equal(
    updated.match(/types: \[opened, synchronize, reopened, ready_for_review\]/g).length,
    1
  );
});

test("guards required-gate label triggers while preserving custom inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-update-"));
  const workflowDir = join(root, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    join(workflowDir, "repo-required-gate.yml"),
    [
      "name: Repo Required Gate",
      "",
      "on:",
      "  pull_request:",
      "    branches: [main]",
      "    types:",
      "      [",
      "        opened,",
      "        edited,",
      "        synchronize,",
      "        reopened,",
      "        ready_for_review,",
      "        labeled,",
      "        unlabeled,",
      "      ]",
      "  merge_group:",
      "",
      "concurrency:",
      "  group: repo-required-gate-${{ github.event.pull_request.number || github.ref }}",
      "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      "",
      "jobs:",
      "  repo-required-gate:",
      "    uses: ArchonVII/github-workflows/.github/workflows/repo-required-gate.yml@v1",
      "    with:",
      "      stack: node",
      "      npm-typecheck-script: typecheck",
      "      run-dependency-review: false",
      "",
    ].join("\n")
  );

  const result = await updateManagedFiles({ targetPath: root });
  const updated = await readFile(join(workflowDir, "repo-required-gate.yml"), "utf8");

  assert.equal(result.updated, 1);
  assert.match(updated, /types: \[opened, edited, synchronize, reopened, ready_for_review, labeled, unlabeled\]/);
  assert.match(updated, /cancel-in-progress: >-/);
  assert.match(updated, /github\.event\.action != 'labeled'/);
  assert.match(updated, /github\.event\.action != 'unlabeled'/);
  assert.match(updated, /github\.event\.label\.name == 'ci:full'/);
  assert.match(updated, /\n  repo-required-gate:\n    if: >-/);
  assert.doesNotMatch(updated, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(updated, /npm-typecheck-script: typecheck/);
  assert.match(updated, /run-dependency-review: false/);
});

test("skips local or unmanaged workflow files", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-update-"));
  const workflowDir = join(root, ".github", "workflows");
  await mkdir(workflowDir, { recursive: true });
  await writeFile(join(workflowDir, "ci.yml"), "name: Local CI\njobs: {}\n");

  const result = await updateManagedFiles({ targetPath: root });
  const current = await readFile(join(workflowDir, "ci.yml"), "utf8");

  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
  assert.equal(current, "name: Local CI\njobs: {}\n");
});

test("upgradeWorkflowCallers rewrites a drifted managed caller to the snapshot", async () => {
  const root = await makeWorkflowTarget();
  const stale = (await snapshotBody("node-ci.yml")).replace(
    "# Caller workflow for the reusable Node CI",
    "# Caller workflow (UPSTREAM CHANGED)"
  );
  await writeFile(callerPath(root, "node-ci.yml"), stale);

  const result = await upgradeWorkflowCallers({ targetPath: root });
  const after = await readFile(callerPath(root, "node-ci.yml"), "utf8");

  assert.equal(result.upgraded, 1);
  assert.ok(!after.includes("UPSTREAM CHANGED"), "stale marker should be gone after upgrade");
  assert.match(after, /Caller workflow for the reusable Node CI/);
});

test("upgradeWorkflowCallers --dry-run reports would-upgrade without writing", async () => {
  const root = await makeWorkflowTarget();
  const stale = (await snapshotBody("node-ci.yml")).replace(
    "# Caller workflow for the reusable Node CI",
    "# Caller workflow (UPSTREAM CHANGED)"
  );
  await writeFile(callerPath(root, "node-ci.yml"), stale);

  const result = await upgradeWorkflowCallers({ targetPath: root, dryRun: true });
  const after = await readFile(callerPath(root, "node-ci.yml"), "utf8");

  assert.equal(result.upgraded, 0);
  assert.ok(result.changes.some((c) => c.path.endsWith("node-ci.yml") && c.status === "would-upgrade"));
  assert.equal(after, stale, "dry-run must not write");
});

test("upgradeWorkflowCallers re-injects budget defaults stripped from a drifted caller", async () => {
  const root = await makeWorkflowTarget();
  // A caller installed before budget defaults existed: drop the draft-skip line.
  // Line-ending agnostic — the snapshot is CRLF in a Windows working tree but
  // LF on a Linux CI checkout (no .gitattributes pins it).
  const draftSkipRe =
    /[ \t]*if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\r?\n/;
  const snapshot = await snapshotBody("node-ci.yml");
  assert.ok(draftSkipRe.test(snapshot), "fixture precondition: snapshot has the draft-skip line");
  await writeFile(callerPath(root, "node-ci.yml"), snapshot.replace(draftSkipRe, ""));

  const result = await upgradeWorkflowCallers({ targetPath: root });
  const after = await readFile(callerPath(root, "node-ci.yml"), "utf8");

  assert.equal(result.upgraded, 1);
  assert.match(after, /github\.event\.pull_request\.draft == false/);
});

test("upgradeWorkflowCallers leaves a current caller and a local workflow untouched", async () => {
  const root = await makeWorkflowTarget();
  await writeFile(callerPath(root, "node-ci.yml"), await snapshotBody("node-ci.yml")); // current
  await writeFile(callerPath(root, "local.yml"), "name: Local\non: push\njobs: {}\n"); // unmanaged

  const result = await upgradeWorkflowCallers({ targetPath: root });

  assert.equal(result.upgraded, 0);
  assert.equal(result.current, 1);
  assert.equal(result.unmanaged, 1);
});

test("upgradeWorkflowCallers is idempotent — a second run upgrades nothing", async () => {
  const root = await makeWorkflowTarget();
  const stale = (await snapshotBody("node-ci.yml")).replace(
    "# Caller workflow for the reusable Node CI",
    "# Caller workflow (UPSTREAM CHANGED)"
  );
  await writeFile(callerPath(root, "node-ci.yml"), stale);

  const first = await upgradeWorkflowCallers({ targetPath: root });
  const second = await upgradeWorkflowCallers({ targetPath: root });

  assert.equal(first.upgraded, 1);
  assert.equal(second.upgraded, 0);
  assert.equal(second.current, 1);
});
