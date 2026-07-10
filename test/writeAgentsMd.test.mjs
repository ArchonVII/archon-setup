import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  // document-policy spec §5.1, lane 1c: foundation.agents now distributes the
  // document-policy charter alongside AGENTS.md.
  const documentPolicy = await readFile(join(targetPath, "docs", "agent-process", "document-policy.md"), "utf8");
  // #278: AGENTS.md's `## Message protocol` section links to this charter, so
  // foundation.agents must distribute it or every onboarded repo ships a
  // dangling relative link that doc-health flags.
  const messageProtocol = await readFile(join(targetPath, "docs", "agent-process", "message-protocol.md"), "utf8");

  assert.match(agents, /docs\/repo-update-log\.md/);
  assert.match(agents, /Agent Start Map/);
  assert.match(agents, /Changelog is release-class/);
  assert.doesNotMatch(agents, /pick one and delete the other/);
  assert.doesNotMatch(agents, /<Mode 1: direct edit \/ Mode 2/);
  // #306: the delivery contract ships as its own managed block, guaranteed for
  // every onboarded repo and re-syncable via the same marker mechanism.
  assert.match(agents, /<!-- BEGIN ARCHONVII MANAGED BLOCK: delivery-workflow -->/);
  assert.match(agents, /<!-- END ARCHONVII MANAGED BLOCK: delivery-workflow -->/);
  assert.match(agents, /agent\/<tool>\/<issue>-<slug>/);
  assert.match(agents, /Never commit feature work to `main`/);
  assert.match(updateLog, /# Repository Update Log/);
  assert.equal(JSON.parse(startupBaseline).version, "2026-07-04-s3-fragment-retirement");
  assert.match(plansReadme, /docs\/plans\/YYYY-MM-DD-<slug>\.md/);
  assert.ok(documentPolicy.length > 0, "document-policy.md is written");
  assert.match(messageProtocol, /# Message Protocol/, "message-protocol.md is written");
  assert.deepEqual(
    ctx.manifest.createdFiles.map((file) => file.path),
    ["AGENTS.md", "docs/repo-update-log.md", ".agent/startup-baseline.json", "docs/plans/README.md", "docs/agent-process/document-policy.md", "docs/agent-process/message-protocol.md"],
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
  // #306: an existing repo on the reconcile path must also receive the managed
  // delivery-workflow contract (the lifeloot gap), not just the start map.
  assert.match(reconciled, /BEGIN ARCHONVII MANAGED BLOCK: delivery-workflow/);
  assert.match(reconciled, /END ARCHONVII MANAGED BLOCK: delivery-workflow/);
  assert.match(reconciled, /agent\/<tool>\/<issue>-<slug>/);
  assert.match(reconciled, /Never commit feature work to `main`/);
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

test("writeAgentsMd preserves plans README YAML frontmatter while repairing baseline content", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-plans-frontmatter-"));
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };
  await mkdir(join(targetPath, "docs", "plans"), { recursive: true });
  await writeFile(
    join(targetPath, "docs", "plans", "README.md"),
    "---\nsummary: Local plans guide\nstatus: active\n---\n\n# Old Plans\n\nRepo-local wiki metadata must survive repair.\n",
    "utf8"
  );

  await writeAgentsMd.apply(ctx);

  const plansReadme = await readFile(join(targetPath, "docs", "plans", "README.md"), "utf8");
  assert.match(plansReadme, /^---\nsummary: Local plans guide\nstatus: active\n---\n\n# Plans/m);
  assert.match(plansReadme, /docs\/plans\/YYYY-MM-DD-<slug>\.md/);
  assert.doesNotMatch(plansReadme, /# Old Plans/);
  assert.equal(await writeAgentsMd.check(ctx), "already-done");
});

test("writeAgentsMd repairs a stale same-version startup baseline contract", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-agents-baseline-contract-"));
  const ctx = {
    targetPath,
    taskOptions: {},
    manifest: { createdFiles: [] },
  };

  await writeAgentsMd.apply(ctx);
  const baselinePath = join(targetPath, ".agent", "startup-baseline.json");
  const current = JSON.parse(await readFile(baselinePath, "utf8"));
  const stale = {
    ...current,
    required: current.required.filter((path) => !path.startsWith("scripts/") && path !== "package.json"),
  };
  await writeFile(baselinePath, JSON.stringify(stale, null, 2) + "\n", "utf8");

  assert.equal(await writeAgentsMd.check(ctx), "needs-apply");
  assert.equal((await writeAgentsMd.verify(ctx)).ok, false);

  await writeAgentsMd.apply(ctx);

  assert.deepEqual(JSON.parse(await readFile(baselinePath, "utf8")), current);
  assert.equal(await writeAgentsMd.check(ctx), "already-done");
});
