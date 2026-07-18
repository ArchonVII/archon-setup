import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadRegistry, buildPlan, resolveProfileId, resolveSelection } from "../planner/buildPlan.mjs";
import { executePlan } from "../executor/executePlan.mjs";
import { checkOriginRemote } from "../preflight/checkOriginRemote.mjs";
import { auditPlan } from "./auditPlan.mjs";
import { runCommand } from "../lib/commandRunner.mjs";
import {
  selectionValidationWarnings,
  validateSelectedRepoTemplateSurface,
} from "./selectionValidation.mjs";

// Onboarding provenance written by tasks that run after initGitAndCommit's
// bootstrap commit — the setup manifest always (executePlan writes it last),
// and CODEOWNERS if its task is ever ordered after git-init. They miss the
// bootstrap commit, and that commit also activates the .githooks
// main-protection guard, so an ordinary follow-up commit of them is refused
// without the sanctioned bypass. We commit them here so a fresh onboard ends
// with a clean working tree (#289).
const PROVENANCE_PATHS = [".github/archon-setup.json", ".github/CODEOWNERS"];

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/server/onboard -> src/snapshots/manifest.json
const SNAPSHOT_MANIFEST = join(__dirname, "..", "..", "snapshots", "manifest.json");

// The wizard's default Features screen pre-selects every `default` feature.
// Headlessly we exclude API-target features that mutate GitHub. Runtime
// workflow callers are local files, but they remain opt-in through the registry
// so standard solo-dev onboarding does not create runner-backed closeout gates.
export function defaultLocalSelection(features) {
  return features.filter((f) => f.default && f.remoteRequirement !== "api-target").map((f) => f.id);
}

// Snapshot provenance recorded into the generated `.github/archon-setup.json`.
// Best-effort: an absent manifest yields an empty record rather than failing.
export async function loadSourceSnapshots() {
  try {
    const manifest = JSON.parse(await readFile(SNAPSHOT_MANIFEST, "utf8"));
    return manifest.snapshots || {};
  } catch {
    return {};
  }
}

// Headless equivalent of the wizard flow: build a plan with the shared planner
// and run it with the shared executor. No browser, no RPC server — the same
// `buildPlan` / `executePlan` the UI drives, so behavior stays in lockstep.
//
// input:
//   targetPath  required — the repo to scaffold/onboard
//   features    optional array of feature IDs; defaults to the minimal local baseline
//   baselineFeatures optional full recorded selection when a repair applies only
//                    a subset now but must preserve the repository's full floor
//   onboardingDispositions optional durable, validated repair decisions written
//                          to the setup manifest
//   owner/repo/visibility   manifest + CODEOWNERS context
//   options     per-feature option overrides (e.g. { foundation.license: { spdx } })
//   capabilities  capability bits for remote features (default none)
//   audit       build + return a read-only present/missing/drifted audit
//   dryRun      build + return the plan without writing
//   onEvent     forwarded to the executor for progress streaming
//
// returns:
//   audit    -> { ok: true, mode: "audit", plan, audit, selectionValidation, blockingWarnings }
//   dry-run  -> { ok: true, dryRun: true, plan, selectionValidation, blockingWarnings }
//   blocked  -> { ok: false, plan, selectionValidation, blockingWarnings }   (executor not run)
//   executed -> { ok, plan, result, selectionValidation, blockingWarnings }
export async function runOnboard({
  targetPath,
  features = null,
  baselineFeatures = null,
  onboardingDispositions = null,
  owner = "",
  repo = "",
  visibility = "private",
  options = {},
  capabilities = {},
  audit = false,
  dryRun = false,
  onEvent = null,
} = {}) {
  if (!targetPath) throw new Error("targetPath is required");

  const { features: allFeatures, profiles } = await loadRegistry();
  const selection = features === null ? defaultLocalSelection(allFeatures) : features;
  const baselineSelection = baselineFeatures === null ? selection : baselineFeatures;

  const known = new Set(allFeatures.map((f) => f.id));
  const unknown = [...new Set([...selection, ...baselineSelection])].filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`unknown feature(s): ${unknown.join(", ")}`);

  if (Boolean(owner) !== Boolean(repo)) {
    throw new Error("--owner and --repo must be provided together (or neither)");
  }

  const { originDetected } = await checkOriginRemote(targetPath);

  const context = {
    targetPath,
    owner,
    account: owner, // owner doubles as the active account when set headlessly
    repo,
    visibility,
    capabilities,
    originDetected,
    sourceSnapshots: await loadSourceSnapshots(),
    ...(onboardingDispositions ? { onboardingDispositions } : {}),
  };

  const plan = await buildPlan({ selection, options, context });
  if (baselineFeatures !== null) {
    plan.baselineFeatureIds = resolveSelection(allFeatures, baselineSelection).map((feature) => feature.id);
    plan.baselineProfile = resolveProfileId(plan.baselineFeatureIds, allFeatures, profiles);
  }
  const validationSelection = plan.baselineFeatureIds || plan.selectedFeatureIds;
  const selectionValidation = await validateSelectedRepoTemplateSurface(validationSelection);
  const blockingWarnings = [
    ...(plan.warnings || []).filter((w) => w.blocking),
    ...selectionValidationWarnings(selectionValidation),
  ];

  if (audit) {
    return {
      ok: selectionValidation.ok,
      mode: "audit",
      plan,
      audit: await auditPlan(plan),
      selectionValidation,
      blockingWarnings,
    };
  }
  if (dryRun) {
    return { ok: selectionValidation.ok, dryRun: true, plan, selectionValidation, blockingWarnings };
  }
  if (blockingWarnings.length) {
    return { ok: false, plan, selectionValidation, blockingWarnings };
  }

  const result = await executePlan(plan, { onEvent });

  // After a fresh bootstrap commit, sweep the onboarding provenance that landed
  // after it into a sanctioned commit so the repo is handed back clean (#289).
  let provenanceCommit = null;
  if (result.ok && bootstrapCommitted(result)) {
    provenanceCommit = await commitProvenance(targetPath);
  }

  return { ok: result.ok, plan, result, selectionValidation, blockingWarnings, provenanceCommit };
}

