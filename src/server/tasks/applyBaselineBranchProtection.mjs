import { runCommand } from "../lib/commandRunner.mjs";

// Applies baseline branch protection to `main` via the GitHub REST API.
// Baseline = require PR, dismiss stale reviews, linear history, no force-push,
// conversations resolve. No named required status checks (deferred — see plan).
//
// Source: https://docs.github.com/rest/branches/branch-protection#update-branch-protection
const PROTECTION_BODY = {
  required_status_checks: null,
  enforce_admins: false,
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
  },
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
  block_creations: false,
  lock_branch: false,
  allow_fork_syncing: true,
};

async function getProtection(owner, repo) {
  const res = await runCommand(
    "gh",
    ["api", `repos/${owner}/${repo}/branches/main/protection`, "--silent"],
    { timeoutMs: 10_000 }
  );
  return res.code === 0;
}

export async function check(ctx) {
  if (await getProtection(ctx.owner, ctx.repo)) return "already-done";
  return "needs-apply";
}

export async function apply(ctx) {
  const body = JSON.stringify(PROTECTION_BODY);
  const res = await runCommand(
    "gh",
    [
      "api",
      "--method",
      "PUT",
      `repos/${ctx.owner}/${ctx.repo}/branches/main/protection`,
      "--input",
      "-",
    ],
    { stdin: body, timeoutMs: 15_000 }
  );
  if (res.code !== 0) throw new Error(`branch protection failed: ${res.stderr || res.stdout}`);
  ctx.manifest.remoteActions.push({
    type: "branchProtection.applyBaseline",
    result: "ok",
    note: "Named required checks deferred — see postChecks.",
  });
  return { result: "applied" };
}

export async function verify(ctx) {
  return { ok: await getProtection(ctx.owner, ctx.repo) };
}

export function rollbackHint(ctx) {
  return `To remove protection: gh api --method DELETE repos/${ctx.owner}/${ctx.repo}/branches/main/protection`;
}
