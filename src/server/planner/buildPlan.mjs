import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveRepoTarget, applyResolvedRepoTarget, isBlockingWarning } from "./repoTarget.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = join(__dirname, "..", "..", "registry");

let registryCache = null;

export async function loadRegistry() {
  if (registryCache) return registryCache;
  const [features, groups, schema] = await Promise.all([
    readFile(join(REGISTRY_DIR, "features.json"), "utf8").then(JSON.parse),
    readFile(join(REGISTRY_DIR, "groups.json"), "utf8").then(JSON.parse),
    readFile(join(REGISTRY_DIR, "schema.json"), "utf8").then(JSON.parse),
  ]);
  registryCache = { features, groups, schema };
  return registryCache;
}

// Resolves the closure of selected features (transitively includes `requires`).
function resolveSelection(features, selection) {
  const byId = new Map(features.map((f) => [f.id, f]));
  const out = new Set();
  function add(id) {
    if (out.has(id)) return;
    const f = byId.get(id);
    if (!f) throw new Error(`unknown feature: ${id}`);
    out.add(id);
    for (const dep of f.requires || []) add(dep);
  }
  for (const id of selection) add(id);
  return [...out].map((id) => byId.get(id));
}

function codeownersOwner(context) {
  return (context.owner || context.account || "").trim();
}

function defaultOptionsFor(feature) {
  const resolved = {};
  for (const [key, option] of Object.entries(feature.options || {})) {
    if (option.type === "constant") resolved[key] = option.value;
    else if (Object.hasOwn(option, "default")) resolved[key] = option.default;
  }
  return resolved;
}

function taskPhase(unit) {
  if (unit.taskId === "initGitAndCommit") return 10;
  if (unit.taskId === "ghRepoCreateAndPush") return 20;
  if (unit.taskId === "applyLabels") return 30;
  if (unit.taskId === "applyBaselineBranchProtection") return 40;
  return 0;
}

