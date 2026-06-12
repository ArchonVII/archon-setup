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

// Fast (manifest-only) repo statuses — docs/FRONTEND_REDESIGN_SPEC.md §5.1;
// computed by src/server/ecosystem/manifestStatus.mjs (#215 lane 2).
export const FAST_STATUSES = [
  "not_onboarded",
  "manifest_current",
  "manifest_outdated",
  "unknown_needs_audit",
];

// Maintenance rollup statuses and bases — docs/MAINTENANCE.md status rules
// (spec §4.2). "fast" = cheap local signals only; "audited" = a deep-audit
// cache backed the verdict (the only basis allowed to claim verified truth).
export const MAINTENANCE_STATUSES = ["green", "yellow", "red"];
export const MAINTENANCE_BASES = ["fast", "audited"];

// Closed maintenance reason vocabulary — every status carries reason codes
// (docs/MAINTENANCE.md "Maintenance status"); severity per code is pinned in
// src/server/ecosystem/maintenanceStatus.mjs and tested against this list.
export const MAINTENANCE_REASONS = [
  // all roles
  "repo-unavailable",
  "dirty-worktree",
  // application — fast basis
  "not-onboarded",
  "manifest-outdated",
  "workflow-drift",
  "needs-audit",
  "events-stale",
  "manifest-current-unaudited",
  // application — audited basis (VerifiedStatus, FRONTEND_REDESIGN_SPEC §5.2)
  "verified-current",
  "drift-detected",
  "missing-files",
  "audit-blocked",
  "audit-needs-review",
  // provider / integrator snapshot pins
  "snapshot-current",
  "snapshot-behind",
  "snapshot-integrity",
  "snapshot-unverified",
  "v1-retag-pending",
  // integrator
  "pins-verified",
  "fix-queue-pending",
  // skill-source
  "catalog-present",
  "catalog-missing",
];
