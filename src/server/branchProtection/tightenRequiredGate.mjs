import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { checkOriginRemote } from "../preflight/checkOriginRemote.mjs";

export const DEFAULT_REQUIRED_GATE_CHECK = "repo-required-gate / decision";
export const DEFAULT_BRANCH = "main";
export const TIGHTEN_POST_CHECK_TYPE = "branchProtection.tightenRequiredChecks";

const TIGHTEN_POST_CHECK_REASON =
  "After the first PR run, require repo-required-gate / decision. GitHub requires a check to have run within 7 days before it can be marked required.";

function branchProtectionPath(owner, repo, branch) {
  return `repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;
}

function requiredStatusChecksPath(owner, repo, branch) {
  return `${branchProtectionPath(owner, repo, branch)}/required_status_checks`;
}

function commandText(res) {
  return `${res?.stderr || ""}\n${res?.stdout || ""}`.trim();
}

function isNotFound(res) {
  return res?.code === 404 || /(^|\D)404(\D|$)|not found/i.test(commandText(res));
}

function isValidationFailure(res) {
  return res?.code === 422 || /validation failed/i.test(commandText(res));
}

async function readManifest(targetRoot) {
  const path = safeJoin(targetRoot, ".github/archon-setup.json");
  try {
    return { path, manifest: JSON.parse(await readFile(path, "utf8")) };
  } catch (err) {
    if (err.code === "ENOENT") return { path, manifest: null };
    throw new Error(`could not read ${path}: ${err.message}`);
  }
}

async function resolveIdentity({ targetRoot, owner, repo, manifest }) {
  if (Boolean(owner) !== Boolean(repo)) {
    throw new Error("--owner and --repo must be provided together");
  }
  if (owner && repo) return { owner, repo, source: "explicit" };
  if (manifest?.owner && manifest?.repo) {
    return { owner: manifest.owner, repo: manifest.repo, source: "manifest" };
  }

  const { originDetected } = await checkOriginRemote(targetRoot);
  if (originDetected?.owner && originDetected?.repo) {
    return { ...originDetected, source: "origin" };
  }

  throw new Error("could not determine GitHub owner/repo; pass --owner and --repo or run inside a repo with a GitHub origin");
}

function requiredCheckContexts(requiredStatusChecks) {
  const contexts = new Set();
  for (const context of requiredStatusChecks?.contexts || []) {
    if (typeof context === "string" && context) contexts.add(context);
  }
  for (const check of requiredStatusChecks?.checks || []) {
    if (typeof check?.context === "string" && check.context) contexts.add(check.context);
  }
  return contexts;
}

function checkEntryFromContext(context) {
  return { context };
}

export function requiredGateAlreadyPresent(requiredStatusChecks, checkName = DEFAULT_REQUIRED_GATE_CHECK) {
  return requiredCheckContexts(requiredStatusChecks).has(checkName);
}

export function buildRequiredGatePayload(requiredStatusChecks, checkName = DEFAULT_REQUIRED_GATE_CHECK) {
  const strict = typeof requiredStatusChecks?.strict === "boolean" ? requiredStatusChecks.strict : false;
  const byContext = new Map();

  for (const check of requiredStatusChecks?.checks || []) {
    if (typeof check?.context !== "string" || !check.context) continue;
    const next = { context: check.context };
    if (Number.isInteger(check.app_id)) next.app_id = check.app_id;
    byContext.set(next.context, next);
  }
  for (const context of requiredStatusChecks?.contexts || []) {
    if (typeof context === "string" && context && !byContext.has(context)) {
      byContext.set(context, checkEntryFromContext(context));
    }
  }
  if (!byContext.has(checkName)) byContext.set(checkName, checkEntryFromContext(checkName));

  return {
    strict,
    checks: [...byContext.values()],
  };
}

async function writeManifestIfChanged(manifestPath, manifest, before) {
  const after = JSON.stringify(manifest, null, 2) + "\n";
  if (after === before) return false;
  await writeFile(manifestPath, after, "utf8");
  return true;
}

async function markManifestComplete({ manifestPath, manifest, checkName, branch, now }) {
  if (!manifest) return false;
  const before = JSON.stringify(manifest, null, 2) + "\n";
  if (!Array.isArray(manifest.postChecks)) manifest.postChecks = [];
  let postCheck = manifest.postChecks.find((entry) => entry?.type === TIGHTEN_POST_CHECK_TYPE);
  if (!postCheck) {
    postCheck = {
      type: TIGHTEN_POST_CHECK_TYPE,
      deferUntil: "firstCheckRun",
      reason: TIGHTEN_POST_CHECK_REASON,
    };
    manifest.postChecks.push(postCheck);
  }

  postCheck.status = "complete";
  if (!postCheck.completedAt) postCheck.completedAt = now();
  postCheck.requiredCheck = checkName;
  postCheck.branch = branch;
  postCheck.result = "required";

  return writeManifestIfChanged(manifestPath, manifest, before);
}

async function getBranchProtection({ owner, repo, branch, runCommand }) {
  const path = branchProtectionPath(owner, repo, branch);
  const res = await runCommand("gh", ["api", path], { timeoutMs: 10_000 });
  if (res.code === 0) {
    try {
      return { ok: true, protection: JSON.parse(res.stdout || "{}") };
    } catch (err) {
      return { ok: false, status: "error", message: `could not parse branch protection response: ${err.message}` };
    }
  }
  if (isNotFound(res)) {
    return {
      ok: false,
      status: "missing-protection",
      message: `Branch protection is not enabled for ${owner}/${repo} ${branch}; apply baseline branch protection first.`,
    };
  }
  return { ok: false, status: "error", message: `could not read branch protection: ${commandText(res)}` };
}

async function patchRequiredStatusChecks({ owner, repo, branch, checkName, payload, runCommand }) {
  const res = await runCommand(
    "gh",
    ["api", "--method", "PATCH", requiredStatusChecksPath(owner, repo, branch), "--input", "-"],
    { stdin: JSON.stringify(payload), timeoutMs: 15_000 }
  );
  if (res.code === 0) return { ok: true };
  if (isValidationFailure(res)) {
    return {
      ok: false,
      status: "pending-check-run",
      message:
        `${checkName} has not run recently enough for GitHub to make it required. ` +
        "Open or refresh a PR so the repo-required-gate workflow runs, then rerun this command.",
    };
  }
  if (isNotFound(res)) {
    // Branch protection was readable moments ago, so a 404 here is GitHub's
    // "Required status checks not enabled" on the subresource — NOT missing
    // branch protection (#301). A rerun re-reads protection and takes the
    // full-protection PUT path instead.
    return {
      ok: false,
      status: "required-checks-not-enabled",
      message:
        `Required status checks are not enabled for ${owner}/${repo} ${branch} ` +
        "(branch protection itself exists). Rerun this command to enable them through the full branch-protection update.",
    };
  }
  return { ok: false, status: "error", message: `could not update required status checks: ${commandText(res)}` };
}

// GitHub's GET /protection response and PUT /protection request use different
// shapes (GET wraps booleans in `{enabled}`, expands users/teams/apps to
// objects). Rebuild a faithful PUT body from the current protection so
// enabling required status checks does not silently reset anything else (#301).
export function putBodyFromProtection(protection, requiredStatusChecks) {
  const enabled = (value) => (typeof value?.enabled === "boolean" ? value.enabled : undefined);
  const logins = (list, key) => (list || []).map((item) => item?.[key]).filter(Boolean);
  const actorGroup = (group) =>
    group
      ? {
          users: logins(group.users, "login"),
          teams: logins(group.teams, "slug"),
          ...(Array.isArray(group.apps) ? { apps: logins(group.apps, "slug") } : {}),
        }
      : undefined;

  const prr = protection?.required_pull_request_reviews;
  let reviews = null;
  if (prr) {
    reviews = {
      dismiss_stale_reviews: Boolean(prr.dismiss_stale_reviews),
      require_code_owner_reviews: Boolean(prr.require_code_owner_reviews),
      required_approving_review_count: Number.isInteger(prr.required_approving_review_count)
        ? prr.required_approving_review_count
        : 0,
    };
    if (typeof prr.require_last_push_approval === "boolean") {
      reviews.require_last_push_approval = prr.require_last_push_approval;
    }
    const dismissal = actorGroup(prr.dismissal_restrictions);
    if (dismissal) reviews.dismissal_restrictions = dismissal;
    const bypass = actorGroup(prr.bypass_pull_request_allowances);
    if (bypass) reviews.bypass_pull_request_allowances = bypass;
  }

  const body = {
    required_status_checks: requiredStatusChecks,
    enforce_admins: enabled(protection?.enforce_admins) ?? false,
    required_pull_request_reviews: reviews,
    restrictions: protection?.restrictions ? actorGroup(protection.restrictions) : null,
  };

  // Optional booleans default to false on PUT when omitted, so preserve every
  // one the GET response exposes.
  for (const key of [
    "required_linear_history",
    "allow_force_pushes",
    "allow_deletions",
    "block_creations",
    "required_conversation_resolution",
    "lock_branch",
    "allow_fork_syncing",
  ]) {
    const value = enabled(protection?.[key]);
    if (typeof value === "boolean") body[key] = value;
  }

  return body;
}

// Baseline protection ships `required_status_checks: null`, and GitHub 404s
// the required_status_checks subresource in that state — the only way to
// enable the gate is a full branch-protection PUT (#301).
async function putBranchProtection({ owner, repo, branch, checkName, protection, payload, runCommand }) {
  const body = putBodyFromProtection(protection, payload);
  const res = await runCommand(
    "gh",
    ["api", "--method", "PUT", branchProtectionPath(owner, repo, branch), "--input", "-"],
    { stdin: JSON.stringify(body), timeoutMs: 15_000 }
  );
  if (res.code === 0) return { ok: true };
  if (isValidationFailure(res)) {
    return {
      ok: false,
      status: "pending-check-run",
      message:
        `${checkName} has not run recently enough for GitHub to make it required. ` +
        "Open or refresh a PR so the repo-required-gate workflow runs, then rerun this command.",
    };
  }
  if (isNotFound(res)) {
    return {
      ok: false,
      status: "missing-protection",
      message: `Branch protection is not enabled for ${owner}/${repo} ${branch}; apply baseline branch protection first.`,
    };
  }
  return { ok: false, status: "error", message: `could not update branch protection: ${commandText(res)}` };
}

// Read-only: resolve the required-status-check contexts currently enforced on the
// target's protected branch. Used by the PR lane at execute time to decide whether
// `auto` mode may queue an auto-merge. Fails CLOSED: a missing-protection / unreadable
// (e.g. no admin scope) / unparseable response all yield an empty check set so the
// caller refuses auto rather than delegating merge safety to unverified branch protection.
export async function resolveRequiredChecks({
  targetPath = process.cwd(),
  owner = "",
  repo = "",
  branch = DEFAULT_BRANCH,
  runCommand = defaultRunCommand,
} = {}) {
  const targetRoot = resolve(targetPath);
  const { manifest } = await readManifest(targetRoot);
  const identity = await resolveIdentity({ targetRoot, owner, repo, manifest });
  const protectionResult = await getBranchProtection({ ...identity, branch, runCommand });
  if (!protectionResult.ok) {
    return {
      checks: [],
      source: "branch-protection",
      status: protectionResult.status, // "missing-protection" | "error"
      message: protectionResult.message,
      owner: identity.owner,
      repo: identity.repo,
      branch,
    };
  }
  const checks = [...requiredCheckContexts(protectionResult.protection.required_status_checks)];
  return {
    checks,
    source: "branch-protection",
    status: "ok",
    owner: identity.owner,
    repo: identity.repo,
    branch,
  };
}

export async function tightenRequiredGate({
  targetPath = process.cwd(),
  owner = "",
  repo = "",
  branch = DEFAULT_BRANCH,
  checkName = DEFAULT_REQUIRED_GATE_CHECK,
  runCommand = defaultRunCommand,
  now = () => new Date().toISOString(),
} = {}) {
  const targetRoot = resolve(targetPath);
  const { path: manifestPath, manifest } = await readManifest(targetRoot);
  const reportedManifestPath = manifest ? manifestPath : null;
  const identity = await resolveIdentity({ targetRoot, owner, repo, manifest });

  const protectionResult = await getBranchProtection({ ...identity, branch, runCommand });
  if (!protectionResult.ok) {
    if (protectionResult.status === "missing-protection") {
      return { ...protectionResult, ok: true, owner: identity.owner, repo: identity.repo, branch, checkName };
    }
    return { ...protectionResult, owner: identity.owner, repo: identity.repo, branch, checkName };
  }

  const requiredStatusChecks = protectionResult.protection.required_status_checks;
  if (requiredGateAlreadyPresent(requiredStatusChecks, checkName)) {
    const manifestUpdated = await markManifestComplete({ manifestPath, manifest, checkName, branch, now });
    return {
      ok: true,
      status: "already-required",
      message: `${checkName} is already required on ${identity.owner}/${identity.repo} ${branch}.`,
      owner: identity.owner,
      repo: identity.repo,
      branch,
      checkName,
      manifestPath: reportedManifestPath,
      manifestUpdated,
    };
  }

  const payload = buildRequiredGatePayload(requiredStatusChecks, checkName);
  // Baseline protection has required_status_checks: null; the subresource
  // PATCH 404s in that state, so route through the full-protection PUT that
  // preserves the rest of the current settings (#301).
  const via = requiredStatusChecks ? "required-status-checks-patch" : "full-protection-put";
  const updateResult = requiredStatusChecks
    ? await patchRequiredStatusChecks({ ...identity, branch, checkName, payload, runCommand })
    : await putBranchProtection({
        ...identity,
        branch,
        checkName,
        protection: protectionResult.protection,
        payload,
        runCommand,
      });
  if (!updateResult.ok) {
    if (["pending-check-run", "missing-protection", "required-checks-not-enabled"].includes(updateResult.status)) {
      return { ...updateResult, ok: true, owner: identity.owner, repo: identity.repo, branch, checkName, via };
    }
    return { ...updateResult, owner: identity.owner, repo: identity.repo, branch, checkName, via };
  }

  const manifestUpdated = await markManifestComplete({ manifestPath, manifest, checkName, branch, now });
  return {
    ok: true,
    status: "required",
    message: `${checkName} is now required on ${identity.owner}/${identity.repo} ${branch}.`,
    owner: identity.owner,
    repo: identity.repo,
    branch,
    checkName,
    via,
    manifestPath: reportedManifestPath,
    manifestUpdated,
  };
}
