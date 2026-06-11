import { readFileSync } from "node:fs";
import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";
import { loadDefaultCatalog } from "../../distributor/distribute.mjs";
import { refreshRepo } from "../refresh/refreshRepo.mjs";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { addPrLabel, createDraftPr, defaultGhRunner, getPrMergeState } from "./ghPr.mjs";
import { appendRunState, readRunRecord } from "./runRecord.mjs";
import { resultsFromRecord } from "./runResults.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_REPORT_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "..", "contracts", "schemas", "run-report.schema.json"), "utf8"),
);
assertSchemaSupported(RUN_REPORT_SCHEMA);

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
}

export function defaultRunRecordRoot() {
  return join(homedir(), ".claude", "archon-prlane-runs");
}

export function recordPathForRun(runId, root = defaultRunRecordRoot()) {
  return join(root, `${runId}.jsonl`);
}

export async function latestRunRecordPath(root = defaultRunRecordRoot()) {
  const entries = await readdir(root, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const path = join(root, entry.name);
        return { path, mtimeMs: (await stat(path)).mtimeMs };
      }),
  );
  records.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  if (!records[0]) throw new Error(`no PR-lane run records found in ${root}`);
  return records[0].path;
}

export async function resolveRunRecordPath({ runId = null, last = false, root = defaultRunRecordRoot() } = {}) {
  if (last) return latestRunRecordPath(root);
  if (!runId) throw new Error("expected --run <id> or --last");
  return recordPathForRun(runId, root);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function gitResult({ runCommand, cwd, args, timeoutMs = 60_000 }) {
  return runCommand("git", ["-C", cwd, ...args], { timeoutMs });
}

function gitError(args, res) {
  return `git ${args.join(" ")} failed: ${res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`}`;
}

async function git({ runCommand, cwd, args, timeoutMs = 60_000 }) {
  const res = await gitResult({ runCommand, cwd, args, timeoutMs });
  if (res.code !== 0) throw new Error(gitError(args, res));
  return res.stdout.trim();
}

function latest(entries, predicate) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (predicate(entries[i])) return entries[i];
  }
  return null;
}

function contextFromRecord(record, { targetPath = null } = {}) {
  const applySet = latest(record.entries, (entry) => entry.applySet)?.applySet;
  if (!applySet) {
    throw new Error("run record does not include ApplySet context; execute the run again with the current PR-lane version");
  }

  const rawTarget = targetPath ?? latest(record.entries, (entry) => entry.targetPath)?.targetPath ?? null;
  if (!rawTarget) throw new Error("run record does not include a target path; pass --target <repo>");
  const target = resolve(rawTarget);

  const branch = latest(record.entries, (entry) => entry.branch)?.branch ?? applySet.runId;
  const worktreePath = latest(record.entries, (entry) => entry.worktreePath)?.worktreePath ?? null;
  const headSha = latest(record.entries, (entry) => entry.headSha)?.headSha ?? null;
  const prNumber = latest(record.entries, (entry) => entry.prNumber)?.prNumber ?? null;
  const prUrl = latest(record.entries, (entry) => entry.prUrl)?.prUrl ?? null;
  const mergeSha = latest(record.entries, (entry) => entry.mergeSha)?.mergeSha ?? null;
  const rollbackBranch = latest(record.entries, (entry) => entry.rollbackBranch)?.rollbackBranch ?? null;
  const rollbackWorktreePath = latest(record.entries, (entry) => entry.rollbackWorktreePath)?.rollbackWorktreePath ?? null;
  const rollbackPrNumber = latest(record.entries, (entry) => entry.rollbackPrNumber)?.rollbackPrNumber ?? null;
  const rollbackMergeSha = latest(record.entries, (entry) => entry.rollbackMergeSha)?.rollbackMergeSha ?? null;

  return {
    applySet,
    targetPath: target,
    branch,
    worktreePath,
    headSha,
    prNumber,
    prUrl,
    mergeSha,
    rollbackBranch,
    rollbackWorktreePath,
    rollbackPrNumber,
    rollbackMergeSha,
    repoSlug: `${applySet.repo.owner}/${applySet.repo.name}`,
  };
}

function postApplyAuditClean(report, applySet) {
  if (report.status !== "ok") return false;
  const auditItems = new Map(report.categories.flatMap((category) => category.items.map((item) => [item.itemId, item])));
  for (const item of applySet.items) {
    if (item.writePlan.kind === "record-ownership") continue;
    const auditItem = auditItems.get(item.itemId);
    if (!auditItem) return false;
    if (auditItem.raw.status !== "clean_apply" || auditItem.raw.changed !== false) return false;
  }
  return true;
}

function changedPathsForApplySet(applySet) {
  return [...new Set(applySet.items.map((item) => item.file))];
}

function categoriesForApplySet(applySet) {
  return [...new Set(applySet.items.map((item) => item.category))];
}

function localVerificationFor(record) {
  if (record.entries.some((entry) => entry.state === "verified_local")) {
    return { status: "passed", detail: "post-apply audit: all applied items clean_apply changed:false" };
  }
  if (record.current?.state === "failed") return { status: "failed", detail: "run failed before local verification completed" };
  return { status: "pending" };
}

function postMergeVerificationFor(record, state, override) {
  if (override) return override;
  if (record.entries.some((entry) => entry.state === "verified_merged")) {
    return { status: "passed", detail: "post-merge audit on merge commit: clean" };
  }
  if (state === "failed" && latest(record.entries, (entry) => entry.mergeSha)?.mergeSha) {
    return { status: "failed", detail: "post-merge audit on merge commit was not clean" };
  }
  return { status: "skipped" };
}

function failureFor(record, override) {
  if (override) return override;
  const failed = latest(record.entries, (entry) => entry.state === "failed");
  if (!failed) return null;
  return {
    failedStage: failed.failedStage,
    errorClass: failed.errorClass,
    safeNextAction: failed.safeNextAction,
  };
}

function rollbackCommandFor(runId, state, mergeSha) {
  if (mergeSha || state.startsWith("rollback")) return `node bin/archon-setup.mjs rollback --run ${runId}`;
  return `node bin/archon-setup.mjs cleanup --run ${runId}`;
}

function validateRunReport(report) {
  const checked = validate(RUN_REPORT_SCHEMA, report);
  if (!checked.valid) {
    const detail = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`RunReport schema invalid: ${detail}`);
  }
}

function buildRunReport({
  record,
  context,
  state = record.current?.state ?? "planned",
  now = new Date().toISOString(),
  mergeSha = context.mergeSha,
  postMergeVerification = null,
  failure = null,
}) {
  const report = {
    schemaVersion: 1,
    kind: "run-report",
    runId: context.applySet.runId,
    ts: now,
    repo: {
      owner: context.applySet.repo.owner,
      name: context.applySet.repo.name,
      path: context.targetPath,
      defaultBranch: context.applySet.repo.defaultBranch,
    },
    baseSha: context.applySet.repo.baseSha,
    branch: context.branch,
    issue: context.applySet.sourceDecisionDoc.issueNumber ?? null,
    pr: context.prNumber ? { number: context.prNumber, ...(context.prUrl ? { url: context.prUrl } : {}) } : null,
    mergeSha: mergeSha ?? null,
    state,
    results: resultsFromRecord({ record, applySet: context.applySet }),
    verification: {
      local: localVerificationFor(record),
      postMerge: postMergeVerificationFor(record, state, postMergeVerification),
    },
    rollbackCommand: rollbackCommandFor(context.applySet.runId, state, mergeSha),
  };
  const effectiveFailure = failureFor(record, failure);
  if (effectiveFailure) report.failure = effectiveFailure;
  validateRunReport(report);
  return report;
}

async function workRootFor(targetPath) {
  const absoluteTarget = resolve(targetPath);
  return join(dirname(absoluteTarget), ".archon-prlane-worktrees");
}

async function withDetachedWorktree({ targetPath, sha, prefix, runCommand, fn }) {
  const root = await workRootFor(targetPath);
  await mkdir(root, { recursive: true });
  const worktreePath = join(root, `${basename(resolve(targetPath))}-${prefix}-${uniqueSuffix()}`);
  await git({ runCommand, cwd: targetPath, args: ["worktree", "add", "--detach", worktreePath, sha] });
  try {
    return await fn(worktreePath);
  } finally {
    const res = await gitResult({ runCommand, cwd: targetPath, args: ["worktree", "remove", "--force", worktreePath] });
    if (res.code !== 0 && (await exists(worktreePath))) {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }
}

async function refreshAtCommit({ context, mergeSha, catalog, runCommand, now }) {
  return withDetachedWorktree({
    targetPath: context.targetPath,
    sha: mergeSha,
    prefix: "postmerge",
    runCommand,
    fn: async (worktreePath) =>
      refreshRepo({
        repo: {
          name: context.applySet.repo.name,
          path: worktreePath,
          branch: context.applySet.repo.defaultBranch,
          dirty: false,
          available: true,
        },
        catalog,
        categories: categoriesForApplySet(context.applySet),
        now,
        baseSha: mergeSha,
      }),
  });
}

export async function verifyMergedRun({
  recordPath,
  targetPath = null,
  catalog = null,
  runCommand = defaultRunCommand,
  runGh = defaultGhRunner,
  now = () => new Date().toISOString(),
}) {
  let record = await readRunRecord(recordPath);
  let context = contextFromRecord(record, { targetPath });
  const timestamp = now();
  if (["verified_merged", "cleaned_up"].includes(record.current?.state)) {
    return { state: record.current.state, report: buildRunReport({ record, context, now: timestamp }) };
  }

  await git({ runCommand, cwd: context.targetPath, args: ["fetch", "origin", context.applySet.repo.defaultBranch] });
  // Resolve the merge commit from the PR itself; an unrelated commit landing on
  // origin/<default> after the squash must never be recorded as this run's merge
  // (#186, C5). The origin-head fallback stays available but is stamped
  // mergeShaSource:"assumed-origin-head" in the ledger so it is never silent.
  let mergeSha = context.mergeSha;
  let mergeShaSource = null;
  if (!mergeSha) {
    const prMerge = context.prNumber
      ? await getPrMergeState({ repoSlug: context.repoSlug, prNumber: context.prNumber, runGh })
      : { ok: false, state: null, mergeSha: null };
    if (prMerge.ok && prMerge.mergeSha) {
      mergeSha = prMerge.mergeSha;
      mergeShaSource = "pr-merge-commit";
    } else {
      mergeSha = await git({
        runCommand,
        cwd: context.targetPath,
        args: ["rev-parse", `origin/${context.applySet.repo.defaultBranch}`],
      });
      mergeShaSource = "assumed-origin-head";
    }
  }

  if (record.current?.state !== "merged") {
    await appendRunState({
      recordPath,
      state: "merged",
      entry: {
        runId: context.applySet.runId,
        baseSha: context.applySet.repo.baseSha,
        prNumber: context.prNumber,
        mergeSha,
        targetPath: context.targetPath,
        applySet: context.applySet,
        branch: context.branch,
        prUrl: context.prUrl,
        ...(mergeShaSource ? { mergeShaSource } : {}),
        // Held runs (checks_pending / pr_created) only reach merged through a
        // human merging the PR (#186, C6).
        ...(record.current?.state !== "merge_queued" ? { mergedBy: "manual" } : {}),
      },
      now: timestamp,
    });
    record = await readRunRecord(recordPath);
    context = contextFromRecord(record, { targetPath });
  }

  const activeCatalog = catalog ?? (await loadDefaultCatalog());
  const audit = await refreshAtCommit({ context, mergeSha, catalog: activeCatalog, runCommand, now: timestamp });
  if (!postApplyAuditClean(audit, context.applySet)) {
    const failure = {
      failedStage: "verified_merged",
      errorClass: "PostMergeVerificationError",
      safeNextAction: "run rollback; post-merge audit did not report all applied items as clean_apply changed:false",
    };
    await appendRunState({
      recordPath,
      state: "failed",
      entry: { runId: context.applySet.runId, ...failure, mergeSha },
      now: timestamp,
    });
    record = await readRunRecord(recordPath);
    context = contextFromRecord(record, { targetPath });
    const report = buildRunReport({
      record,
      context,
      state: "failed",
      now: timestamp,
      mergeSha,
      postMergeVerification: { status: "failed", detail: "post-merge audit on merge commit was not clean" },
      failure,
    });
    return { state: "failed", report, audit };
  }

  await appendRunState({
    recordPath,
    state: "verified_merged",
    entry: {
      runId: context.applySet.runId,
      baseSha: context.applySet.repo.baseSha,
      prNumber: context.prNumber,
      mergeSha,
      targetPath: context.targetPath,
      applySet: context.applySet,
      branch: context.branch,
      prUrl: context.prUrl,
      ...(mergeShaSource ? { mergeShaSource } : {}),
    },
    now: timestamp,
  });
  record = await readRunRecord(recordPath);
  context = contextFromRecord(record, { targetPath });
  const report = buildRunReport({
    record,
    context,
    state: "verified_merged",
    now: timestamp,
    mergeSha,
    postMergeVerification: { status: "passed", detail: "post-merge audit on merge commit: clean" },
  });
  return { state: "verified_merged", report, audit };
}

async function removeWorktreeIfPresent({ targetPath, worktreePath, runCommand }) {
  if (!worktreePath || !(await exists(worktreePath))) return;
  const res = await gitResult({ runCommand, cwd: targetPath, args: ["worktree", "remove", "--force", worktreePath] });
  if (res.code !== 0 && (await exists(worktreePath))) {
    await rm(worktreePath, { recursive: true, force: true });
  }
}

async function deleteLocalBranchIfPresent({ targetPath, branch, runCommand }) {
  if (!branch) return;
  const existsRes = await gitResult({ runCommand, cwd: targetPath, args: ["show-ref", "--verify", `refs/heads/${branch}`] });
  if (existsRes.code !== 0) return;
  await git({ runCommand, cwd: targetPath, args: ["branch", "-D", branch] });
}

async function deleteRemoteBranchIfPresent({ targetPath, branch, runCommand }) {
  if (!branch) return;
  const remote = await gitResult({ runCommand, cwd: targetPath, args: ["ls-remote", "--heads", "origin", branch] });
  if (remote.code !== 0 || !remote.stdout.trim()) return;
  const deleted = await gitResult({ runCommand, cwd: targetPath, args: ["push", "origin", "--delete", branch] });
  if (deleted.code === 0) return;
  const after = await gitResult({ runCommand, cwd: targetPath, args: ["ls-remote", "--heads", "origin", branch] });
  if (after.code === 0 && !after.stdout.trim()) return;
  throw new Error(gitError(["push", "origin", "--delete", branch], deleted));
}

async function closePrIfOpen({ context, runGh }) {
  if (!context.prNumber || !runGh) return;
  const res = await runGh(["pr", "close", String(context.prNumber), "--repo", context.repoSlug]);
  if (res.code !== 0) throw new Error(`gh pr close failed: ${res.stderr?.trim() || res.stdout?.trim() || `exit ${res.code}`}`);
}

const CLEANUP_REFUSAL_SAFE_NEXT_ACTIONS = new Map([
  ["merge_queued", "run verify-merged to audit the merge commit and then cleanup, or run rollback"],
  ["merged", "run verify-merged to audit the merge commit and then cleanup, or run rollback"],
  ["rollback_requested", "run rollback to continue the revert flow; cleanup cannot abort an active rollback"],
  ["rollback_pr_created", "review and merge the rollback PR, then run rollback to verify the revert"],
  ["rollback_merged", "run rollback to verify the merged rollback PR before taking any cleanup action"],
  ["rollback_verified", "rollback is already verified; inspect the run record instead of cleanup"],
]);

export async function cleanupRun({
  recordPath,
  targetPath = null,
  runCommand = defaultRunCommand,
  runGh = defaultGhRunner,
  now = () => new Date().toISOString(),
}) {
  let record = await readRunRecord(recordPath);
  let context = contextFromRecord(record, { targetPath });
  const timestamp = now();
  if (record.current?.state === "cleaned_up" || record.current?.state === "aborted") {
    return { state: record.current.state, report: buildRunReport({ record, context, now: timestamp }) };
  }

  // Refuse before any destructive work (#186/#193, C7-family): states that
  // cannot legally append aborted must guide the operator back to verify or
  // rollback instead of deleting first and failing ledger advancement after.
  const cleanupRefusalSafeNextAction = CLEANUP_REFUSAL_SAFE_NEXT_ACTIONS.get(record.current?.state);
  if (cleanupRefusalSafeNextAction) {
    return {
      state: record.current.state,
      refused: true,
      safeNextAction: cleanupRefusalSafeNextAction,
      report: buildRunReport({ record, context, now: timestamp }),
    };
  }

  if (!context.mergeSha) {
    await closePrIfOpen({ context, runGh });
  }

  await removeWorktreeIfPresent({ targetPath: context.targetPath, worktreePath: context.worktreePath, runCommand });
  await deleteLocalBranchIfPresent({ targetPath: context.targetPath, branch: context.branch, runCommand });
  await deleteRemoteBranchIfPresent({ targetPath: context.targetPath, branch: context.branch, runCommand });
  // Sweep local rollback artifacts recorded by a failed or completed rollback
  // (#186, C11). Local-only: a pushed rollback branch backs an open revert PR and
  // is never deleted from the remote here.
  await removeWorktreeIfPresent({ targetPath: context.targetPath, worktreePath: context.rollbackWorktreePath, runCommand });
  await deleteLocalBranchIfPresent({ targetPath: context.targetPath, branch: context.rollbackBranch, runCommand });

  if (record.current?.state === "verified_merged") {
    await appendRunState({
      recordPath,
      state: "cleaned_up",
      entry: {
        runId: context.applySet.runId,
        baseSha: context.applySet.repo.baseSha,
        prNumber: context.prNumber,
        mergeSha: context.mergeSha,
        targetPath: context.targetPath,
        applySet: context.applySet,
        branch: context.branch,
        prUrl: context.prUrl,
      },
      now: timestamp,
    });
  } else if (record.current?.state === "failed") {
    record = await readRunRecord(recordPath);
    context = contextFromRecord(record, { targetPath });
    return { state: "failed", report: buildRunReport({ record, context, now: timestamp }) };
  } else {
    await appendRunState({
      recordPath,
      state: "aborted",
      entry: { runId: context.applySet.runId, targetPath: context.targetPath, applySet: context.applySet, branch: context.branch },
      now: timestamp,
    });
  }

  record = await readRunRecord(recordPath);
  context = contextFromRecord(record, { targetPath });
  return { state: record.current.state, report: buildRunReport({ record, context, now: timestamp }) };
}

function rollbackBranchFor(runId) {
  const safeRunId = runId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `agent/rollback/${safeRunId}-${uniqueSuffix()}`;
}

// C8 (#187): generated PR bodies must pass the repo-template's own PR contract
// (pr-contract.mjs): every checked verification item carries a fenced evidence
// block with the real run facts, and the body always links an issue — falling
// back to the original PR number when the run carried no issue (a rollback
// always reverts a merged PR, so that number always exists).
export function rollbackPrBody(context, { recordPath = null } = {}) {
  const files = changedPathsForApplySet(context.applySet);
  const issueNumber = context.applySet.sourceDecisionDoc.issueNumber ?? null;
  const issueLine = issueNumber ? `Refs #${issueNumber}` : `Refs #${context.prNumber}`;
  return [
    "## Summary",
    "",
    `Reverts ArchonVII managed-region refresh run \`${context.applySet.runId}\` (original PR #${context.prNumber}).`,
    "",
    "## Verification",
    "",
    "- [x] Rollback branch affected paths match the recorded base tree",
    "",
    "```evidence",
    `runId: ${context.applySet.runId}`,
    `baseSha: ${context.applySet.repo.baseSha}`,
    `originalPr: #${context.prNumber}`,
    `originalMergeSha: ${context.mergeSha}`,
    `affectedPaths (${files.length}):`,
    ...files.map((file) => `- ${file}`),
    ...(recordPath ? [`runLedger: ${recordPath}`] : []),
    "```",
    "",
    "### Verification Notes",
    "",
    "The rollback worktree was diffed against the recorded base SHA for every affected path before the revert branch was pushed; the evidence block above carries the run facts.",
    "",
    "## Docs / Changelog",
    "",
    "Rollback-only managed-region distribution; no consumer changelog entry required.",
    "",
    issueLine,
    "",
  ].join("\n");
}

