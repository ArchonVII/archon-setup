import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadRegistry, buildPlan } from "../planner/buildPlan.mjs";
import { executePlan } from "../executor/executePlan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/server/onboard -> src/snapshots/manifest.json
const SNAPSHOT_MANIFEST = join(__dirname, "..", "..", "snapshots", "manifest.json");

// The wizard's default Features screen pre-selects every `default` feature.
// Headlessly we restrict to the ones that need no GitHub remote so the CLI is
// deterministic and offline-friendly — exactly the "local baseline" the
// existing-repo onboarding (e.g. jma-history during F19) needed.
export function defaultLocalSelection(features) {
  return features.filter((f) => f.default && !f.remoteRequirement).map((f) => f.id);
}

// Mirrors the wizard's Execute gate (src/ui/app.mjs renderReview): a missing or
// duplicate language-CI choice and feature conflicts are hard blockers; missing
// remote capabilities are surfaced as non-blocking warnings.
export function isBlockingWarning(w) {
  return w.feature === "workflows.ci" || /conflicts with/.test(w.message);
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
//   features    optional array of feature IDs; defaults to the local baseline
//   owner/repo/visibility   manifest + CODEOWNERS context
//   options     per-feature option overrides (e.g. { foundation.license: { spdx } })
//   capabilities  capability bits for remote features (default none)
//   dryRun      build + return the plan without writing
//   onEvent     forwarded to the executor for progress streaming
//
// returns:
//   dry-run  -> { ok: true, dryRun: true, plan, blockingWarnings }
//   blocked  -> { ok: false, plan, blockingWarnings }   (executor not run)
//   executed -> { ok, plan, result, blockingWarnings }
export async function runOnboard({
  targetPath,
  features = null,
  owner = "",
  repo = "",
  visibility = "private",
  options = {},
  capabilities = {},
  dryRun = false,
  onEvent = null,
} = {}) {
  if (!targetPath) throw new Error("targetPath is required");

  const { features: allFeatures } = await loadRegistry();
  const selection = features && features.length ? features : defaultLocalSelection(allFeatures);

  const known = new Set(allFeatures.map((f) => f.id));
  const unknown = selection.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`unknown feature(s): ${unknown.join(", ")}`);

  const context = {
    targetPath,
    owner,
    account: owner, // owner doubles as the active account when set headlessly
    repo,
    visibility,
    capabilities,
    sourceSnapshots: await loadSourceSnapshots(),
  };

  const plan = await buildPlan({ selection, options, context });
  const blockingWarnings = (plan.warnings || []).filter(isBlockingWarning);

  if (dryRun) {
    return { ok: true, dryRun: true, plan, blockingWarnings };
  }
  if (blockingWarnings.length) {
    return { ok: false, plan, blockingWarnings };
  }

  const result = await executePlan(plan, { onEvent });
  return { ok: result.ok, plan, result, blockingWarnings };
}
