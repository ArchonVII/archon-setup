// Lane C2 (#352): the startup baseline is GENERATED per resolved selection from
// the C1 capability manifest (`installs[]` in features.json) instead of copied
// verbatim from the snapshot. The shipped repo-local checker stays dumb — because
// the baseline FILE it reads is now trimmed to the selection, it automatically
// demands only what was installed (closes promise-matrix row 6). writeAgentsMd
// (emitter) and auditPlan (expectation) both go through this one module so the
// two never disagree on what a selection's floor is.

import { createHash } from "node:crypto";
import { loadRegistry, resolveSelection, resolveProfileId } from "../planner/buildPlan.mjs";

export { resolveProfileId };

// Base of the generated `version` string. Source: owner decision 2026-07-11
// (issue #352, lane C2 of epic #350) — the baseline stopped being a snapshot
// copy and became selection-derived. The trailing content hash (below) makes the
// full version a pure function of the generated floor, so two selections with the
// same floor share a version and any floor change is visible in the version.
export const BASELINE_VERSION_BASE = "2026-07-11-c2-generated";

// Single home for the legacy-path floor. Source: the pre-C2 snapshot
// src/snapshots/repo-template/.agent/startup-baseline.json `legacy[]`, which
// listed exactly this one retired location. Kept as one constant so the string
// lives in exactly one place (was previously duplicated across snapshot + copies).
export const LEGACY_STARTUP_PATHS = ["docs/superpowers/plans/"];

// expectedDirectories derivation rule (lane C2). For every generated `required`
// path with at least three segments whose FIRST segment is `docs` or `scripts`,
// emit the two-segment `<seg0>/<seg1>/` grouping directory. Dedupe + sort.
//
// Rationale: `docs/` and `scripts/` are the content/tooling trees whose grouping
// subdirectories agents are told to expect (docs/plans/, scripts/agent/, …). The
// dot-config trees `.agent/` and `.github/` are implied by their files and were
// never in the hand-authored expectedDirectories list; single-segment scripts
// (scripts/pr-contract.mjs) contribute no grouping dir. This reproduces the
// historical six directories exactly for the agent-standard floor.
export function deriveExpectedDirectories(requiredPaths) {
  const dirs = new Set();
  for (const path of requiredPaths) {
    const segments = path.split("/");
    if (segments.length >= 3 && (segments[0] === "docs" || segments[0] === "scripts")) {
      dirs.add(`${segments[0]}/${segments[1]}/`);
    }
  }
  return [...dirs].sort();
}

// A stable, selection-derived suffix. Hashing the canonical generated floor (not
// the raw feature ids) means the version tracks the actual required/dir/legacy
// content, which is what consumers' checkers care about.
function selectionHash(required, expectedDirectories, legacy) {
  const canonical = JSON.stringify({ required, expectedDirectories, legacy });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

// Pure generator (takes the features array so it is unit-testable without I/O).
// required = sorted union of `installs[].path` where contract === "required" for
// every feature in the selection's closure (any kind — package.json is a required
// merge and belongs in the floor, mirroring the historical baseline).
export function generateStartupBaseline(selectedFeatureIds, features) {
  const resolved = resolveSelection(features, selectedFeatureIds);
  const requiredSet = new Set();
  for (const feature of resolved) {
    for (const install of feature.installs || []) {
      if (install.contract === "required") requiredSet.add(install.path);
    }
  }
  const required = [...requiredSet].sort();
  const expectedDirectories = deriveExpectedDirectories(required);
  const legacy = [...LEGACY_STARTUP_PATHS];
  const version = `${BASELINE_VERSION_BASE}+${selectionHash(required, expectedDirectories, legacy)}`;
  return { version, required, expectedDirectories, legacy };
}

// Canonical on-disk serialization: 2-space indent + trailing newline, key order
// matching the historical snapshot so diffs stay clean. `required` and
// `expectedDirectories` are already sorted by the generator.
export function serializeStartupBaseline(baseline) {
  return (
    JSON.stringify(
      {
        version: baseline.version,
        required: baseline.required,
        expectedDirectories: baseline.expectedDirectories,
        legacy: baseline.legacy,
      },
      null,
      2
    ) + "\n"
  );
}

// Async convenience: load the registry once and generate for a resolved
// selection. Used by writeAgentsMd (via ctx selection) and auditPlan.
export async function loadStartupBaseline(selectedFeatureIds) {
  const { features } = await loadRegistry();
  return generateStartupBaseline(selectedFeatureIds, features);
}

// Async convenience: name the resolved selection (tier id or "custom").
export async function loadProfileId(selectedFeatureIds) {
  const { features, profiles } = await loadRegistry();
  return resolveProfileId(selectedFeatureIds, features, profiles);
}

// Resolve a tier id to its feature list (for bin/onboard.mjs --profile). Throws
// on an unknown id so a typo fails fast instead of onboarding nothing.
export async function loadProfileFeatures(profileId) {
  const { profiles } = await loadRegistry();
  const profile = (profiles?.profiles || []).find((p) => p.id === profileId);
  if (!profile) {
    const known = (profiles?.profiles || []).map((p) => p.id).join(", ");
    throw new Error(`unknown profile: ${profileId} (known: ${known})`);
  }
  return [...profile.features];
}