async function mergeCommitNeedsMainline({ context, mergeSha, runCommand }) {
  const parents = await git({ runCommand, cwd: context.targetPath, args: ["rev-list", "--parents", "-n", "1", mergeSha] });
  return parents.trim().split(/\s+/).length > 2;
}

async function affectedPathsMatchBase({ context, worktreePath, runCommand }) {
  const paths = changedPathsForApplySet(context.applySet);
  const res = await gitResult({
    runCommand,
    cwd: worktreePath,
    args: ["diff", "--quiet", context.applySet.repo.baseSha, "HEAD", "--", ...paths],
  });
  return res.code === 0;
}

async function refAffectedPathsMatchBase({ context, ref, runCommand }) {
  const paths = changedPathsForApplySet(context.applySet);
  const res = await gitResult({
    runCommand,
    cwd: context.targetPath,
    args: ["diff", "--quiet", context.applySet.repo.baseSha, ref, "--", ...paths],
  });
  return res.code === 0;
}

async function appendRollbackFailure({
  recordPath,
  context,
  mergeSha,
  failedStage,
  errorClass,
  safeNextAction,
  rollbackBranch = null,
  rollbackWorktreePath = null,
  now,
}) {
  await appendRunState({
    recordPath,
    state: "failed",
    entry: {
      runId: context.applySet.runId,
      failedStage,
      errorClass,
      safeNextAction,
      mergeSha,
      ...(rollbackBranch ? { rollbackBranch } : {}),
      ...(rollbackWorktreePath ? { rollbackWorktreePath } : {}),
    },
    now,
  });
  const record = await readRunRecord(recordPath);
  const report = buildRunReport({
    record,
    context: contextFromRecord(record, { targetPath: context.targetPath }),
    state: "failed",
    now,
    mergeSha,
    failure: { failedStage, errorClass, safeNextAction },
  });
  return { state: "failed", report };
}

