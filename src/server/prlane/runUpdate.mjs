import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";
import { distributeRepo, loadDefaultCatalog, writeAtomic } from "../../distributor/distribute.mjs";
import { refreshRepo } from "../refresh/refreshRepo.mjs";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { evaluateAutoMergeEligibility } from "./autoMergeGate.mjs";
import { addPrLabel, createDraftPr, getPrView, listPrChecks, queueAutoMerge } from "./ghPr.mjs";
import { appendRunState, readRunRecord } from "./runRecord.mjs";
import { resolveRequiredChecks as defaultResolveRequiredChecks } from "../branchProtection/tightenRequiredGate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY_SET_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "..", "contracts", "schemas", "apply-set.schema.json"), "utf8"),
);
assertSchemaSupported(APPLY_SET_SCHEMA);

function patternAllows(pattern, relpath) {
  const normalized = relpath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern === normalized) return true;
  if (normalizedPattern.startsWith("**/")) {
    const suffix = normalizedPattern.slice("**/".length);
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
  }
  return false;
}

function assertAllowedRelpath(relpath, patterns) {
  if (/^[A-Za-z]:[\\/]/.test(relpath) || relpath.startsWith("/") || relpath.startsWith("\\")) {
    throw new Error(`apply path is absolute: ${relpath}`);
  }
  if (relpath.split(/[\\/]+/).includes("..")) {
    throw new Error(`apply path escapes the repo: ${relpath}`);
  }
  if (!patterns.some((pattern) => patternAllows(pattern, relpath))) {
    throw new Error(`apply path is outside the allowlist: ${relpath}`);
  }
}

async function git({ runCommand, cwd, args }) {
  const res = await runCommand("git", ["-C", cwd, ...args], { timeoutMs: 60_000 });
  if (res.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`}`);
  }
  return res.stdout.trim();
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
}

function uniqueBranch(runId) {
  const safeRunId = runId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `agent/refresh/${safeRunId}-${uniqueSuffix()}`;
}

function augmentKnownIdsForOwnership(catalog, applySet) {
  return {
    ...catalog,
    knownIds: new Set([
      ...(catalog.knownIds ?? new Set()),
      ...applySet.items
        .filter((item) => item.writePlan.kind === "record-ownership" && item.regionId)
        .map((item) => item.regionId),
    ]),
  };
}

function selectedCatalogIds(applySet) {
  return [
    ...new Set(
      applySet.items
        .filter((item) => item.writePlan.kind !== "record-ownership")
        .map((item) => item.writePlan.sourceCatalogId ?? item.regionId)
        .filter(Boolean),
    ),
  ];
}

function assertCatalogMatchesApplySet(catalog, applySet) {
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  for (const item of applySet.items) {
    if (item.writePlan.kind === "record-ownership") continue;
    const sourceId = item.writePlan.sourceCatalogId ?? item.regionId;
    const entry = byId.get(sourceId);
    if (!entry) throw new Error(`ApplySet references unknown catalog id: ${sourceId}`);
    if (entry.targetRelpath !== item.file) {
      throw new Error(`catalog id ${sourceId} targets ${entry.targetRelpath}, ApplySet expected ${item.file}`);
    }
  }
}

