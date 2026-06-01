import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { DEFAULT_REQUIRED_GATE_CHECK } from "../branchProtection/tightenRequiredGate.mjs";

export const HUB_REPOSITORIES = Object.freeze([
  Object.freeze({ owner: "ArchonVII", repo: ".github" }),
  Object.freeze({ owner: "ArchonVII", repo: "github-workflows" }),
  Object.freeze({ owner: "ArchonVII", repo: "repo-template" }),
  Object.freeze({ owner: "ArchonVII", repo: "archon-setup" }),
]);

const UNKNOWN_POSTURE = Object.freeze({
  prRequired: "unknown",
  directPush: "unknown",
  forcePush: "unknown",
  deletion: "unknown",
  requiredGate: "unknown",
});

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function apiFailure(res) {
  const parsed = safeJson(res.stdout) || safeJson(res.stderr);
  const text = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
  const message = parsed?.message || text || `gh api exited with ${res.code}`;
  const httpStatus = parsed?.status || /HTTP\s+(\d{3})/i.exec(text)?.[1] || null;
  return {
    status: "unavailable",
    message,
    httpStatus,
  };
}

async function ghApiJson(path, runCommand) {
  let res;
  try {
    res = await runCommand("gh", ["api", path], { timeoutMs: 10_000 });
  } catch (err) {
    return { ok: false, error: { status: "unavailable", message: err.message, httpStatus: null } };
  }
  if (res.code !== 0) return { ok: false, error: apiFailure(res) };
  const value = safeJson(res.stdout);
  if (value == null) {
    return {
      ok: false,
      error: { status: "unavailable", message: `could not parse gh api response for ${path}`, httpStatus: null },
    };
  }
  return { ok: true, value };
}

function repoPath(owner, repo, suffix = "") {
  return `repos/${owner}/${repo}${suffix}`;
}

function permissionSummary(repoInfo) {
  if (!Object.hasOwn(repoInfo, "permissions")) {
    return { status: "unknown", reason: "repo API did not include permissions" };
  }
  return { status: "available", ...repoInfo.permissions };
}

function normalizeStatusChecks(requiredStatusChecks) {
  if (!requiredStatusChecks) return [];
  const checks = [];
  for (const context of requiredStatusChecks.contexts || []) checks.push(context);
  for (const check of requiredStatusChecks.checks || []) {
    const name = check.context || check.name;
    if (name) checks.push(name);
  }
  return [...new Set(checks)].sort();
}

export function summarizeClassicProtection(protection) {
  const requiredStatusChecks = normalizeStatusChecks(protection.required_status_checks);
  const prRequired = Boolean(protection.required_pull_request_reviews);
  const forcePushBlocked = protection.allow_force_pushes?.enabled === false;
  const deletionBlocked = protection.allow_deletions?.enabled === false;
  return {
    status: "present",
    source: "classic",
    prRequired,
    directPush: prRequired ? "blocked" : protection.restrictions ? "restricted" : "allowed",
    forcePush: forcePushBlocked ? "blocked" : "allowed",
    deletion: deletionBlocked ? "blocked" : "allowed",
    requiredGate: requiredStatusChecks.includes(DEFAULT_REQUIRED_GATE_CHECK) ? "required" : "missing",
    requiredStatusChecks,
    adminBypassAllowed: protection.enforce_admins?.enabled === false,
  };
}

async function readClassicProtection(owner, repo, branch, runCommand) {
  const path = repoPath(owner, repo, `/branches/${encodeURIComponent(branch)}/protection`);
  const res = await ghApiJson(path, runCommand);
  if (res.ok) return summarizeClassicProtection(res.value);
  if (res.error.httpStatus === "404" && /branch not protected/i.test(res.error.message)) {
    return {
      status: "absent",
      source: "classic",
      reason: "Branch not protected",
      prRequired: false,
      directPush: "allowed",
      forcePush: "allowed",
      deletion: "allowed",
      requiredGate: "missing",
      requiredStatusChecks: [],
    };
  }
  return { status: "unavailable", source: "classic", reason: res.error.message, httpStatus: res.error.httpStatus };
}