// Re-entry at rollback_pr_created (#186, C12): query whether the revert PR merged.
// Merged -> rollback_merged, then verify affected paths against fresh origin/<default>
// before claiming rollback_verified. Not merged -> idempotent hold with guidance; the
// lane never auto-merges its own revert PR.
async function resumeRollbackPrCreated({ recordPath, targetPath, record, context, runCommand, runGh, timestamp }) {
  await git({ runCommand, cwd: context.targetPath, args: ["fetch", "origin", context.applySet.repo.defaultBranch] });
  const prMerge = await getPrMergeState({ repoSlug: context.repoSlug, prNumber: context.rollbackPrNumber, runGh });
  if (!prMerge.ok || prMerge.state !== "MERGED") {
    return {
      state: "rollback_pr_created",
      rollbackBranch: context.rollbackBranch,
      rollbackWorktreePath: context.rollbackWorktreePath,
      rollbackPrNumber: context.rollbackPrNumber,
      safeNextAction: "review and merge the rollback PR, then re-run rollback to verify the revert",
      report: buildRunReport({ record, context, now: timestamp }),
    };
  }

  const defaultRef = `origin/${context.applySet.repo.defaultBranch}`;
  const defaultHead = await git({ runCommand, cwd: context.targetPath, args: ["rev-parse", defaultRef] });
  const rollbackMergeSha = prMerge.mergeSha ?? defaultHead;
  await appendRunState({
    recordPath,
    state: "rollback_merged",
    entry: {
      runId: context.applySet.runId,
      mergeSha: context.mergeSha,
      rollbackPrNumber: context.rollbackPrNumber,
      rollbackMergeSha,
      rollbackBranch: context.rollbackBranch,
      rollbackWorktreePath: context.rollbackWorktreePath,
      targetPath: context.targetPath,
      applySet: context.applySet,
      branch: context.branch,
      prNumber: context.prNumber,
      prUrl: context.prUrl,
    },
    now: timestamp,
  });
  record = await readRunRecord(recordPath);
  context = contextFromRecord(record, { targetPath });

  if (!(await refAffectedPathsMatchBase({ context, ref: defaultRef, runCommand }))) {
    return appendRollbackFailure({
      recordPath,
      context,
      mergeSha: context.mergeSha,
      failedStage: "rollback_merged",
      errorClass: "RollbackTreeMismatch",
      safeNextAction: "manual review required; the rollback PR merged but affected paths still differ from the recorded base",
      now: timestamp,
    });
  }

  await appendRunState({
    recordPath,
    state: "rollback_verified",
    entry: {
      runId: context.applySet.runId,
      mergeSha: context.mergeSha,
      rollbackPrNumber: context.rollbackPrNumber,
      rollbackMergeSha,
      targetPath: context.targetPath,
      applySet: context.applySet,
      branch: context.branch,
      prNumber: context.prNumber,
      prUrl: context.prUrl,
    },
    now: timestamp,
  });
  record = await readRunRecord(recordPath);
  context = contextFromRecord(record, { targetPath });
  return {
    state: "rollback_verified",
    rollbackMergeSha,
    report: buildRunReport({ record, context, state: "rollback_verified", now: timestamp }),
  };
}

