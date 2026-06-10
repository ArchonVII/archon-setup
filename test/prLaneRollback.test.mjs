import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommand } from "../src/server/lib/commandRunner.mjs";
import { appendRunState, readRunRecord } from "../src/server/prlane/runRecord.mjs";
import { runUpdate } from "../src/server/prlane/runUpdate.mjs";
import { cleanupRun, rollbackRun, verifyMergedRun } from "../src/server/prlane/rollback.mjs";

const BLOCK_ID = "2026-01-01-review-block";
const PHRASE = "APPLY consumer-repo run-2026-06-09-0001";
const NOW = "2026-06-10T12:00:00.000Z";
const BIN = join(process.cwd(), "bin", "archon-setup.mjs");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function managedBlock(inner) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${BLOCK_ID} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${BLOCK_ID} -->`,
    "",
  ].join("\n");
}

function catalog(inner = "## Review Block\n\n- Central guidance.") {
  return {
    entries: [
      {
        id: BLOCK_ID,
        group: "agents",
        provider: "globalUpdates",
        adapter: "markdown",
        targetRelpath: "AGENTS.md",
        wholeFile: false,
        appliesToDefault: "existing-file-only",
        inner,
        markerShape: "global-update",
        anchor: { kind: "eof-append" },
        protectedBranches: ["main", "master"],
      },
    ],
    knownIds: new Set([BLOCK_ID]),
  };
}

function applySet(baseSha) {
  const staleInner = "stale guidance";
  const staleBody = `# Agents\n\n${managedBlock(staleInner)}`;
  return {
    schemaVersion: 1,
    kind: "apply-set",
    runId: "run-2026-06-09-0001",
    repo: { owner: "ArchonVII", name: "consumer-repo", defaultBranch: "main", baseSha },
    sourceDecisionDoc: {
      fingerprint: "0123456701234567012345670123456701234567012345670123456701234567",
      issueNumber: 123,
    },
    items: [
      {
        itemId: `agents/AGENTS.md#${BLOCK_ID}`,
        category: "agents",
        regionId: BLOCK_ID,
        file: "AGENTS.md",
        resolution: "apply-central",
        expectedFileSha256: sha256(staleBody),
        expectedRegionInnerSha256: sha256(staleInner),
        writePlan: { kind: "replace-region", sourceCatalogId: BLOCK_ID },
      },
    ],
    guards: {
      allowAutoMerge: true,
      allowedPathPatterns: ["AGENTS.md", "**/AGENTS.md", ".archon/region-ownership.json"],
      requiredConfirmationPhraseHash: sha256(PHRASE),
    },
  };
}

async function makeRepo(body = `# Agents\n\n${managedBlock("stale guidance")}`) {
  const root = await mkdtemp(join(tmpdir(), "archon-prlane-m4-"));
  const target = join(root, "consumer-repo");
  const remote = join(root, "consumer-repo.git");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "AGENTS.md"), body, "utf8");

  git(target, ["init", "-b", "main"]);
  git(target, ["config", "user.email", "agent@example.test"]);
  git(target, ["config", "user.name", "Archon Agent"]);
  git(target, ["add", "AGENTS.md"]);
  git(target, ["commit", "-m", "chore: seed fixture"]);
  git(root, ["init", "--bare", "-b", "main", remote]);
  git(target, ["remote", "add", "origin", remote]);
  git(target, ["push", "-u", "origin", "main"]);

  return { root, target, originalBody: body, baseSha: git(target, ["rev-parse", "HEAD"]) };
}

function fakeGh(calls, { checks = [{ name: "test", status: "passed" }] } = {}) {
  let nextPr = 457;
  return async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "pr" && args[1] === "create") {
      return { code: 0, stdout: `https://github.com/ArchonVII/consumer-repo/pull/${nextPr++}\n`, stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "pr" && args[1] === "checks") return { code: 0, stdout: JSON.stringify(checks), stderr: "" };
    if (args[0] === "pr" && args[1] === "merge") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "pr" && args[1] === "close") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
}

async function executeAutoRun(repo, { recordPath = join(repo.root, "run.jsonl") } = {}) {
  const ghCalls = [];
  const result = await runUpdate({
    applySet: applySet(repo.baseSha),
    targetPath: repo.target,
    mode: "auto",
    confirmationPhrase: PHRASE,
    recordPath,
    workRoot: join(repo.root, "worktrees"),
    catalog: catalog(),
    requiredChecks: ["test"],
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });
  assert.equal(result.state, "merge_queued");
  return { ...result, recordPath, ghCalls };
}

