import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeAgentsMd from "../src/server/tasks/writeAgentsMd.mjs";

test("writeAgentsMd creates the agent contract and repo update log", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-"));
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };

  await writeAgentsMd.apply(ctx);

  const agents = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  const updateLog = await readFile(join(targetPath, "docs", "repo-update-log.md"), "utf8");

  assert.match(agents, /Repo update log/);
  assert.match(updateLog, /# Repository Update Log/);
  assert.deepEqual(
    ctx.manifest.createdFiles.map((file) => file.path),
    ["AGENTS.md", "docs/repo-update-log.md"],
  );
});

test("writeAgentsMd reconciles an existing agent contract idempotently", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-existing-"));
  const existing = `# Existing Agent Guide

## Local workflow

Keep this repo-specific setup note.
`;
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };
  await writeFile(join(targetPath, "AGENTS.md"), existing, "utf8");

  assert.equal(await writeAgentsMd.check(ctx), "needs-apply");
  await writeAgentsMd.apply(ctx);

  const reconciled = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  const updateLog = await readFile(join(targetPath, "docs", "repo-update-log.md"), "utf8");

  assert.match(reconciled, /Keep this repo-specific setup note\./);
  assert.match(reconciled, /BEGIN ARCHONVII MANAGED BLOCK: agents-workflow-contract/);
  assert.match(reconciled, /## Workflow/);
  assert.match(reconciled, /## Coordination/);
  assert.match(updateLog, /# Repository Update Log/);

  assert.equal(await writeAgentsMd.check(ctx), "already-done");
  await writeAgentsMd.apply(ctx);
  const rerun = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  assert.equal(rerun, reconciled);
});