function escapeRegex(s) {
  return String(s).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function refPatternMatches(pattern, branch) {
  if (pattern === "~DEFAULT_BRANCH") return true;
  const normalizedPattern = String(pattern).replace(/^refs\/heads\//, "");
  const normalizedBranch = String(branch).replace(/^refs\/heads\//, "");
  const re = new RegExp(`^${escapeRegex(normalizedPattern).replace(/\\\*/g, ".*")}$`);
  return re.test(normalizedBranch);
}

export function rulesetAppliesToBranch(ruleset, branch) {
  if (ruleset.target && ruleset.target !== "branch") return false;
  const refName = ruleset.conditions?.ref_name;
  if (!refName) return true;
  const excluded = (refName.exclude || []).some((pattern) => refPatternMatches(pattern, branch));
  if (excluded) return false;
  const include = refName.include || [];
  if (include.length === 0) return true;
  return include.some((pattern) => refPatternMatches(pattern, branch));
}

function ruleTypes(ruleset) {
  return (ruleset.rules || []).map((rule) => rule.type).filter(Boolean);
}

function requiredChecksFromRuleset(ruleset) {
  const checks = [];
  for (const rule of ruleset.rules || []) {
    if (rule.type !== "required_status_checks") continue;
    for (const check of rule.parameters?.required_status_checks || []) {
      const name = check.context || check.name;
      if (name) checks.push(name);
    }
  }
  return [...new Set(checks)].sort();
}

export function summarizeRuleset(ruleset, defaultBranch) {
  const types = ruleTypes(ruleset);
  const requiredStatusChecks = requiredChecksFromRuleset(ruleset);
  const active = ruleset.enforcement === "active";
  const appliesToDefaultBranch = active && rulesetAppliesToBranch(ruleset, defaultBranch);
  const has = (type) => appliesToDefaultBranch && types.includes(type);
  return {
    status: "available",
    source: "ruleset",
    id: ruleset.id,
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    appliesToDefaultBranch,
    rules: types,
    prRequired: has("pull_request"),
    directPush: has("pull_request") ? "blocked" : has("update") ? "restricted" : "allowed",
    forcePush: has("non_fast_forward") ? "blocked" : "allowed",
    deletion: has("deletion") ? "blocked" : "allowed",
    requiredGate: requiredStatusChecks.includes(DEFAULT_REQUIRED_GATE_CHECK) && appliesToDefaultBranch ? "required" : "missing",
    requiredStatusChecks,
    bypassActors: ruleset.bypass_actors || [],
    currentUserCanBypass: ruleset.current_user_can_bypass ?? "unknown",
  };
}

async function readRulesets(owner, repo, defaultBranch, runCommand) {
  const list = await ghApiJson(repoPath(owner, repo, "/rulesets"), runCommand);
  if (!list.ok) {
    return { status: "unavailable", source: "rulesets", reason: list.error.message, httpStatus: list.error.httpStatus, items: [] };
  }
  if (!Array.isArray(list.value)) {
    return { status: "unavailable", source: "rulesets", reason: "rulesets API did not return a list", items: [] };
  }
  const branchRulesets = list.value.filter((ruleset) => !ruleset.target || ruleset.target === "branch");
  if (branchRulesets.length === 0) return { status: "absent", source: "rulesets", items: [] };

  const items = [];
  for (const ruleset of branchRulesets) {
    const detail = await ghApiJson(repoPath(owner, repo, `/rulesets/${ruleset.id}`), runCommand);
    if (detail.ok) {
      items.push(summarizeRuleset(detail.value, defaultBranch));
    } else {
      items.push({
        status: "unavailable",
        source: "ruleset",
        id: ruleset.id,
        name: ruleset.name,
        target: ruleset.target,
        enforcement: ruleset.enforcement,
        appliesToDefaultBranch: "unknown",
        reason: detail.error.message,
        httpStatus: detail.error.httpStatus,
      });
    }
  }
  return { status: "present", source: "rulesets", items };
}

function classicSignals(classic) {
  if (classic.status === "present" || classic.status === "absent") {
    return {
      prRequired: classic.prRequired,
      directPush: classic.directPush,
      forcePush: classic.forcePush,
      deletion: classic.deletion,
      requiredGate: classic.requiredGate,
      unknown: false,
    };
  }
  return { unknown: true };
}

function rulesetSignals(rulesets) {
  if (rulesets.status === "absent") {
    return {
      prRequired: false,
      directPush: "allowed",
      forcePush: "allowed",
      deletion: "allowed",
      requiredGate: "missing",
      unknown: false,
    };
  }
  if (rulesets.status !== "present") return { unknown: true };
  if (rulesets.items.some((item) => item.status === "unavailable" && item.enforcement === "active")) return { unknown: true };
  const applying = rulesets.items.filter((item) => item.status === "available" && item.appliesToDefaultBranch);
  return {
    prRequired: applying.some((item) => item.prRequired),
    directPush: applying.some((item) => item.directPush === "blocked")
      ? "blocked"
      : applying.some((item) => item.directPush === "restricted")
        ? "restricted"
        : "allowed",
    forcePush: applying.some((item) => item.forcePush === "blocked") ? "blocked" : "allowed",
    deletion: applying.some((item) => item.deletion === "blocked") ? "blocked" : "allowed",
    requiredGate: applying.some((item) => item.requiredGate === "required") ? "required" : "missing",
    unknown: false,
  };
}

export function evaluateGovernancePosture({ classic, rulesets }) {
  const signals = [classicSignals(classic), rulesetSignals(rulesets)];
  const hasUnknown = signals.some((signal) => signal.unknown);
  const known = signals.filter((signal) => !signal.unknown);

  const any = (field, value) => known.some((signal) => signal[field] === value);
  const posture = {
    prRequired: any("prRequired", true) ? "required" : hasUnknown ? "unknown" : "not-required",
    directPush: any("directPush", "blocked")
      ? "blocked"
      : any("directPush", "restricted")
        ? "restricted"
        : hasUnknown
          ? "unknown"
          : "allowed",
    forcePush: any("forcePush", "blocked") ? "blocked" : hasUnknown ? "unknown" : "allowed",
    deletion: any("deletion", "blocked") ? "blocked" : hasUnknown ? "unknown" : "allowed",
    requiredGate: any("requiredGate", "required") ? "required" : hasUnknown ? "unknown" : "missing",
  };
  return posture;
}

function postureStatus(posture) {
  if (
    posture.prRequired === "not-required" ||
    posture.directPush === "allowed" ||
    posture.forcePush === "allowed" ||
    posture.deletion === "allowed"
  ) {
    return "red";
  }
  if (Object.values(posture).includes("unknown") || posture.requiredGate === "missing") return "yellow";
  return "green";
}

async function collectOneRepository({ owner, repo }, runCommand) {
  const info = await ghApiJson(repoPath(owner, repo), runCommand);
  if (!info.ok) {
    return {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      status: "yellow",
      defaultBranch: null,
      permissions: { status: "unavailable", reason: info.error.message, httpStatus: info.error.httpStatus },
      classic: { status: "unavailable", source: "classic", reason: "repo metadata unavailable" },
      rulesets: { status: "unavailable", source: "rulesets", reason: "repo metadata unavailable", items: [] },
      posture: { ...UNKNOWN_POSTURE },
    };
  }

  const defaultBranch = info.value.default_branch || null;
  const permissions = permissionSummary(info.value);
  if (!defaultBranch) {
    return {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      status: "yellow",
      defaultBranch,
      permissions,
      classic: { status: "unavailable", source: "classic", reason: "repo API did not include default_branch" },
      rulesets: { status: "unavailable", source: "rulesets", reason: "repo API did not include default_branch", items: [] },
      posture: { ...UNKNOWN_POSTURE },
    };
  }

  const [classic, rulesets] = await Promise.all([
    readClassicProtection(owner, repo, defaultBranch, runCommand),
    readRulesets(owner, repo, defaultBranch, runCommand),
  ]);
  const posture = evaluateGovernancePosture({ classic, rulesets });
  return {
    owner,
    name: repo,
    fullName: `${owner}/${repo}`,
    status: postureStatus(posture),
    defaultBranch,
    permissions,
    classic,
    rulesets,
    posture,
  };
}

export async function collectGovernance({ repositories = HUB_REPOSITORIES, runCommand = defaultRunCommand } = {}) {
  const repos = [];
  for (const repository of repositories) {
    repos.push(await collectOneRepository(repository, runCommand));
  }
  const red = repos.filter((repo) => repo.status === "red").length;
  const yellow = repos.filter((repo) => repo.status === "yellow").length;
  const status = red > 0 ? "red" : yellow > 0 ? "yellow" : "green";
  return {
    id: "governance",
    status,
    detail: `${repos.length} hub repos; ${red} red, ${yellow} unknown or incomplete`,
    repos,
  };
}
