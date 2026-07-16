import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { DEFAULT_REQUIRED_GATE_CHECK, resolveRequiredChecks as defaultResolveRequiredChecks } from "../branchProtection/tightenRequiredGate.mjs";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { createDraftPr } from "../prlane/ghPr.mjs";
import { appendRunState, readRunRecord } from "../prlane/runRecord.mjs";
import { runOnboard } from "./headlessOnboard.mjs";

async function git({ targetPath, args, runCommand, trim = true }) {
  const result = await runCommand("git", ["-C", targetPath, ...args]);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
  // trim: false for positional output like `status --porcelain`, where
  // trimming eats the first line's leading status column (#364).
  return trim ? result.stdout.trim() : result.stdout;
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

function branchFor({ sourceIssueNumber, runId }) {
  const slug = String(runId).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repair";
  return `agent/onboard/${sourceIssueNumber}-repair-${slug}-${uniqueSuffix()}`;
}

function prBody({ intake, sourceIssueNumber, recordPath }) {
  const manual = intake.manual.length
    ? intake.manual.map((item) => `- \`${item.itemId}\`: ${item.choice}`)
    : ["- manual decisions: none"];
  return [
    "## Summary",
    "",
    `Applies the resolved onboarding baseline items from repair run \`${intake.runId}\`.`,
    "",
    "## Verification",
    "",
    "- [x] Local post-apply onboarding audit confirmed every apply-central item is present.",
    "",
    "```evidence",
    `runId: ${intake.runId}`,
    `baseSha: ${intake.baseSha}`,
    `applyFeatures: ${intake.applyFeatures.join(", ") || "none"}`,
    `runLedger: ${recordPath}`,
    "```",
    "",
    "### Verification Notes",
    "",
    "The repair lane used a fresh worktree from the fetched default branch. Deferred, blocked, and manual items were not applied:",
    ...manual,
    "",
    "## Docs / Changelog",
    "",
    "Onboarding repair for the target repository; its local changelog policy applies.",
    "",
    `Closes #${sourceIssueNumber}`,
    "",
    "## Risks",
    "",
    "- Risk level: Moderate; only explicitly resolved missing baseline items were written.",
    "- Rollback: Revert this PR; the run ledger records the base SHA and feature selection.",
    "- Follow-ups: Complete any manual, deferred, or blocked decisions before claiming full onboarding.",
    "",
  ].join("\n");
}

// Gate on apply-central item PATHS, not features (#362): a feature may mix
// apply-central (missing) with keep-local/merge-manual (legitimately drifted)
// items, and only the former are the repair's responsibility to make present.
function appliedAuditPassed(audit, applyPaths) {
  const wanted = new Set(applyPaths);
  return audit.items
    .filter((item) => wanted.has(item.path))
    .every((item) => item.status === "present");
}

// The apply step runs whole features (runOnboard has no per-item filter), so
// reconcile-capable tasks may write paths the decision resolved keep-local /
// merge-manual / defer / blocked. Undo those writes: apply-central is the only
// decision that enters automated apply (decisioned-repair design, 2026-07-10;
// #362). Tracked paths are restored from HEAD; paths the feature run created
// (e.g. a missing item resolved defer) are removed.
async function restoreManualPaths({ worktreePath, manual, runCommand }) {
  const manualPaths = (manual ?? [])
    .map((item) => item.path ?? String(item.itemId ?? "").slice(String(item.itemId ?? "").indexOf(":") + 1))
    .filter(Boolean);
  if (!manualPaths.length) return;
  const trackedRaw = await git({ targetPath: worktreePath, args: ["ls-files", "--", ...manualPaths], runCommand });
  const tracked = trackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (tracked.length) {
    await git({ targetPath: worktreePath, args: ["checkout", "--", ...tracked], runCommand });
  }
  const trackedSet = new Set(tracked);
  for (const relPath of manualPaths) {
    if (!trackedSet.has(relPath)) await rm(join(worktreePath, relPath), { force: true });
  }
}

async function appendFailure({ recordPath, runId, failedStage, error, now }) {
  try {
    const current = (await readRunRecord(recordPath)).current;
    if (!current) return;
    await appendRunState({
      recordPath,
      state: "failed",
      entry: {
        runId,
        failedStage: failedStage ?? current.state,
        errorClass: error.name ?? "Error",
        safeNextAction: "inspect the run record, resolve the decision, and retry from a fresh intake",
      },
      now: now(),
    });
  } catch {
    // Preserve the original error.
  }
}

export async function runOnboardingRepair({
  intake,
  targetPath,
  sourceIssueNumber,
  recordPath,
  workRoot = null,
  owner = "",
  repo = "",
  runCommand = defaultRunCommand,
  runGh,
  now = () => new Date().toISOString(),
} = {}) {
  if (!intake?.ok) throw new Error("a successful onboarding decision intake is required before repair");
  if (!sourceIssueNumber) throw new Error("sourceIssueNumber is required for an issue-backed onboarding repair");
  if (!recordPath) throw new Error("recordPath is required");
  const resolvedOwner = owner || intake.owner;
  const resolvedRepo = repo || intake.repo;
  if (!resolvedOwner || !resolvedRepo) throw new Error("owner and repo are required for draft PR creation");
  if (!intake.applyFeatures.length) throw new Error("the resolved decision contains no apply-central items");

  const absoluteTarget = resolve(targetPath);
  const base = {
    runId: intake.runId,
    baseSha: intake.baseSha,
    targetPath: absoluteTarget,
    onboardingRepair: {
      selectedFeatures: intake.selectedFeatures,
      applyFeatures: intake.applyFeatures,
      manual: intake.manual,
      defaultBranch: intake.defaultBranch ?? "main",
      owner: resolvedOwner,
      repo: resolvedRepo,
      sourceIssueNumber,
    },
  };
  const defaultBranch = intake.defaultBranch ?? "main";
  let failedStage = "planned";

  await appendRunState({ recordPath, state: "planned", entry: base, now: now() });
  try {
    failedStage = "preflight_started";
    await appendRunState({ recordPath, state: "preflight_started", entry: base, now: now() });
    const toplevel = await git({ targetPath: absoluteTarget, args: ["rev-parse", "--show-toplevel"], runCommand });
    if (basename(resolve(toplevel)) !== basename(absoluteTarget)) throw new Error("targetPath must be the repository root");
    const currentBranch = await git({ targetPath: absoluteTarget, args: ["branch", "--show-current"], runCommand });
    if (currentBranch !== defaultBranch) throw new Error(`target branch ${currentBranch} does not match default ${defaultBranch}`);
    const dirty = await git({ targetPath: absoluteTarget, args: ["status", "--porcelain"], runCommand });
    if (dirty) throw new Error("target worktree must be clean before onboarding repair");
    await git({ targetPath: absoluteTarget, args: ["fetch", "origin", defaultBranch], runCommand });
    const remoteBase = await git({ targetPath: absoluteTarget, args: ["rev-parse", `origin/${defaultBranch}`], runCommand });
    if (remoteBase !== intake.baseSha) throw new Error(`origin/${defaultBranch} ${remoteBase} does not match decision base ${intake.baseSha}`);
    const head = await git({ targetPath: absoluteTarget, args: ["rev-parse", "HEAD"], runCommand });
    if (head !== intake.baseSha) throw new Error(`target HEAD ${head} does not match decision base ${intake.baseSha}`);

    failedStage = "preflight_passed";
    await appendRunState({ recordPath, state: "preflight_passed", entry: base, now: now() });
    failedStage = "issue_created";
    await appendRunState({ recordPath, state: "issue_created", entry: { ...base, issueNumber: sourceIssueNumber }, now: now() });

    const branch = branchFor({ sourceIssueNumber, runId: intake.runId });
    const root = workRoot ?? join(dirname(absoluteTarget), ".archon-onboarding-repair-worktrees");
    await mkdir(root, { recursive: true });
    const worktreePath = join(root, `${resolvedRepo}-${branch.split("/").at(-1)}`);
    await git({ targetPath: absoluteTarget, args: ["worktree", "add", "-b", branch, worktreePath, `origin/${defaultBranch}`], runCommand });
    failedStage = "worktree_created";
    await appendRunState({ recordPath, state: "worktree_created", entry: { ...base, branch, worktreePath }, now: now() });

    const applied = await runOnboard({
      targetPath: worktreePath,
      features: intake.applyFeatures,
      baselineFeatures: intake.selectedFeatures,
      owner: resolvedOwner,
      repo: resolvedRepo,
    });
    if (!applied.ok) throw new Error("onboarding apply failed");
    await restoreManualPaths({ worktreePath, manual: intake.manual, runCommand });
    failedStage = "applied";
    await appendRunState({ recordPath, state: "applied", entry: { ...base, branch, worktreePath }, now: now() });

    const audit = await runOnboard({
      targetPath: worktreePath,
      features: intake.applyFeatures,
      baselineFeatures: intake.selectedFeatures,
      owner: resolvedOwner,
      repo: resolvedRepo,
      audit: true,
    });
    if (!appliedAuditPassed(audit.audit, intake.applyPaths ?? [])) throw new Error("local audit did not confirm every apply-central item");
    failedStage = "verified_local";
    await appendRunState({ recordPath, state: "verified_local", entry: { ...base, branch, worktreePath }, now: now() });

    const changed = await git({ targetPath: worktreePath, args: ["status", "--porcelain"], runCommand, trim: false });
    if (!changed.trim()) throw new Error("repair worktree has no changes to commit");
    const paths = changed
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    await git({ targetPath: worktreePath, args: ["add", "--", ...paths], runCommand });
    await git({ targetPath: worktreePath, args: ["commit", "-m", `feat(onboarding): repair #${sourceIssueNumber} ${intake.runId}`], runCommand });
    const headSha = await git({ targetPath: worktreePath, args: ["rev-parse", "HEAD"], runCommand });
    failedStage = "committed";
    await appendRunState({ recordPath, state: "committed", entry: { ...base, branch, headSha }, now: now() });
    await git({ targetPath: worktreePath, args: ["push", "-u", "origin", branch], runCommand });
    failedStage = "pushed";
    await appendRunState({ recordPath, state: "pushed", entry: { ...base, branch, headSha }, now: now() });

    const pr = await createDraftPr({
      repoSlug: `${resolvedOwner}/${resolvedRepo}`,
      base: defaultBranch,
      head: branch,
      title: `feat(onboarding): repair #${sourceIssueNumber}`,
      body: prBody({ intake, sourceIssueNumber, recordPath }),
      draft: true,
      runGh,
    });
    failedStage = "pr_created";
    await appendRunState({ recordPath, state: "pr_created", entry: { ...base, branch, headSha, prNumber: pr.number, prUrl: pr.url }, now: now() });
    return { state: "pr_created", runId: intake.runId, branch, worktreePath, recordPath, pr, audit, manual: intake.manual };
  } catch (error) {
    await appendFailure({ recordPath, runId: intake.runId, failedStage, error, now });
    throw error;
  }
}

function latest(entries, field) {
  return [...entries].reverse().find((entry) => entry[field] !== undefined)?.[field] ?? null;
}

export async function verifyMergedOnboardingRepair({
  targetPath,
  recordPath,
  workRoot = null,
  runCommand = defaultRunCommand,
  resolveRequiredChecks = defaultResolveRequiredChecks,
  now = () => new Date().toISOString(),
} = {}) {
  if (!recordPath) throw new Error("recordPath is required");
  const record = await readRunRecord(recordPath);
  const initial = record.entries.find((entry) => entry.onboardingRepair);
  const pr = record.entries.find((entry) => entry.state === "pr_created");
  if (!initial || !pr) throw new Error("run record does not describe a draft onboarding repair PR");
  const repair = initial.onboardingRepair;
  const absoluteTarget = resolve(targetPath);
  const defaultBranch = repair.defaultBranch;
  await git({ targetPath: absoluteTarget, args: ["fetch", "origin", defaultBranch], runCommand });
  const mergeSha = await git({ targetPath: absoluteTarget, args: ["rev-parse", `origin/${defaultBranch}`], runCommand });
  const ancestor = await runCommand("git", ["-C", absoluteTarget, "merge-base", "--is-ancestor", pr.headSha, mergeSha]);
  if (ancestor.code !== 0) {
    return { status: "blocked", reason: "repair PR head is not present on the fetched default branch", mergeSha };
  }
  await appendRunState({ recordPath, state: "merged", entry: { runId: initial.runId, baseSha: initial.baseSha, prNumber: pr.prNumber, mergeSha }, now: now() });
  const root = workRoot ?? join(dirname(absoluteTarget), ".archon-onboarding-verify-worktrees");
  await mkdir(root, { recursive: true });
  const worktreePath = join(root, `${repair.repo}-verify-${initial.runId}`);
  await git({ targetPath: absoluteTarget, args: ["worktree", "add", "--detach", worktreePath, `origin/${defaultBranch}`], runCommand });
  try {
    const audited = await runOnboard({ targetPath: worktreePath, features: repair.selectedFeatures, audit: true });
    const required = await resolveRequiredChecks({ targetPath: worktreePath, owner: repair.owner, repo: repair.repo, branch: defaultBranch, runCommand });
    const gateItem = audited.audit.items.find((item) => item.path === ".github/workflows/repo-required-gate.yml");
    const requiresGate = required.checks.includes(DEFAULT_REQUIRED_GATE_CHECK);
    const missingRequiredCaller = requiresGate && (!gateItem || gateItem.status !== "present");
    const status = missingRequiredCaller
      ? "blocked"
      : audited.audit.onboardingCompletion.status === "complete"
        ? "fully_onboarded"
        : "partial_onboarding";
    const result = { status, mergeSha, defaultBranch, audit: audited.audit, requiredChecks: required };
    await appendRunState({ recordPath, state: "verified_merged", entry: { runId: initial.runId, baseSha: initial.baseSha, prNumber: pr.prNumber, mergeSha, verification: result }, now: now() });
    return result;
  } finally {
    await git({ targetPath: absoluteTarget, args: ["worktree", "remove", "--force", worktreePath], runCommand });
  }
}
