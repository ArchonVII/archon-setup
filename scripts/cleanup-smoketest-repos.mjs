#!/usr/bin/env node
// One-time remediation helper for the smoke-test repos leaked before the
// no-remote policy landed (archon-setup#43). Lists ArchonVII `*-smoketest-*`
// repos; deletes them ONLY when explicitly confirmed AND the gh session has the
// `delete_repo` scope. Default is a dry run that prints the exact commands.
//
//   node scripts/cleanup-smoketest-repos.mjs            # dry run (default)
//   node scripts/cleanup-smoketest-repos.mjs --confirm  # delete (needs scope)
//
// Granting delete authority is a human action: if the scope is missing it
// refuses and tells you to run `gh auth refresh -h github.com -s delete_repo`.
// This is remediation, not policy — the standing policy is that smoke tests
// never create real repos (see the no-remote smoke test).

import { execFileSync } from "node:child_process";

const DEFAULT_OWNER = "ArchonVII"; // the org the leaked repos live under (issue #43)

// The leaked artifacts were named `<base>-smoketest-<variant>-<date>`. Match the
// hyphen-delimited `-smoketest-` token so normal repo names never match.
export function isSmoketestRepo(name) {
  return /-smoketest-/.test(name);
}

export function selectSmoketestRepos(names) {
  return names.filter(isSmoketestRepo);
}

// gh auth status prints e.g. "Token scopes: 'repo', 'delete_repo', 'workflow'".
export function hasDeleteRepoScope(authStatusText) {
  return /\bdelete_repo\b/.test(authStatusText || "");
}

export function deleteCommandsFor(repos, owner = DEFAULT_OWNER) {
  return repos.map((name) => `gh repo delete ${owner}/${name} --yes`);
}

// Pure decision: what would we do, given the candidate repos + the two gates.
export function planCleanup({ repos, confirm, hasDeleteScope }) {
  const matched = selectSmoketestRepos(repos);
  if (!confirm) {
    return { mode: "dry-run", matched, willDelete: [], refusedReason: null };
  }
  if (!hasDeleteScope) {
    return {
      mode: "blocked",
      matched,
      willDelete: [],
      refusedReason:
        "the gh session lacks the delete_repo scope — run `gh auth refresh -h github.com -s delete_repo`",
    };
  }
  return { mode: "delete", matched, willDelete: matched, refusedReason: null };
}

// ---- CLI (not unit-tested; the logic above is) -----------------------------

function listOrgRepos(owner) {
  const out = execFileSync("gh", ["repo", "list", owner, "--limit", "200", "--json", "name"], {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  return JSON.parse(out).map((r) => r.name);
}

function readDeleteScope() {
  try {
    // gh prints scopes to stderr on `auth status`.
    const out = execFileSync("gh", ["auth", "status"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    return hasDeleteRepoScope(out);
  } catch (err) {
    return hasDeleteRepoScope(err.stderr ? err.stderr.toString() : "");
  }
}

function main(argv) {
  const confirm = argv.includes("--confirm");
  const owner = DEFAULT_OWNER;
  const repos = listOrgRepos(owner);
  const hasScope = confirm ? readDeleteScope() : false;
  const plan = planCleanup({ repos, confirm, hasDeleteScope: hasScope });

  if (plan.matched.length === 0) {
    console.log(`No ${owner}/*-smoketest-* repos found. Nothing to clean up.`);
    return 0;
  }

  console.log(`Matched ${plan.matched.length} smoke-test repo(s) under ${owner}:`);
  for (const name of plan.matched) console.log(`  - ${owner}/${name}`);

  if (plan.mode === "dry-run") {
    console.log("\nDry run (default). To delete, re-run with --confirm. Equivalent commands:");
    for (const cmd of deleteCommandsFor(plan.matched, owner)) console.log(`  ${cmd}`);
    return 0;
  }
  if (plan.mode === "blocked") {
    console.error(`\nRefusing to delete: ${plan.refusedReason}`);
    return 1;
  }

  let failed = 0;
  for (const name of plan.willDelete) {
    try {
      execFileSync("gh", ["repo", "delete", `${owner}/${name}`, "--yes"], { stdio: "inherit" });
      console.log(`deleted ${owner}/${name}`);
    } catch {
      failed += 1;
      console.error(`failed to delete ${owner}/${name}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

// Run main() only when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  process.exit(main(process.argv.slice(2)));
}
