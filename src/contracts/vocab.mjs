// Closed vocabularies shared by every M0.5 contract (#156). These are the
// single source the schemas, the operation-mapping golden, and the M1–M3
// runtime modules must agree on; test/contractSchemas.test.mjs pins each
// schema enum to these exports so the JSON files cannot drift silently.

// Decision options / ApplySet resolutions — closed vocabulary from the
// approved e2e plan (DecisionDoc contract, plans/we-have-open-prs-…#L66).
export const RESOLUTION_OPTIONS = ["apply-central", "keep-local", "merge-manual", "defer"];

// Operation.action — docs/FRONTEND_REDESIGN_SPEC.md §4.4 (the atom of trust).
export const OPERATION_ACTIONS = ["create", "overwrite", "merge", "skip", "blocked", "needs_review"];

// Operation.currentState — docs/FRONTEND_REDESIGN_SPEC.md §4.4.
export const CURRENT_STATES = ["missing", "present", "drifted", "unknown"];

// Raw per-file distributor statuses — src/distributor/distribute.mjs
// (reconcileFile return values; tallied in tallyCounts).
export const RAW_FILE_STATUSES = ["clean_apply", "adoption_needed", "conflict", "skip", "failed"];

// Raw per-repo distributor statuses + skip reasons — distribute.mjs
// distributeRepo fail-closed gates (DL4 "never guess").
export const RAW_REPO_STATUSES = ["ok", "skipped"];
export const REPO_SKIP_REASONS = [
  "missing-path",
  "repo-unavailable",
  "unknown-branch",
  "dirty-worktree",
  "protected-main",
];

// Closed recommendation-reason enum — plan requirement "recommendations are
// deterministic and explainable"; the conflict literal is pinned verbatim by
// the plan (DL4: conflicts always get recommended:null with this reason).
export const RECOMMENDATION_REASONS = [
  "managed-region-clean-update",
  "managed-region-create",
  "already-current",
  "adoption-needs-confirmation",
  "not-applicable",
  "blocked-conflict-requires-human-resolution",
  "blocked-operational-failure",
];

// Distribution categories — #145 granular-distributor design (AGENTS ships
// first; hooks/callers/baseline are M8–M10; skills is report-only M7).
export const CATEGORIES = ["agents", "hooks", "callers", "baseline", "skills"];

// Repo registry lifecycles — #214 ecosystem-registry design (spec §4.1):
// "removed" is a tombstone kept for history, never an active health target.
export const REPO_LIFECYCLES = ["active", "inactive", "removed"];

// Repo registry roles — mirrors config/ecosystem-map.json roles plus the
// consumer "application" role (spec §4.1; docs/MAINTENANCE.md duty tables).
export const REPO_ROLES = [
  "application",
  "workflow-provider",
  "baseline-provider",
  "org-defaults-provider",
  "ecosystem-health-hub",
  "skill-source",
];
