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
    return {
      ok: false,
      status: "missing-protection",
      message: `Branch protection is not enabled for ${owner}/${repo} ${branch}; apply baseline branch protection first.`,
    };
  }
  return { ok: false, status: "error", message: `could not update required status checks: ${commandText(res)}` };
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
  const patchResult = await patchRequiredStatusChecks({ ...identity, branch, checkName, payload, runCommand });
  if (!patchResult.ok) {
    if (["pending-check-run", "missing-protection"].includes(patchResult.status)) {
      return { ...patchResult, ok: true, owner: identity.owner, repo: identity.repo, branch, checkName };
    }
    return { ...patchResult, owner: identity.owner, repo: identity.repo, branch, checkName };
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
    manifestPath: reportedManifestPath,
    manifestUpdated,
  };
}
