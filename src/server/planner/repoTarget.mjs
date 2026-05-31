// Pure repo-target resolution. See spec section 1.
// Precedence: explicit owner/repo > detected github origin > will-create
// (only when remote.github selected) > none.
export function resolveRepoTarget({ explicit, originDetected, selection = [] } = {}) {
  if (explicit && explicit.owner && explicit.repo) {
    return { status: "known", source: "explicit", owner: explicit.owner, repo: explicit.repo };
  }
  if (originDetected && originDetected.owner && originDetected.repo) {
    return { status: "known", source: "origin", owner: originDetected.owner, repo: originDetected.repo };
  }
  if (selection.includes("remote.github")) {
    return { status: "will-create", source: "remote.github" };
  }
  return { status: "none" };
}

// Returns a NEW context with the resolved target applied. Never mutates input.
// For "known", owner/repo become the single source of truth downstream tasks read.
export function applyResolvedRepoTarget(context, target) {
  if (target.status === "known") {
    return { ...context, owner: target.owner, repo: target.repo, githubRepoTarget: target };
  }
  return { ...context, githubRepoTarget: target };
}

// Single source of truth for whether a diagnostic blocks Execute.
// Both runOnboard (CLI) and renderReview (wizard) consume buildPlan's stamped
// `blocking`, which is computed from this.
export function isBlockingWarning(w) {
  return (
    w.severity === "error" ||
    w.feature === "workflows.ci" || // legacy: missing/duplicate language-CI choice
    /conflicts with/.test(w.message) // legacy: feature conflicts
  );
}
