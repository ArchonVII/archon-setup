import { checkGit } from "./checkGit.mjs";
import { checkGh } from "./checkGh.mjs";
import { checkGhAuth } from "./checkGhAuth.mjs";
import { checkNode } from "./checkNode.mjs";
import { checkNetwork } from "./checkNetwork.mjs";
import { checkTargetPath } from "./checkTargetPath.mjs";

// Runs all preflight checks in parallel where possible.
// `target` is optional; if provided, target-path validation is included.
export async function runPreflight({ target } = {}) {
  const tasks = [
    Promise.resolve(checkNode()),
    checkGit(),
    checkGh().then(async (gh) => {
      if (gh.status !== "green") return [gh, { id: "gh.auth", status: "red", detail: "gh not installed" }];
      const auth = await checkGhAuth();
      return [gh, auth];
    }),
    checkNetwork(),
    target ? checkTargetPath(target) : Promise.resolve(null),
  ];

  const [node, git, ghPair, network, targetCheck] = await Promise.all(tasks);
  const [gh, ghAuth] = Array.isArray(ghPair) ? ghPair : [ghPair, null];
  const checks = [node, git, gh, ghAuth, network, targetCheck].filter(Boolean);

  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0 }
  );

  return { checks, summary };
}

// Derive capability bits the planner / registry can consume.
export function deriveCapabilities(preflight) {
  const by = Object.fromEntries(preflight.checks.map((c) => [c.id, c]));
  const ghOk = by["gh"]?.status === "green";
  const ghAuthOk = by["gh.auth"]?.status === "green";
  const account = by["gh.auth"]?.account || null;
  return {
    "gh.installed": ghOk,
    "gh.authenticated": ghAuthOk,
    "gh.activeAccountKnown": Boolean(account),
    "gh.repoCreateAllowed": ghAuthOk,
    "gh.repoAdminAllowed": ghAuthOk,
    "gh.branchProtectionAllowed": ghAuthOk,
    "gh.actionsSecretsAllowed": ghAuthOk,
    "gh.orgAdminAllowed": false,
    "gh.copilotAgentAllowed": false,
    account,
  };
}