async function writeOwnershipRecords({ worktreePath, applySet, now }) {
  const records = applySet.items.filter((item) => item.writePlan.kind === "record-ownership");
  if (records.length === 0) return;

  const relpath = ".archon/region-ownership.json";
  const fullPath = safeJoin(worktreePath, relpath);
  let current = { schemaVersion: 1, kind: "archon-region-ownership", records: [] };
  try {
    current = JSON.parse(await readFile(fullPath, "utf8"));
    if (!Array.isArray(current.records)) current.records = [];
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const seen = new Set(current.records.map((record) => record.itemId));
  for (const item of records) {
    if (seen.has(item.itemId)) continue;
    current.records.push({
      itemId: item.itemId,
      regionId: item.regionId,
      resolution: "keep-local",
      decisionDocFingerprint: applySet.sourceDecisionDoc.fingerprint,
      recordedAt: now(),
    });
  }
  await writeAtomic(fullPath, `${JSON.stringify(current, null, 2)}\n`);
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

function resultItemsFromApplySet(applySet) {
  return applySet.items.map((item) => ({
    itemId: item.itemId,
    file: item.file,
    regionId: item.regionId,
    action: item.resolution === "keep-local" ? "skip" : item.writePlan.kind === "create-file" ? "create" : "merge",
  }));
}

function changedPathsForApplySet(applySet) {
  return [...new Set(applySet.items.map((item) => item.file))];
}

function prBodyForApplySet(applySet) {
  const lines = applySet.items.map((item) => `- ${item.resolution}: \`${item.itemId}\` -> \`${item.writePlan.kind}\``);
  return [
    "## Summary",
    "",
    `Applies ArchonVII managed-region decisions from run \`${applySet.runId}\`.`,
    "",
    "## Verification",
    "",
    "- [x] Local post-apply audit passed in the PR lane worktree",
    "",
    "### Verification Notes",
    "",
    `Decision doc fingerprint: \`${applySet.sourceDecisionDoc.fingerprint}\``,
    `Applied items: ${applySet.items.length}`,
    ...lines,
    "",
    "## Docs / Changelog",
    "",
    "Managed-region distribution only; no consumer changelog entry required.",
    "",
    `Closes #${applySet.sourceDecisionDoc.issueNumber}`,
    "",
  ].join("\n");
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
        safeNextAction: "inspect the run record and rerun from a fresh ApplySet",
      },
      now: now(),
    });
  } catch {
    // Preserve the original failure.
  }
}

