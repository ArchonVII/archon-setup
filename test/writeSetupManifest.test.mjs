import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeSetupManifest from "../src/server/tasks/writeSetupManifest.mjs";

async function makeTarget() {
  return mkdtemp(join(tmpdir(), "archon-manifest-"));
}

function makeCtx(targetPath, manifest) {
  return { targetPath, manifest };
}

test("apply preserves existing manifest history while adding the current run", async () => {
  const target = await makeTarget();
  await mkdir(join(target, ".github"), { recursive: true });
  await writeFile(
    join(target, ".github", "archon-setup.json"),
    JSON.stringify(
      {
        tool: "archon-setup",
        toolVersion: "0.1.0-pre",
        createdAt: "2026-05-31T00:00:00.000Z",
        owner: "ArchonVII",
        repo: "demo",
        visibility: "private",
        sourceSnapshots: { repoTemplate: { sha: "old" } },
        selectedFeatures: ["foundation.agents", "foundation.hooks"],
        createdFiles: [{ path: "AGENTS.md", source: "snapshot:repo-template/AGENTS.md" }],
        skippedFiles: [{ path: "README.md", reason: "already-exists" }],
        remoteActions: [{ type: "labels.apply", result: "ok" }],
        postChecks: [{ type: "branchProtection.tightenRequiredChecks", reason: "after first run" }],
      },
      null,
      2
    ) + "\n"
  );

  const manifest = {
    tool: "archon-setup",
    toolVersion: "0.1.0-pre",
    createdAt: "2026-06-09T00:00:00.000Z",
    owner: "ArchonVII",
    repo: "demo",
    visibility: "private",
    sourceSnapshots: { repoTemplate: { sha: "new" } },
    selectedFeatures: ["foundation.agents", "agent-lifecycle.baseline"],
    createdFiles: [
      { path: "AGENTS.md", source: "snapshot:repo-template/AGENTS.md" },
      { path: "scripts/agent/status.mjs", source: "snapshot:repo-template/scripts/agent/status.mjs" },
    ],
    skippedFiles: [],
    remoteActions: [],
    postChecks: [],
  };

  await writeSetupManifest.apply(makeCtx(target, manifest));

  const parsed = JSON.parse(await readFile(join(target, ".github", "archon-setup.json"), "utf8"));
  assert.equal(parsed.createdAt, "2026-06-09T00:00:00.000Z", "current run metadata wins");
  assert.deepEqual(parsed.sourceSnapshots, { repoTemplate: { sha: "new" } }, "current snapshots win");
  assert.deepEqual(parsed.selectedFeatures, ["foundation.agents", "foundation.hooks", "agent-lifecycle.baseline"]);
  assert.deepEqual(parsed.createdFiles, [
    { path: "AGENTS.md", source: "snapshot:repo-template/AGENTS.md" },
    { path: "scripts/agent/status.mjs", source: "snapshot:repo-template/scripts/agent/status.mjs" },
  ]);
  assert.deepEqual(parsed.skippedFiles, [{ path: "README.md", reason: "already-exists" }]);
  assert.deepEqual(parsed.remoteActions, [{ type: "labels.apply", result: "ok" }]);
  assert.deepEqual(parsed.postChecks, [{ type: "branchProtection.tightenRequiredChecks", reason: "after first run" }]);
  assert.deepEqual(manifest.selectedFeatures, ["foundation.agents", "agent-lifecycle.baseline"], "ctx manifest remains current-run only");
});