// Build a normalized plan from a user selection + options + context.
//
// input:
//   selection:  array of feature IDs the user enabled
//   options:    { [featureId]: { [optionKey]: value } }
//   context:    { targetPath, owner, repo, visibility, account, capabilities }
//
// output: a plan object with .files, .commands, .remoteMutations, .postChecks, .ordered (task sequence)
export async function buildPlan({ selection, options = {}, context }) {
  const { features } = await loadRegistry();
  const resolved = resolveSelection(features, selection);

  const explicit = context.owner && context.repo ? { owner: context.owner, repo: context.repo } : null;
  const resolvedTarget = resolveRepoTarget({
    explicit,
    originDetected: context.originDetected || null,
    selection: resolved.map((f) => f.id),
  });
  const planContext = applyResolvedRepoTarget(context, resolvedTarget);

  const plan = {
    context: { ...planContext },
    selectedFeatureIds: resolved.map((f) => f.id),
    files: [],
    skippedFiles: [],
    commands: [],
    remoteMutations: [],
    postChecks: [],
    ordered: [], // task units in execution order
    warnings: [],
  };

  // Capability gate (non-blocking warnings)
  for (const f of resolved) {
    for (const cap of f.capabilitiesNeeded || []) {
      if (!planContext.capabilities?.[cap]) {
        plan.warnings.push({ feature: f.id, message: `missing capability: ${cap}`, severity: "warn" });
      }
    }
  }

  // remoteRequirement gate (spec section 3). runtime -> warn (deduped); api-target -> error.
  const targetKnown = resolvedTarget.status === "known";
  const willCreate = resolvedTarget.status === "will-create";
  const haveCreateIdentity = Boolean(planContext.owner && planContext.repo);
  let runtimeNeedsTarget = false;
  for (const f of resolved) {
    if (f.remoteRequirement === "runtime") {
      if (!targetKnown && !willCreate) runtimeNeedsTarget = true;
    } else if (f.remoteRequirement === "api-target") {
      if (resolvedTarget.status === "none") {
        plan.warnings.push({
          feature: f.id,
          message: `needs a GitHub repo target — point at an existing repo or select "Create GitHub repo".`,
          severity: "error",
        });
      } else if (willCreate && !haveCreateIdentity) {
        plan.warnings.push({
          feature: f.id,
          message: `cannot run: "Create GitHub repo" is selected but owner/repo are not set.`,
          severity: "error",
        });
      }
    }
  }
  if (runtimeNeedsTarget) {
    plan.warnings.push({
      feature: "remote.runtime",
      message:
        `GitHub workflow files will be installed locally, but they will not run until ` +
        `this directory is pushed to GitHub. To create and push a new GitHub repo now, ` +
        `also select "Create GitHub repo."`,
      severity: "warn",
    });
  }

  // Conflicts: a feature may declare `conflictsWith` to mark mutual exclusion
  // (e.g. the three `workflow.*-ci` features — exactly one CI flavor per repo).
  const resolvedIds = new Set(resolved.map((f) => f.id));
  for (const f of resolved) {
    for (const conflictId of f.conflictsWith || []) {
      if (resolvedIds.has(conflictId) && f.id < conflictId) {
        // Emit once per pair using ordered ids to avoid duplicate warnings.
        plan.warnings.push({
          feature: f.id,
          message: `conflicts with selected feature: ${conflictId}`,
        });
      }
    }
  }

  // Required CI: when this repo is being wired to a GitHub remote, exactly
  // one `workflows.ci` feature must be selected so branch protection has a
  // `ci-success` check to require (F1 / issue #17). Surfaced as a warning
  // rather than a hard error so the planner stays pure; the UI / CLI is
  // responsible for blocking Execute when this warning is present.
  const hasRemoteIntent = resolved.some((f) => f.remoteRequirement || f.group === "remote");
  if (resolvedTarget.status !== "none" && hasRemoteIntent) {
    const ciSelected = resolved.filter((f) => f.group === "workflows.ci");
    if (ciSelected.length === 0) {
      plan.warnings.push({
        feature: "workflows.ci",
        message:
          "no required gate or language CI selected — keep workflow.required-gate for the stable repo-required-gate / decision branch-protection check.",
      });
    } else if (ciSelected.length > 1) {
      plan.warnings.push({
        feature: "workflows.ci",
        message: `more than one language CI selected (${ciSelected.map((f) => f.id).join(", ")}) — pick exactly one.`,
      });
    }
  }

  // Order foundations → remote → workflows by group.order from groups.json
  const { groups } = await loadRegistry();
  const groupOrder = new Map(groups.map((g) => [g.id, g.order]));
  resolved.sort((a, b) => (groupOrder.get(a.group) ?? 999) - (groupOrder.get(b.group) ?? 999));

  for (const f of resolved) {
    for (const taskId of f.tasks) {
      plan.ordered.push({
        featureId: f.id,
        taskId,
        options: { ...defaultOptionsFor(f), ...(options[f.id] || {}) },
      });
    }
    for (const c of f.creates || []) {
      if (f.id === "foundation.codeowners" && !codeownersOwner(planContext)) {
        plan.skippedFiles.push({ path: c, reason: "owner unknown" });
        continue;
      }
      plan.files.push({
        action: "create",
        path: c,
        feature: f.id,
      });
    }
    for (const cmd of f.commands || []) {
      plan.commands.push({ ...cmd, feature: f.id });
    }
  }

  plan.ordered = plan.ordered
    .map((unit, index) => ({ ...unit, index }))
    .sort((a, b) => taskPhase(a) - taskPhase(b) || a.index - b.index)
    .map(({ index, ...unit }) => unit);

  // Special-case post-checks for branch protection.
  if (plan.ordered.some((t) => t.taskId === "applyBaselineBranchProtection")) {
    plan.postChecks.push({
      type: "branchProtection.tightenRequiredChecks",
      deferUntil: "firstCheckRun",
      reason: "After the first PR run, require repo-required-gate / decision. GitHub requires a check to have run within 7 days before it can be marked required.",
    });
  }

  for (const w of plan.warnings) w.blocking = isBlockingWarning(w);

  return plan;
}
