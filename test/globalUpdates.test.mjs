import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyGlobalUpdateToAgents,
  distributeGlobalUpdate,
  getGlobalUpdate,
  listGlobalUpdates,
} from "../src/server/globalUpdates.mjs";
import { RPC, STATE_CHANGING } from "../src/server/rpc.mjs";

test("global update catalog records the browser backend workflow fix", () => {
  const updates = listGlobalUpdates();
  const record = updates.find((entry) => entry.id === "2026-05-31-browser-backend-preflight");

  assert.ok(record);
  assert.equal(record.status, "ready");
  assert.equal(record.distribution.kind, "agents-managed-block");
  assert.match(record.agentInstruction, /ask.*disseminat/i);
  assert.match(record.confirmationPhrase, /DISTRIBUTE 2026-05-31-browser-backend-preflight/);
});

test("global update catalog records the strict PR-ready contract", () => {
  const updates = listGlobalUpdates();
  const record = updates.find((entry) => entry.id === "2026-05-31-strict-pr-ready-contract");

  assert.ok(record);
  assert.equal(record.status, "ready");
  assert.equal(record.distribution.kind, "agents-managed-block");
  assert.match(record.distribution.body, /Do not run `gh pr ready` directly/);
  assert.match(record.distribution.body, /npm run pr:contract -- --body-file "\$bodyFile"/);
  assert.doesNotMatch(record.distribution.body, /npm run pr:contract -- --body-file -/);
  assert.ok(record.source.includes("ArchonVII/repo-template PR #197"));
  assert.match(record.distribution.body, /## Summary.*## Verification.*### Verification Notes.*## Docs \/ Changelog/s);
  assert.match(record.confirmationPhrase, /DISTRIBUTE 2026-05-31-strict-pr-ready-contract/);
});

test("global update catalog records owner docs safe paths", () => {
  const updates = listGlobalUpdates();
  const record = updates.find((entry) => entry.id === "2026-06-05-owner-docs-safe-paths");

  assert.ok(record);
  assert.equal(record.status, "ready");
  assert.equal(record.distribution.kind, "agents-managed-block");
  assert.match(record.distribution.body, /add-only `docs\/\*\*` files are safe by default/);
  assert.match(record.distribution.body, /Explicit unsafe paths still win/);
  assert.match(record.confirmationPhrase, /DISTRIBUTE 2026-06-05-owner-docs-safe-paths/);
});

test("global update catalog records the agent startup baseline", () => {
  const updates = listGlobalUpdates();
  const record = updates.find((entry) => entry.id === "2026-06-09-agent-startup-baseline");

  assert.ok(record);
  assert.equal(record.status, "ready");
  assert.equal(record.distribution.kind, "agents-managed-block");
  assert.deepEqual(record.distribution.capabilityIds, ["foundation.agents", "agent-lifecycle.baseline"]);
  assert.equal(record.distribution.requireSelectedCapabilities, true);
  assert.match(record.distribution.body, /`foundation\.agents`/);
  assert.match(record.distribution.body, /`agent-lifecycle\.baseline`/);
  assert.match(record.distribution.body, /--carry <path\.\.\.>/);
  assert.match(record.distribution.body, /every dirty path must be explicitly covered/i);
  assert.ok(record.source.includes("ArchonVII/repo-template PR #193"));
  assert.doesNotMatch(record.distribution.body, /Canonical startup files and directories/);
  assert.doesNotMatch(record.distribution.body, /  - `(?:AGENTS\.md|docs\/|scripts\/|\.agent\/)/);
  assert.match(record.confirmationPhrase, /DISTRIBUTE 2026-06-09-agent-startup-baseline/);
});

test("startup baseline distribution skips repos without the lifecycle capability", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-global-update-docs-min-"));
  const repo = join(root, "repo-docs-min");
  await mkdir(join(repo, ".github"), { recursive: true });
  await writeFile(join(repo, "AGENTS.md"), "# Docs-min agents\n", "utf8");
  await writeFile(
    join(repo, ".github", "archon-setup.json"),
    `${JSON.stringify({ tool: "archon-setup", selectedFeatures: ["foundation.agents"] }, null, 2)}\n`,
    "utf8",
  );

  const record = getGlobalUpdate("2026-06-09-agent-startup-baseline");
  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: false,
    repos: [{ name: "repo-docs-min", path: repo, branch: "agent/codex/354-test", dirty: false }],
  });

  assert.deepEqual(result.results[0], {
    repo: "repo-docs-min",
    path: repo,
    branch: "agent/codex/354-test",
    updateId: record.id,
    status: "skipped",
    reason: "capability-not-selected",
    missingCapabilities: ["agent-lifecycle.baseline"],
  });
  assert.equal(await readFile(join(repo, "AGENTS.md"), "utf8"), "# Docs-min agents\n");
});

test("global update catalog records plan/status artifact closeout", () => {
  const updates = listGlobalUpdates();
  const record = updates.find((entry) => entry.id === "2026-06-10-plan-status-closeout");

  assert.ok(record);
  assert.equal(record.status, "ready");
  assert.equal(record.distribution.kind, "agents-managed-block");
  assert.match(record.distribution.body, /Delivery is incomplete while any plan/);
  assert.match(record.distribution.body, /close it, narrow it to remaining scoped work, or mark it deprecated\/superseded/);
  assert.match(record.confirmationPhrase, /DISTRIBUTE 2026-06-10-plan-status-closeout/);
});

test("applyGlobalUpdateToAgents appends and refreshes a managed update block idempotently", () => {
  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const initial = "# Agent Guide\n\nKeep local instructions.\n";

  const first = applyGlobalUpdateToAgents(initial, record);
  assert.match(first, /Keep local instructions\./);
  assert.match(first, /BEGIN ARCHONVII GLOBAL UPDATE: 2026-05-31-browser-backend-preflight/);
  assert.match(first, /Browser plugin availability and live browser backend availability are separate states/);

  const second = applyGlobalUpdateToAgents(first, record);
  assert.equal(second, first);
});

test("distributeGlobalUpdate refuses to apply without the exact confirmation phrase", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-global-update-"));
  const repo = join(root, "repo-a");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "AGENTS.md"), "# Agents\n", "utf8");

  const result = await distributeGlobalUpdate({
    updateId: "2026-05-31-browser-backend-preflight",
    confirmation: "yes",
    dryRun: false,
    repos: [{ name: "repo-a", path: repo, branch: "agent/codex/58-test", dirty: false }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "confirmation-required");
  assert.equal(await readFile(join(repo, "AGENTS.md"), "utf8"), "# Agents\n");
});

test("distributeGlobalUpdate returns explicit per-repo outcomes and persists a run log", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-global-update-"));
  const applyRepo = join(root, "repo-apply");
  const mainRepo = join(root, "repo-main");
  const dirtyRepo = join(root, "repo-dirty");
  const missingRepo = join(root, "repo-missing");
  const logPath = join(root, "runs.jsonl");

  await mkdir(applyRepo, { recursive: true });
  await mkdir(mainRepo, { recursive: true });
  await mkdir(dirtyRepo, { recursive: true });
  await mkdir(missingRepo, { recursive: true });
  await writeFile(join(applyRepo, "AGENTS.md"), "# Apply\n", "utf8");
  await writeFile(join(mainRepo, "AGENTS.md"), "# Main\n", "utf8");
  await writeFile(join(dirtyRepo, "AGENTS.md"), "# Dirty\n", "utf8");

  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: false,
    now: "2026-05-31T12:00:00.000Z",
    logPath,
    repos: [
      { name: "repo-apply", path: applyRepo, branch: "agent/codex/58-test", dirty: false },
      { name: "repo-main", path: mainRepo, branch: "main", dirty: false },
      { name: "repo-dirty", path: dirtyRepo, branch: "agent/codex/58-test", dirty: true },
      { name: "repo-missing", path: missingRepo, branch: "agent/codex/58-test", dirty: false },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 3);
  assert.deepEqual(
    result.results.map((entry) => [entry.repo, entry.status, entry.reason]),
    [
      ["repo-apply", "applied", "updated"],
      ["repo-main", "skipped", "protected-main"],
      ["repo-dirty", "skipped", "dirty-worktree"],
      ["repo-missing", "skipped", "missing-agents"],
    ],
  );

  assert.match(await readFile(join(applyRepo, "AGENTS.md"), "utf8"), /Browser Backend Preflight/);
  assert.equal(await readFile(join(mainRepo, "AGENTS.md"), "utf8"), "# Main\n");
  assert.equal(await readFile(join(dirtyRepo, "AGENTS.md"), "utf8"), "# Dirty\n");
  assert.ok(existsSync(logPath));

  const logLines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(logLines.length, 1);
  const logged = JSON.parse(logLines[0]);
  assert.equal(logged.updateId, record.id);
  assert.equal(logged.results.length, 4);
});

test("distributeGlobalUpdate dry-run reports would-apply without writing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-global-update-"));
  const repo = join(root, "repo-dry");
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, "AGENTS.md"), "# Dry\n", "utf8");

  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: true,
    repos: [{ name: "repo-dry", path: repo, branch: "agent/codex/58-test", dirty: false }],
  });

  assert.equal(result.results[0].status, "would-apply");
  assert.equal(await readFile(join(repo, "AGENTS.md"), "utf8"), "# Dry\n");
});

test("RPC exposes global update list and treats distribution as state-changing", async () => {
  const listed = await RPC["globalUpdates.list"]();

  assert.ok(listed.updates.some((entry) => entry.id === "2026-05-31-browser-backend-preflight"));
  assert.ok(listed.updates.some((entry) => entry.id === "2026-05-31-strict-pr-ready-contract"));
  assert.ok(listed.updates.some((entry) => entry.id === "2026-06-05-owner-docs-safe-paths"));
  assert.ok(listed.updates.some((entry) => entry.id === "2026-06-09-agent-startup-baseline"));
  assert.ok(listed.updates.some((entry) => entry.id === "2026-06-10-plan-status-closeout"));
  assert.equal(STATE_CHANGING.has("globalUpdates.distribute"), true);
});
