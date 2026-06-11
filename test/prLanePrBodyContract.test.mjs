import { test } from "node:test";
import assert from "node:assert/strict";

import { validatePrContract } from "../src/snapshots/repo-template/scripts/pr-contract.mjs";
import { prBodyForApplySet } from "../src/server/prlane/runUpdate.mjs";
import { rollbackPrBody } from "../src/server/prlane/rollback.mjs";

// C8 (#187): the PR lane's generated bodies must satisfy the same PR contract
// the repo-template enforces on agents — validated here with the actual
// snapshot validator so the two modules can never drift apart silently.

const BLOCK_ID = "2026-01-01-review-block";
const BASE_SHA = "f00dfacef00dfacef00dfacef00dfacef00dface";
const FINGERPRINT = "0123456701234567012345670123456701234567012345670123456701234567";
const RECORD_PATH = "C:/tmp/archon-prlane-runs/run-2026-06-09-0001.jsonl";

// pr-contract treats an all-docs file list (.md and friends) as docs-only and
// skips body ceremony, so include the ownership record to force full checks.
const FILES = ["AGENTS.md", ".archon/region-ownership.json"];

function applySet({ issueNumber = 123 } = {}) {
  return {
    schemaVersion: 1,
    kind: "apply-set",
    runId: "run-2026-06-09-0001",
    repo: { owner: "ArchonVII", name: "consumer-repo", defaultBranch: "main", baseSha: BASE_SHA },
    sourceDecisionDoc: {
      fingerprint: FINGERPRINT,
      ...(issueNumber ? { issueNumber } : {}),
    },
    items: [
      {
        itemId: `agents/AGENTS.md#${BLOCK_ID}`,
        category: "agents",
        regionId: BLOCK_ID,
        file: "AGENTS.md",
        resolution: "apply-central",
        expectedFileSha256: FINGERPRINT,
        expectedRegionInnerSha256: FINGERPRINT,
        writePlan: { kind: "replace-region", sourceCatalogId: BLOCK_ID },
      },
      {
        itemId: "agents/AGENTS.md#2026-02-02-local-block",
        category: "agents",
        regionId: "2026-02-02-local-block",
        file: ".archon/region-ownership.json",
        resolution: "keep-local",
        expectedFileSha256: null,
        expectedRegionInnerSha256: null,
        writePlan: { kind: "record-ownership" },
      },
    ],
    guards: {
      allowAutoMerge: true,
      allowedPathPatterns: ["AGENTS.md", "**/AGENTS.md", ".archon/region-ownership.json"],
      requiredConfirmationPhraseHash: FINGERPRINT,
    },
  };
}

function rollbackContext({ issueNumber = 123 } = {}) {
  return {
    applySet: applySet({ issueNumber }),
    prNumber: 457,
    mergeSha: "beefcafebeefcafebeefcafebeefcafebeefcafe",
  };
}

test("generated forward PR bodies pass the repo-template PR contract", () => {
  const set = applySet();
  const body = prBodyForApplySet(set, { recordPath: RECORD_PATH });
  const result = validatePrContract({
    title: `feat(agents): apply refresh ${set.runId}`,
    body,
    branch: "agent/refresh/run-2026-06-09-0001-abc123",
    files: FILES,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.facts.docsOnly, false);
  assert.equal(result.facts.checkedVerificationCount, 1);
});

test("forward PR body evidence fence carries the real run facts", () => {
  const set = applySet();
  const body = prBodyForApplySet(set, { recordPath: RECORD_PATH });

  const fence = body.match(/```evidence\n([\s\S]*?)```/);
  assert.ok(fence, "body must contain a fenced evidence block");
  assert.match(fence[1], /runId: run-2026-06-09-0001/);
  assert.match(fence[1], new RegExp(`baseSha: ${BASE_SHA}`));
  assert.match(fence[1], new RegExp(`decisionDocFingerprint: ${FINGERPRINT}`));
  assert.match(fence[1], /items \(2\):/);
  assert.match(fence[1], /apply-central: `agents\/AGENTS\.md#2026-01-01-review-block`/);
  assert.match(fence[1], new RegExp(`runLedger: ${RECORD_PATH.replace(/[/\\]/g, "[/\\\\]")}`));
  assert.match(body, /Closes #123/);
});

test("generated rollback PR bodies pass the repo-template PR contract", () => {
  const context = rollbackContext();
  const body = rollbackPrBody(context, { recordPath: RECORD_PATH });
  const result = validatePrContract({
    title: `revert(agents): rollback refresh ${context.applySet.runId}`,
    body,
    branch: "agent/rollback/run-2026-06-09-0001-abc123",
    files: FILES,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.facts.checkedVerificationCount, 1);

  const fence = body.match(/```evidence\n([\s\S]*?)```/);
  assert.ok(fence, "rollback body must contain a fenced evidence block");
  assert.match(fence[1], /originalPr: #457/);
  assert.match(fence[1], /originalMergeSha: beefcafe/);
  assert.match(fence[1], /affectedPaths \(2\):/);
  assert.match(body, /Refs #123/);
});

test("rollback PR bodies fall back to the original PR reference when the run carried no issue", () => {
  const context = rollbackContext({ issueNumber: null });
  const body = rollbackPrBody(context, { recordPath: RECORD_PATH });
  assert.match(body, /Refs #457/);

  const result = validatePrContract({
    title: `revert(agents): rollback refresh ${context.applySet.runId}`,
    body,
    branch: "agent/rollback/run-2026-06-09-0001-abc123",
    files: FILES,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});