function mergeRefreshBranch(repo, branch, { mode = "squash" } = {}) {
  git(repo.target, ["checkout", "main"]);
  git(repo.target, ["fetch", "origin", branch]);
  if (mode === "merge") {
    git(repo.target, ["merge", "--no-ff", `origin/${branch}`, "-m", `Merge ${branch}`]);
  } else {
    git(repo.target, ["merge", "--squash", `origin/${branch}`]);
    git(repo.target, ["commit", "-m", `Squash ${branch}`]);
  }
  git(repo.target, ["push", "origin", "main"]);
  return git(repo.target, ["rev-parse", "HEAD"]);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalized(text) {
  return text.replace(/\r\n/g, "\n");
}

test("verifyMergedRun audits the merge commit and cleanupRun is idempotent", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  const mergeSha = mergeRefreshBranch(repo, run.branch, { mode: "squash" });

  const verified = await verifyMergedRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    catalog: catalog(),
    runCommand,
    now: () => NOW,
  });

  assert.equal(verified.state, "verified_merged");
  assert.equal(verified.report.mergeSha, mergeSha);
  assert.deepEqual(verified.report.verification.postMerge, {
    status: "passed",
    detail: "post-merge audit on merge commit: clean",
  });

  const firstCleanup = await cleanupRun({ recordPath: run.recordPath, runCommand, now: () => NOW });
  const secondCleanup = await cleanupRun({ recordPath: run.recordPath, runCommand, now: () => NOW });

  assert.equal(firstCleanup.state, "cleaned_up");
  assert.equal(secondCleanup.state, "cleaned_up");
  assert.equal(await pathExists(run.worktreePath), false);
  assert.equal(git(repo.target, ["branch", "--list", run.branch]), "");

  const record = await readRunRecord(run.recordPath);
  assert.equal(record.entries.filter((entry) => entry.state === "cleaned_up").length, 1);
});

test("verifyMergedRun returns a rollback-ready failed report when the merge audit is not clean", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  mergeRefreshBranch(repo, run.branch, { mode: "squash" });

  const verified = await verifyMergedRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    catalog: catalog("## Review Block\n\n- Changed after merge."),
    runCommand,
    now: () => NOW,
  });

  assert.equal(verified.state, "failed");
  assert.equal(verified.report.verification.postMerge.status, "failed");
  assert.match(verified.report.rollbackCommand, /rollback --run run-2026-06-09-0001/);

  const record = await readRunRecord(run.recordPath);
  assert.deepEqual(
    record.entries.slice(-2).map((entry) => entry.state),
    ["merged", "failed"],
  );
});

test("rollbackRun creates a squash revert PR branch without mutating main", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  const mergeSha = mergeRefreshBranch(repo, run.branch, { mode: "squash" });
  await verifyMergedRun({ recordPath: run.recordPath, targetPath: repo.target, catalog: catalog(), runCommand, now: () => NOW });

  const ghCalls = [];
  const rollback = await rollbackRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    catalog: catalog(),
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });

  assert.equal(rollback.state, "rollback_pr_created");
  assert.match(rollback.rollbackBranch, /^agent\/rollback\/run-2026-06-09-0001-/);
  assert.equal(git(repo.target, ["rev-parse", "HEAD"]), mergeSha, "rollback must not mutate main directly");
  assert.equal(normalized(await readFile(join(rollback.rollbackWorktreePath, "AGENTS.md"), "utf8")), repo.originalBody);
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "merge"), false);

  const record = await readRunRecord(run.recordPath);
  assert.deepEqual(
    record.entries.slice(-2).map((entry) => entry.state),
    ["rollback_requested", "rollback_pr_created"],
  );
});

test("rollbackRun uses mainline revert for merge commits", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  const mergeSha = mergeRefreshBranch(repo, run.branch, { mode: "merge" });
  await verifyMergedRun({ recordPath: run.recordPath, targetPath: repo.target, catalog: catalog(), runCommand, now: () => NOW });

  const gitCalls = [];
  const recordingRunCommand = async (cmd, args, options = {}) => {
    gitCalls.push({ cmd, args });
    return runCommand(cmd, args, options);
  };

  const rollback = await rollbackRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    catalog: catalog(),
    runCommand: recordingRunCommand,
    runGh: fakeGh([]),
    now: () => NOW,
  });

  assert.equal(rollback.state, "rollback_pr_created");
  assert.equal(normalized(await readFile(join(rollback.rollbackWorktreePath, "AGENTS.md"), "utf8")), repo.originalBody);
  assert.ok(
    gitCalls.some(
      (call) =>
        call.cmd === "git" &&
        call.args.includes("revert") &&
        call.args.includes("-m") &&
        call.args.includes("1") &&
        call.args.includes(mergeSha),
    ),
    "merge commits must be reverted with git revert -m 1",
  );
});