// Did initGitAndCommit create a fresh bootstrap commit in THIS run? It returns
// { result: "committed" } only when it initialised and committed a repo with no
// prior commits; an existing repo short-circuits to "already-done" (no apply
// result) and is left to its own delivery workflow — we never auto-commit on
// top of a user's existing history.
function bootstrapCommitted(result) {
  const unit = (result?.results || []).find((r) => r.unit?.taskId === "initGitAndCommit");
  return unit?.applied?.result === "committed";
}

async function provenanceIsDirty(targetPath, relPath) {
  const { code, stdout } = await runCommand(
    "git",
    ["-C", targetPath, "status", "--porcelain", "--", relPath],
    { timeoutMs: 5000 }
  );
  return code === 0 && stdout.trim().length > 0;
}

// Commit the post-bootstrap provenance as a sanctioned final step. Uses the
// documented bypass env vars (the same ALLOW_MAIN_COMMIT / ALLOW_NO_ISSUE_REF a
// maintainer would set by hand) so the now-active main-protection and issue-ref
// hooks let the commit through; the bypass is logged to .agent/bypass.log, which
// the onboarded .gitignore now ignores. Stages only the known provenance paths
// (never `git add --all`) to respect commit hygiene (#289).
async function commitProvenance(targetPath) {
  const dirty = [];
  for (const rel of PROVENANCE_PATHS) {
    if (await provenanceIsDirty(targetPath, rel)) dirty.push(rel);
  }
  if (!dirty.length) return { committed: false, reason: "nothing-to-commit" };

  const add = await runCommand("git", ["-C", targetPath, "add", "--", ...dirty], { timeoutMs: 10_000 });
  if (add.code !== 0) throw new Error(`git add (provenance) failed: ${add.stderr}`);

  const commit = await runCommand(
    "git",
    ["-C", targetPath, "commit", "-m", "chore: record archon-setup onboarding provenance"],
    { timeoutMs: 15_000, env: { ALLOW_MAIN_COMMIT: "1", ALLOW_NO_ISSUE_REF: "1" } }
  );
  if (commit.code !== 0) throw new Error(`git commit (provenance) failed: ${commit.stderr}`);
  return { committed: true, paths: dirty };
}
