import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSmoketestRepo,
  selectSmoketestRepos,
  hasDeleteRepoScope,
  deleteCommandsFor,
  planCleanup,
} from "../scripts/cleanup-smoketest-repos.mjs";

// The five repos leaked by PR #41's manual smoke run (issue #43).
const LEAKED = [
  "archon-setup-smoketest-manual-20260530",
  "archon-setup-smoketest-direct-20260530",
  "archon-setup-smoketest-createonly-20260530",
  "archon-setup-smoketest-e2e-20260530",
  "archon-setup-smoketest-e2e2-20260530",
];

test("isSmoketestRepo matches the leaked -smoketest- repos", () => {
  for (const name of LEAKED) assert.equal(isSmoketestRepo(name), true, name);
});

test("isSmoketestRepo does not match normal repos or loose substrings", () => {
  assert.equal(isSmoketestRepo("archon-setup"), false);
  assert.equal(isSmoketestRepo("repo-template"), false);
  assert.equal(isSmoketestRepo("github-workflows"), false);
  // No surrounding hyphens => not the leaked pattern (conservative).
  assert.equal(isSmoketestRepo("smoketest"), false);
  assert.equal(isSmoketestRepo("mysmoketestrepo"), false);
});

test("selectSmoketestRepos filters a mixed list", () => {
  const mixed = ["archon-setup", ...LEAKED, "pigafetta"];
  assert.deepEqual(selectSmoketestRepos(mixed), LEAKED);
});

test("hasDeleteRepoScope detects the scope in gh auth status output", () => {
  const withScope = "  Token scopes: 'gist', 'read:org', 'repo', 'delete_repo', 'workflow'";
  const without = "  Token scopes: 'gist', 'read:org', 'repo', 'workflow'";
  assert.equal(hasDeleteRepoScope(withScope), true);
  assert.equal(hasDeleteRepoScope(without), false);
});

test("deleteCommandsFor produces owner-qualified gh delete commands", () => {
  assert.deepEqual(deleteCommandsFor(["a-smoketest-x", "b-smoketest-y"], "ArchonVII"), [
    "gh repo delete ArchonVII/a-smoketest-x --yes",
    "gh repo delete ArchonVII/b-smoketest-y --yes",
  ]);
});

test("planCleanup defaults to dry-run and never deletes without --confirm", () => {
  const plan = planCleanup({ repos: LEAKED, confirm: false, hasDeleteScope: true });
  assert.equal(plan.mode, "dry-run");
  assert.deepEqual(plan.matched, LEAKED);
  assert.deepEqual(plan.willDelete, []);
  assert.equal(plan.refusedReason, null);
});

test("planCleanup refuses to delete when the delete_repo scope is missing", () => {
  const plan = planCleanup({ repos: LEAKED, confirm: true, hasDeleteScope: false });
  assert.deepEqual(plan.willDelete, []);
  assert.match(plan.refusedReason, /delete_repo/);
  assert.notEqual(plan.mode, "delete");
});

test("planCleanup deletes only when confirmed AND scoped", () => {
  const plan = planCleanup({ repos: ["x-smoketest-1", "keep-me"], confirm: true, hasDeleteScope: true });
  assert.equal(plan.mode, "delete");
  assert.deepEqual(plan.willDelete, ["x-smoketest-1"]);
  assert.equal(plan.refusedReason, null);
});
