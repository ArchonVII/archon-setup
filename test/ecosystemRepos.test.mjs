import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLastCommit, parseWorktrees, isDirty } from "../src/server/ecosystem/collectRepos.mjs";

test("parseLastCommit splits hash|iso|subject (subject may contain pipes)", () => {
  const c = parseLastCommit("abc1234|2026-05-30T10:00:00-05:00|feat: add a|b thing");
  assert.equal(c.hash, "abc1234");
  assert.equal(c.committedAt, "2026-05-30T10:00:00-05:00");
  assert.equal(c.subject, "feat: add a|b thing");
});

test("parseLastCommit returns null for empty input", () => {
  assert.equal(parseLastCommit("  "), null);
});

test("parseWorktrees reads porcelain blocks", () => {
  const porcelain = [
    "worktree C:/GitHub/archon-setup",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree C:/GitHub/archon-setup-ecosystem",
    "HEAD def456",
    "branch refs/heads/agent/claude/1-ecosystem-dashboard",
    "",
  ].join("\n");
  const wt = parseWorktrees(porcelain);
  assert.equal(wt.length, 2);
  assert.equal(wt[1].branch, "agent/claude/1-ecosystem-dashboard");
});

test("isDirty true only when porcelain has content", () => {
  assert.equal(isDirty(""), false);
  assert.equal(isDirty(" M src/x.mjs\n"), true);
});
