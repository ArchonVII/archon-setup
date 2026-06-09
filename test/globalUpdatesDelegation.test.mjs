import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyGlobalUpdateToAgents,
  distributeGlobalUpdate,
  getGlobalUpdate,
} from "../src/server/globalUpdates.mjs";

// #145 PR2: distributeGlobalUpdate delegates into the shared distributor.
// Confirmation phrases and per-repo result shapes are pinned by
// test/globalUpdates.test.mjs (golden back-compat); this file pins the
// delegation-specific guarantees.

async function makeRepo(agentsBody) {
  const path = await mkdtemp(join(tmpdir(), "archon-gu-delegate-"));
  await mkdir(path, { recursive: true });
  if (agentsBody !== null) await writeFile(join(path, "AGENTS.md"), agentsBody, "utf8");
  return { name: "repo", path, branch: "agent/test/1-x", dirty: false };
}

test("delegated append produces byte-identical output to the legacy formatter", async () => {
  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const initial = "# Agent Guide\n\nKeep local instructions.\n";
  const repo = await makeRepo(initial);

  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: false,
    repos: [repo],
  });

  assert.equal(result.results[0].status, "applied");
  assert.equal(
    await readFile(join(repo.path, "AGENTS.md"), "utf8"),
    applyGlobalUpdateToAgents(initial, record),
  );
});

test("delegated refresh of a stale block matches the legacy formatter byte for byte", async () => {
  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const stale = [
    "# Agents",
    "",
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
    "outdated body",
    `<!-- END ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
    "",
  ].join("\n");
  const repo = await makeRepo(stale);

  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: false,
    repos: [repo],
  });

  assert.equal(result.results[0].status, "applied");
  assert.equal(
    await readFile(join(repo.path, "AGENTS.md"), "utf8"),
    applyGlobalUpdateToAgents(stale, record),
  );
});

test("an AGENTS.md block whose id left the catalog now surfaces as a conflict instead of being bypassed (DL5)", async () => {
  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const body = [
    "# Agents",
    "",
    "<!-- BEGIN ARCHONVII GLOBAL UPDATE: 2020-01-01-removed-update -->",
    "orphaned guidance",
    "<!-- END ARCHONVII GLOBAL UPDATE: 2020-01-01-removed-update -->",
    "",
  ].join("\n");
  const repo = await makeRepo(body);

  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: false,
    repos: [repo],
  });

  assert.equal(result.results[0].status, "failed");
  assert.equal(result.results[0].reason, "managed-region-conflict");
  // The file is never touched on conflict.
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), body);
});

test("blocks from OTHER catalog updates in the same file stay untouched and unflagged (A1/A8)", async () => {
  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const other = getGlobalUpdate("2026-05-31-strict-pr-ready-contract");
  const body = [
    "# Agents",
    "",
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${other.id} -->`,
    "old strict-pr content kept as-is",
    `<!-- END ARCHONVII GLOBAL UPDATE: ${other.id} -->`,
    "",
  ].join("\n");
  const repo = await makeRepo(body);

  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: false,
    repos: [repo],
  });

  assert.equal(result.results[0].status, "applied");
  const after = await readFile(join(repo.path, "AGENTS.md"), "utf8");
  // Other update's block untouched…
  assert.match(after, /old strict-pr content kept as-is/);
  // …and this update's block appended.
  assert.match(after, new RegExp(`BEGIN ARCHONVII GLOBAL UPDATE: ${record.id}`));
});