test("rollbackRun treats an already-reverted merge as verified without opening a duplicate PR", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  const mergeSha = mergeRefreshBranch(repo, run.branch, { mode: "squash" });
  await verifyMergedRun({ recordPath: run.recordPath, targetPath: repo.target, catalog: catalog(), runCommand, now: () => NOW });

  git(repo.target, ["revert", "--no-edit", mergeSha]);
  const revertSha = git(repo.target, ["rev-parse", "HEAD"]);
  git(repo.target, ["push", "origin", "main"]);

  const ghCalls = [];
  const rollback = await rollbackRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    catalog: catalog(),
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });

  assert.equal(rollback.state, "rollback_verified");
  assert.equal(rollback.alreadyReverted, true);
  assert.equal(rollback.report.mergeSha, mergeSha);
  assert.equal(rollback.rollbackMergeSha, revertSha);
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "create"), false);

  const record = await readRunRecord(run.recordPath);
  assert.deepEqual(
    record.entries.slice(-2).map((entry) => entry.state),
    ["rollback_requested", "rollback_verified"],
  );
});

test("rollbackRun stops safely on later same-region collisions", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  const mergeSha = mergeRefreshBranch(repo, run.branch, { mode: "squash" });
  await verifyMergedRun({ recordPath: run.recordPath, targetPath: repo.target, catalog: catalog(), runCommand, now: () => NOW });

  await writeFile(join(repo.target, "AGENTS.md"), `# Agents\n\n${managedBlock("local guidance after merge")}`, "utf8");
  git(repo.target, ["add", "AGENTS.md"]);
  git(repo.target, ["commit", "-m", "docs: local follow-up"]);
  git(repo.target, ["push", "origin", "main"]);

  const ghCalls = [];
  const rollback = await rollbackRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    catalog: catalog(),
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });

  assert.equal(rollback.state, "failed");
  assert.equal(rollback.report.failure.failedStage, "rollback_requested");
  assert.match(rollback.report.failure.safeNextAction, /manual review/);
  assert.equal(git(repo.target, ["rev-parse", mergeSha]), mergeSha);
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "create"), false);
});

test("CLI cleanup --run resolves run records and emits JSON", async () => {
  const repo = await makeRepo();
  const recordRoot = join(repo.root, "records");
  const run = await executeAutoRun(repo, { recordPath: join(recordRoot, "run-2026-06-09-0001.jsonl") });
  mergeRefreshBranch(repo, run.branch, { mode: "squash" });
  await verifyMergedRun({ recordPath: run.recordPath, targetPath: repo.target, catalog: catalog(), runCommand, now: () => NOW });

  const result = spawnSync(
    process.execPath,
    [BIN, "cleanup", "--run", "run-2026-06-09-0001", "--record-root", recordRoot, "--json"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.state, "cleaned_up");
  assert.equal(payload.report.runId, "run-2026-06-09-0001");
  assert.equal(await pathExists(run.worktreePath), false);
});

test("cleanupRun reports remote branch deletion failures before marking cleaned", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  mergeRefreshBranch(repo, run.branch, { mode: "squash" });
  await verifyMergedRun({ recordPath: run.recordPath, targetPath: repo.target, catalog: catalog(), runCommand, now: () => NOW });

  const failingRemoteDelete = async (cmd, args, options = {}) => {
    if (cmd === "git" && args.includes("push") && args.includes("--delete")) {
      return { code: 1, stdout: "", stderr: "remote rejected branch deletion" };
    }
    return runCommand(cmd, args, options);
  };

  await assert.rejects(
    () => cleanupRun({ recordPath: run.recordPath, runCommand: failingRemoteDelete, now: () => NOW }),
    /remote rejected branch deletion/,
  );

  const record = await readRunRecord(run.recordPath);
  assert.equal(record.current.state, "verified_merged");
  assert.equal(record.entries.some((entry) => entry.state === "cleaned_up"), false);
});

test("rollbackRun cleans up failed unmerged PR runs by closing the PR", async () => {
  const repo = await makeRepo();
  const run = await executeAutoRun(repo);
  await appendRunState({
    recordPath: run.recordPath,
    state: "failed",
    entry: {
      runId: "run-2026-06-09-0001",
      failedStage: "checks_pending",
      errorClass: "ChecksDidNotPass",
      safeNextAction: "rollback should cleanup the unmerged PR lane",
    },
    now: NOW,
  });

  const ghCalls = [];
  const rollback = await rollbackRun({
    recordPath: run.recordPath,
    targetPath: repo.target,
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });

  assert.equal(rollback.state, "failed");
  assert.ok(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "close"), "unmerged PR must be closed");
  assert.equal(await pathExists(run.worktreePath), false);
  assert.equal(git(repo.target, ["branch", "--list", run.branch]), "");
});