export async function rollbackRun({
  recordPath,
  targetPath = null,
  catalog = null,
  runCommand = defaultRunCommand,
  runGh = defaultGhRunner,
  now = () => new Date().toISOString(),
}) {
  let record = await readRunRecord(recordPath);
  let context = contextFromRecord(record, { targetPath });
  const timestamp = now();
  if (record.current?.state === "rollback_pr_created") {
    return resumeRollbackPrCreated({ recordPath, targetPath, record, context, runCommand, runGh, timestamp });
  }

  if (!context.mergeSha) {
    return cleanupRun({ recordPath, targetPath: context.targetPath, runCommand, runGh, now });
  }

  if (record.current?.state !== "rollback_requested") {
    await appendRunState({
      recordPath,
      state: "rollback_requested",
      entry: {
        runId: context.applySet.runId,
        mergeSha: context.mergeSha,
        targetPath: context.targetPath,
        applySet: context.applySet,
        branch: context.branch,
        prNumber: context.prNumber,
        prUrl: context.prUrl,
      },
      now: timestamp,
    });
    record = await readRunRecord(recordPath);
    context = contextFromRecord(record, { targetPath });
  }

  await git({ runCommand, cwd: context.targetPath, args: ["fetch", "origin", context.applySet.repo.defaultBranch] });
  const defaultRef = `origin/${context.applySet.repo.defaultBranch}`;
  const defaultHead = await git({ runCommand, cwd: context.targetPath, args: ["rev-parse", defaultRef] });
  if (await refAffectedPathsMatchBase({ context, ref: defaultRef, runCommand })) {
    await appendRunState({
      recordPath,
      state: "rollback_verified",
      entry: {
        runId: context.applySet.runId,
        mergeSha: context.mergeSha,
        rollbackMergeSha: defaultHead,
        alreadyReverted: true,
        targetPath: context.targetPath,
        applySet: context.applySet,
        branch: context.branch,
        prNumber: context.prNumber,
        prUrl: context.prUrl,
      },
      now: timestamp,
    });
    record = await readRunRecord(recordPath);
    context = contextFromRecord(record, { targetPath });
    return {
      state: "rollback_verified",
      alreadyReverted: true,
      rollbackMergeSha: defaultHead,
      report: buildRunReport({ record, context, state: "rollback_verified", now: timestamp }),
    };
  }

  const root = await workRootFor(context.targetPath);
  await mkdir(root, { recursive: true });
  const rollbackBranch = rollbackBranchFor(context.applySet.runId);
  const rollbackWorktreePath = join(root, `${context.applySet.repo.name}-${rollbackBranch.split("/").at(-1)}`);
  await git({
    runCommand,
    cwd: context.targetPath,
    args: ["worktree", "add", "-b", rollbackBranch, rollbackWorktreePath, `origin/${context.applySet.repo.defaultBranch}`],
  });

  const revertArgs = (await mergeCommitNeedsMainline({ context, mergeSha: context.mergeSha, runCommand }))
    ? ["revert", "-m", "1", "--no-edit", context.mergeSha]
    : ["revert", "--no-edit", context.mergeSha];
  // On pre-push failures the rollback worktree/branch hold nothing that was
  // published — remove them and record them on the failure entry so no artifact
  // is left behind unaccounted for (#186, C11).
  const discardRollbackArtifacts = async () => {
    await removeWorktreeIfPresent({ targetPath: context.targetPath, worktreePath: rollbackWorktreePath, runCommand });
    await deleteLocalBranchIfPresent({ targetPath: context.targetPath, branch: rollbackBranch, runCommand });
  };

  const revert = await gitResult({ runCommand, cwd: rollbackWorktreePath, args: revertArgs });
  if (revert.code !== 0) {
    await gitResult({ runCommand, cwd: rollbackWorktreePath, args: ["revert", "--abort"] });
    await discardRollbackArtifacts();
    return appendRollbackFailure({
      recordPath,
      context,
      mergeSha: context.mergeSha,
      failedStage: "rollback_requested",
      errorClass: "RollbackConflict",
      safeNextAction: "manual review required; rollback revert conflicted and no PR was created",
      rollbackBranch,
      rollbackWorktreePath,
      now: timestamp,
    });
  }

  if (!(await affectedPathsMatchBase({ context, worktreePath: rollbackWorktreePath, runCommand }))) {
    await discardRollbackArtifacts();
    return appendRollbackFailure({
      recordPath,
      context,
      mergeSha: context.mergeSha,
      failedStage: "rollback_requested",
      errorClass: "RollbackTreeMismatch",
      safeNextAction: "manual review required; rollback branch does not match the recorded base for affected paths",
      rollbackBranch,
      rollbackWorktreePath,
      now: timestamp,
    });
  }

  await git({ runCommand, cwd: rollbackWorktreePath, args: ["push", "-u", "origin", rollbackBranch] });
  const pr = await createDraftPr({
    repoSlug: context.repoSlug,
    base: context.applySet.repo.defaultBranch,
    head: rollbackBranch,
    title: `revert(agents): rollback refresh ${context.applySet.runId}`,
    body: rollbackPrBody(context, { recordPath }),
    draft: false,
    runGh,
  });
  await addPrLabel({ repoSlug: context.repoSlug, prNumber: pr.number, label: "automated-distribution", runGh });

  await appendRunState({
    recordPath,
    state: "rollback_pr_created",
    entry: {
      runId: context.applySet.runId,
      mergeSha: context.mergeSha,
      rollbackPrNumber: pr.number,
      rollbackPrUrl: pr.url,
      rollbackBranch,
      rollbackWorktreePath,
      targetPath: context.targetPath,
      applySet: context.applySet,
      branch: context.branch,
      prNumber: context.prNumber,
      prUrl: context.prUrl,
    },
    now: timestamp,
  });

  record = await readRunRecord(recordPath);
  context = contextFromRecord(record, { targetPath });
  return {
    state: "rollback_pr_created",
    rollbackBranch,
    rollbackWorktreePath,
    report: buildRunReport({ record, context, state: "rollback_pr_created", now: timestamp }),
  };
}
