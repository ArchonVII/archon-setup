import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

  const plan = {
    context: { ...context },
    selectedFeatureIds: resolved.map((f) => f.id),
    files: [],
    commands: [],
    remoteMutations: [],
    postChecks: [],
    ordered: [], // task units in execution order
    warnings: [],
  };

  // Capability gate
  for (const f of resolved) {
    for (const cap of f.capabilitiesNeeded || []) {
      if (!context.capabilities?.[cap]) {
        plan.warnings.push({
          feature: f.id,
          message: `missing capability: ${cap}`,
        });
      }
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
        options: options[f.id] || {},
      });
    }
    for (const c of f.creates || []) {
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

  // Special-case post-checks for branch protection.
  if (plan.ordered.some((t) => t.taskId === "applyBaselineBranchProtection")) {
    plan.postChecks.push({
      type: "branchProtection.tightenRequiredChecks",
      deferUntil: "firstCheckRun",
      reason: "GitHub requires a check to have run within 7 days before it can be marked required.",
    });
  }

  return plan;
}
