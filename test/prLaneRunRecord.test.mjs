import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendRunState, readRunRecord } from "../src/server/prlane/runRecord.mjs";

const BASE_SHA = "deadbeef".repeat(5);
const MERGE_SHA = "cafebabe".repeat(5);

async function tempRecord(name) {
  const root = await mkdtemp(join(tmpdir(), `archon-prlane-${name}-`));
  return join(root, "run.jsonl");
}

test("runRecord appends valid transitions as JSONL and exposes the current state", async () => {
  const recordPath = await tempRecord("valid");

  await appendRunState({
    recordPath,
    state: "planned",
    entry: { runId: "run-159", baseSha: BASE_SHA },
    now: "2026-06-10T12:00:00.000Z",
  });
  await appendRunState({
    recordPath,
    state: "preflight_started",
    entry: { runId: "run-159", baseSha: BASE_SHA },
    now: "2026-06-10T12:00:01.000Z",
  });

  const lines = (await readFile(recordPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].state, "planned");
  assert.equal(lines[0].ts, "2026-06-10T12:00:00.000Z");
  assert.equal(lines[1].state, "preflight_started");

  const record = await readRunRecord(recordPath);
  assert.equal(record.current.state, "preflight_started");
  assert.deepEqual(
    record.entries.map((entry) => entry.state),
    ["planned", "preflight_started"],
  );
});

test("runRecord rejects missing required fields and illegal transitions", async () => {
  const recordPath = await tempRecord("invalid");

  await appendRunState({
    recordPath,
    state: "planned",
    entry: { runId: "run-159", baseSha: BASE_SHA },
  });

  await assert.rejects(
    appendRunState({
      recordPath,
      state: "worktree_created",
      entry: {
        runId: "run-159",
        baseSha: BASE_SHA,
        branch: "agent/codex/159-pr-lane",
        worktreePath: "C:\\tmp\\lane",
      },
    }),
    /illegal transition planned -> worktree_created/,
  );

  await assert.rejects(
    appendRunState({
      recordPath,
      state: "failed",
      entry: { runId: "run-159", failedStage: "planned", errorClass: "boom" },
    }),
    /missing required field "safeNextAction"/,
  );
});

test("runRecord only reopens terminal records through rollback_requested", async () => {
  const recordPath = await tempRecord("terminal");
  const common = {
    runId: "run-159",
    baseSha: BASE_SHA,
    prNumber: 457,
    mergeSha: MERGE_SHA,
  };

  for (const state of ["planned", "preflight_started", "preflight_passed"]) {
    await appendRunState({ recordPath, state, entry: { runId: "run-159", baseSha: BASE_SHA } });
  }
  await appendRunState({
    recordPath,
    state: "issue_created",
    entry: { runId: "run-159", baseSha: BASE_SHA, issueNumber: 456 },
  });
  await appendRunState({
    recordPath,
    state: "worktree_created",
    entry: {
      runId: "run-159",
      baseSha: BASE_SHA,
      branch: "agent/codex/159-pr-lane",
      worktreePath: "C:\\tmp\\lane",
    },
  });
  await appendRunState({
    recordPath,
    state: "applied",
    entry: {
      runId: "run-159",
      baseSha: BASE_SHA,
      branch: "agent/codex/159-pr-lane",
      worktreePath: "C:\\tmp\\lane",
    },
  });
  await appendRunState({
    recordPath,
    state: "verified_local",
    entry: {
      runId: "run-159",
      baseSha: BASE_SHA,
      branch: "agent/codex/159-pr-lane",
      worktreePath: "C:\\tmp\\lane",
    },
  });
  for (const state of ["committed", "pushed"]) {
    await appendRunState({
      recordPath,
      state,
      entry: { runId: "run-159", baseSha: BASE_SHA, branch: "agent/codex/159-pr-lane", headSha: BASE_SHA },
    });
  }
  await appendRunState({
    recordPath,
    state: "pr_created",
    entry: { runId: "run-159", baseSha: BASE_SHA, branch: "agent/codex/159-pr-lane", headSha: BASE_SHA, prNumber: 457 },
  });
  await appendRunState({
    recordPath,
    state: "checks_pending",
    entry: { runId: "run-159", baseSha: BASE_SHA, branch: "agent/codex/159-pr-lane", headSha: BASE_SHA, prNumber: 457 },
  });
  await appendRunState({
    recordPath,
    state: "merge_queued",
    entry: { runId: "run-159", baseSha: BASE_SHA, branch: "agent/codex/159-pr-lane", headSha: BASE_SHA, prNumber: 457 },
  });
  await appendRunState({ recordPath, state: "merged", entry: common });
  await appendRunState({ recordPath, state: "verified_merged", entry: common });
  await appendRunState({ recordPath, state: "cleaned_up", entry: common });

  await assert.rejects(
    appendRunState({
      recordPath,
      state: "failed",
      entry: { runId: "run-159", failedStage: "cleaned_up", errorClass: "late", safeNextAction: "rollback" },
    }),
    /terminal state cleaned_up may only transition to rollback_requested/,
  );

  await appendRunState({ recordPath, state: "rollback_requested", entry: { runId: "run-159", mergeSha: MERGE_SHA } });
  assert.equal((await readRunRecord(recordPath)).current.state, "rollback_requested");
});
