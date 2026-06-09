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
  const startupBaseline = await readFile(join(targetPath, ".agent", "startup-baseline.json"), "utf8");
  const plansReadme = await readFile(join(targetPath, "docs", "plans", "README.md"), "utf8");

  assert.match(agents, /Repo update log/);
  assert.match(agents, /Agent Start Map/);
  assert.match(updateLog, /# Repository Update Log/);
  assert.equal(JSON.parse(startupBaseline).version, "2026-06-08-agent-start-map");
  assert.match(plansReadme, /docs\/plans\/YYYY-MM-DD-<slug>\.md/);
  assert.deepEqual(
    ctx.manifest.createdFiles.map((file) => file.path),
    ["AGENTS.md", "docs/repo-update-log.md", ".agent/startup-baseline.json", "docs/plans/README.md"],
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
  assert.match(reconciled, /BEGIN ARCHONVII MANAGED BLOCK: agents-start-map/);
  assert.match(reconciled, /Agent Start Map/);
  assert.doesNotMatch(reconciled, /## Checkout role \/ worktrees/);
  assert.doesNotMatch(reconciled, /Mode 1: direct edit/);
  assert.ok(
    reconciled.indexOf("BEGIN ARCHONVII MANAGED BLOCK: agents-start-map") < reconciled.indexOf("## Local workflow"),
    "managed startup block should be inserted near the top, before existing local sections",
  );
  assert.match(updateLog, /# Repository Update Log/);

  assert.equal(await writeAgentsMd.check(ctx), "already-done");
  await writeAgentsMd.apply(ctx);
  const rerun = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  assert.equal(rerun, reconciled);
});

test("writeAgentsMd moves an existing managed block near the top without duplicating it", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-buried-"));
  const existing = `# Existing Agent Guide

Intro stays first.

## Local workflow

Keep this repo-specific setup note.

<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->
old managed body
<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->
`;
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };
  await writeFile(join(targetPath, "AGENTS.md"), existing, "utf8");

  await writeAgentsMd.apply(ctx);

  const reconciled = await readFile(join(targetPath, "AGENTS.md"), "utf8");
  assert.equal((reconciled.match(/BEGIN ARCHONVII MANAGED BLOCK: agents-start-map/g) || []).length, 1);
  assert.ok(reconciled.indexOf("Intro stays first.") < reconciled.indexOf("BEGIN ARCHONVII MANAGED BLOCK: agents-start-map"));
  assert.ok(reconciled.indexOf("BEGIN ARCHONVII MANAGED BLOCK: agents-start-map") < reconciled.indexOf("## Local workflow"));
  assert.match(reconciled, /Keep this repo-specific setup note\./);
});
