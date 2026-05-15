import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateManagedFiles } from "../src/updater/updateManagedFiles.mjs";

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