export async function runUpdate({
  applySet,
  targetPath,
  mode = "auto",
  confirmationPhrase,
  recordPath,
  workRoot,
  catalog = null,
  requiredChecks = [],
  resolveRequiredChecks = defaultResolveRequiredChecks,
  runCommand = defaultRunCommand,
  runGh,
  now = () => new Date().toISOString(),
}) {
  const schemaCheck = validate(APPLY_SET_SCHEMA, applySet);
  if (!schemaCheck.valid) {
    const detail = schemaCheck.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`ApplySet schema invalid: ${detail}`);
  }
  if (!["local-only", "pr-only", "auto"].includes(mode)) {
    throw new Error(`runUpdate mode ${mode} is not implemented yet`);
  }

  const absoluteTarget = resolve(targetPath);
  const base = {
    runId: applySet.runId,
    baseSha: applySet.repo.baseSha,
    targetPath: absoluteTarget,
    applySet,
  };
  const activeCatalog = augmentKnownIdsForOwnership(catalog ?? (await loadDefaultCatalog()), applySet);
  let failedStage = "planned";

  await appendRunState({ recordPath, state: "planned", entry: base, now: now() });
  try {
    failedStage = "preflight_started";
    await appendRunState({ recordPath, state: "preflight_started", entry: base, now: now() });

    const gate = evaluateAutoMergeEligibility({
      applySet,
      confirmationPhrase,
      pr: {
        labels: ["automated-distribution"],
        body: `#${applySet.sourceDecisionDoc.issueNumber}\n${applySet.sourceDecisionDoc.fingerprint}`,
      },
      requiredChecks: [],
      checks: [],
      postApplyAudit: { clean: true },
    });
    const phraseFailure = gate.reasons.find((reason) => reason === "confirmation-phrase-mismatch");
    if (phraseFailure) throw new Error(phraseFailure);

    for (const item of applySet.items) assertAllowedRelpath(item.file, applySet.guards.allowedPathPatterns);
    assertCatalogMatchesApplySet(activeCatalog, applySet);

    const toplevel = await git({ runCommand, cwd: absoluteTarget, args: ["rev-parse", "--show-toplevel"] });
    if (basename(resolve(toplevel)) !== applySet.repo.name) {
      throw new Error(`target repo mismatch: ApplySet is for ${applySet.repo.name}, target is ${basename(resolve(toplevel))}`);
    }
    const branch = await git({ runCommand, cwd: absoluteTarget, args: ["branch", "--show-current"] });
    if (branch !== applySet.repo.defaultBranch) {
      throw new Error(`target branch ${branch} does not match ApplySet default ${applySet.repo.defaultBranch}`);
    }
    const dirty = await git({ runCommand, cwd: absoluteTarget, args: ["status", "--porcelain"] });
    if (dirty) throw new Error("target worktree must be clean before PR-lane execution");

    await git({ runCommand, cwd: absoluteTarget, args: ["fetch", "origin", applySet.repo.defaultBranch] });
    const remoteBase = await git({
      runCommand,
      cwd: absoluteTarget,
      args: ["rev-parse", `origin/${applySet.repo.defaultBranch}`],
    });
    if (remoteBase !== applySet.repo.baseSha) {
      throw new Error(`origin/${applySet.repo.defaultBranch} ${remoteBase} does not match ApplySet base ${applySet.repo.baseSha}`);
    }
    const head = await git({ runCommand, cwd: absoluteTarget, args: ["rev-parse", "HEAD"] });
    if (head !== applySet.repo.baseSha) {
      throw new Error(`target HEAD ${head} does not match ApplySet base ${applySet.repo.baseSha}`);
    }

    failedStage = "preflight_passed";
    await appendRunState({ recordPath, state: "preflight_passed", entry: base, now: now() });

    const issueNumber = applySet.sourceDecisionDoc.issueNumber;
    if (issueNumber) {
      failedStage = "issue_created";
      await appendRunState({ recordPath, state: "issue_created", entry: { ...base, issueNumber }, now: now() });
    } else if (mode !== "local-only") {
      throw new Error("ApplySet sourceDecisionDoc.issueNumber is required for PR execution");
    }

    const branchName = uniqueBranch(applySet.runId);
    const root = workRoot ?? join(dirname(absoluteTarget), ".archon-prlane-worktrees");
    await mkdir(root, { recursive: true });
    const worktreePath = join(root, `${applySet.repo.name}-${branchName.split("/").at(-1)}`);
    await git({
      runCommand,
      cwd: absoluteTarget,
      args: ["worktree", "add", "-b", branchName, worktreePath, `origin/${applySet.repo.defaultBranch}`],
    });
    failedStage = "worktree_created";
    await appendRunState({
      recordPath,
      state: "worktree_created",
      entry: { ...base, branch: branchName, worktreePath },
      now: now(),
    });

    const worktreeRepo = {
      name: applySet.repo.name,
      path: worktreePath,
      branch: branchName,
      dirty: false,
      available: true,
    };
    const ids = selectedCatalogIds(applySet);
    if (ids.length > 0) {
      const applied = await distributeRepo({
        repo: worktreeRepo,
        catalog: activeCatalog,
        ids,
        mode: "apply",
        adoptAnchored: true,
      });
      if (applied.status !== "ok") throw new Error(`distribute apply skipped: ${applied.reason}`);
      const blocked = applied.files.find((file) => ["failed", "conflict", "adoption_needed"].includes(file.status));
      if (blocked) {
        throw new Error(
          `distribute apply did not cleanly apply ${blocked.relpath}: ${blocked.status}${blocked.reason ? `/${blocked.reason}` : ""}`,
        );
      }
    }
    await writeOwnershipRecords({ worktreePath, applySet, now });

    failedStage = "applied";
    await appendRunState({
      recordPath,
      state: "applied",
      entry: { ...base, branch: branchName, worktreePath },
      now: now(),
    });

    const audit = await refreshRepo({
      repo: worktreeRepo,
      catalog: activeCatalog,
      categories: [...new Set(applySet.items.map((item) => item.category))],
      now: now(),
      baseSha: applySet.repo.baseSha,
    });
    const clean = postApplyAuditClean(audit, applySet);
    if (!clean) throw new Error("post-apply audit is not clean");

    failedStage = "verified_local";
    await appendRunState({
      recordPath,
      state: "verified_local",
      entry: { ...base, branch: branchName, worktreePath },
      now: now(),
    });

    const localResult = {
      runId: applySet.runId,
      state: "verified_local",
      branch: branchName,
      worktreePath,
      recordPath,
      results: { applied: resultItemsFromApplySet(applySet), skipped: [], blocked: [], failed: [] },
      verification: { local: { status: "passed", detail: "post-apply audit clean" }, postMerge: { status: "skipped" } },
    };
    if (mode === "local-only") return localResult;

    const changedPaths = changedPathsForApplySet(applySet);
    await git({ runCommand, cwd: worktreePath, args: ["add", "--", ...changedPaths] });
    const status = await git({ runCommand, cwd: worktreePath, args: ["status", "--porcelain"] });
    if (!status) throw new Error("post-apply worktree has no changes to commit");
    await git({
      runCommand,
      cwd: worktreePath,
      args: ["commit", "-m", `feat(agents): apply refresh ${applySet.runId}`],
    });
    const headSha = await git({ runCommand, cwd: worktreePath, args: ["rev-parse", "HEAD"] });
    failedStage = "committed";
    await appendRunState({
      recordPath,
      state: "committed",
      entry: { ...base, branch: branchName, headSha },
      now: now(),
    });

    await git({ runCommand, cwd: worktreePath, args: ["push", "-u", "origin", branchName] });
    failedStage = "pushed";
    await appendRunState({
      recordPath,
      state: "pushed",
      entry: { ...base, branch: branchName, headSha },
      now: now(),
    });

    const repoSlug = `${applySet.repo.owner}/${applySet.repo.name}`;
    const prBody = prBodyForApplySet(applySet);
    const pr = await createDraftPr({
      repoSlug,
      base: applySet.repo.defaultBranch,
      head: branchName,
      title: `feat(agents): apply refresh ${applySet.runId}`,
      body: prBody,
      draft: mode !== "auto",
      runGh,
    });
    await addPrLabel({ repoSlug, prNumber: pr.number, label: "automated-distribution", runGh });

    failedStage = "pr_created";
    await appendRunState({
      recordPath,
      state: "pr_created",
      entry: { ...base, branch: branchName, headSha, prNumber: pr.number, prUrl: pr.url },
      now: now(),
    });

    const prResult = { ...localResult, state: "pr_created", headSha, pr };
    if (mode === "pr-only") return prResult;

    const checks = await listPrChecks({ repoSlug, prNumber: pr.number, runGh });

    // Resolve the required-check set at execute time. An explicit non-empty set wins
    // (used by tests / deliberate overrides); otherwise resolve from the target's live
    // branch protection. resolveRequiredChecks fails closed -> empty set -> auto refuses.
    let resolvedChecks = requiredChecks;
    let requiredChecksSource = "explicit";
    let requiredChecksStatus = "explicit";
    if (resolvedChecks.length === 0) {
      const resolution = await resolveRequiredChecks({
        owner: applySet.repo.owner,
        repo: applySet.repo.name,
        branch: applySet.repo.defaultBranch,
        targetPath: absoluteTarget,
        runCommand,
      });
      resolvedChecks = resolution.checks;
      requiredChecksSource = resolution.source;
      requiredChecksStatus = resolution.status;
    }

    failedStage = "checks_pending";
    await appendRunState({
      recordPath,
      state: "checks_pending",
      entry: {
        ...base,
        branch: branchName,
        headSha,
        prNumber: pr.number,
        requiredChecks: resolvedChecks,
        requiredChecksSource,
        requiredChecksStatus,
      },
      now: now(),
    });

    // C1: evaluate the gate against the PR's ACTUAL GitHub state (labels/body fetched
    // back from gh), the resolved required-check set, and the real post-apply audit
    // result — never the lane's own locally constructed inputs.
    const prView = await getPrView({ repoSlug, prNumber: pr.number, runGh });
    const autoMerge = evaluateAutoMergeEligibility({
      applySet,
      confirmationPhrase,
      pr: { labels: prView.labels, body: prView.body },
      requiredChecks: resolvedChecks,
      requireConfiguredChecks: true,
      checks,
      postApplyAudit: { clean },
    });
    if (!autoMerge.eligible) {
      return {
        ...prResult,
        state: "checks_pending",
        checks,
        autoMerge,
        requiredChecks: resolvedChecks,
        requiredChecksSource,
        requiredChecksStatus,
      };
    }

    await queueAutoMerge({ repoSlug, prNumber: pr.number, runGh });
    failedStage = "merge_queued";
    await appendRunState({
      recordPath,
      state: "merge_queued",
      entry: { ...base, branch: branchName, headSha, prNumber: pr.number },
      now: now(),
    });
    return { ...prResult, state: "merge_queued", checks, autoMerge };
  } catch (err) {
    await appendFailure({ recordPath, runId: applySet.runId, failedStage, error: err, now });
    throw err;
  }
}
