import { test } from "node:test";
import assert from "node:assert/strict";
import { collectRepos, parseLastCommit, parseWorktrees, isDirty } from "../src/server/ecosystem/collectRepos.mjs";
import { normalizeRepoRegistry } from "../src/server/ecosystem/repoRegistry.mjs";

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

function gitRoute(repoPath, args) {
  return `${repoPath} ${args.join(" ")}`;
}

function makeGit(routes) {
  return async (cmd, args) => {
    assert.equal(cmd, "git");
    assert.equal(args[0], "-C");
    const repoPath = args[1];
    const gitArgs = args.slice(2);
    return routes[gitRoute(repoPath, gitArgs)] || { code: 1, stdout: "", stderr: "not found" };
  };
}

test("collectRepos uses active registry entries and keeps inactive repos out of health targets", async () => {
  const registry = normalizeRepoRegistry({
    repositories: [
      {
        id: "skills-review",
        name: "skills-review",
        owner: "ArchonVII",
        repo: "jma-skill-review",
        path: "C:/Users/josep/skills",
        lifecycle: "active",
        healthTarget: true,
        role: "skill-source",
      },
      {
        id: "jma-ui",
        name: "jma-ui",
        owner: "ArchonVII",
        repo: "jma-ui",
        path: "C:/jma/jma-ui",
        lifecycle: "inactive",
        healthTarget: false,
        reason: "retired",
      },
    ],
  }, "registry.json");
  const runCommand = makeGit({
    [gitRoute("C:/Users/josep/skills", ["rev-parse", "--is-inside-work-tree"])]: { code: 0, stdout: "true\n", stderr: "" },
    [gitRoute("C:/Users/josep/skills", ["log", "-1", "--format=%h|%cI|%s"])]: { code: 0, stdout: "abc123|2026-06-09T00:00:00Z|fix: registry\n", stderr: "" },
    [gitRoute("C:/Users/josep/skills", ["status", "--porcelain"])]: { code: 0, stdout: "", stderr: "" },
    [gitRoute("C:/Users/josep/skills", ["branch", "--show-current"])]: { code: 0, stdout: "main\n", stderr: "" },
    [gitRoute("C:/Users/josep/skills", ["worktree", "list", "--porcelain"])]: { code: 0, stdout: "worktree C:/Users/josep/skills\nbranch refs/heads/main\n", stderr: "" },
  });

  const result = await collectRepos({ githubRoot: "C:/ignored", registry, runCommand });

  assert.equal(result.status, "green");
  assert.equal(result.repos.length, 1);
  assert.equal(result.repos[0].id, "skills-review");
  assert.equal(result.repos[0].repo, "jma-skill-review");
  assert.equal(result.repos[0].role, "skill-source");
  assert.equal(result.registry.active, 1);
  assert.equal(result.registry.inactive, 1);
  assert.equal(result.registry.repositories.find((entry) => entry.id === "jma-ui").healthTarget, false);
});

test("collectRepos reports missing active registry paths as unavailable", async () => {
  const registry = normalizeRepoRegistry({
    repositories: [
      {
        id: "missing",
        name: "missing",
        path: "C:/missing",
        lifecycle: "active",
        healthTarget: true,
      },
    ],
  }, "registry.json");

  const result = await collectRepos({
    githubRoot: "C:/ignored",
    registry,
    runCommand: makeGit({}),
  });

  assert.equal(result.status, "yellow");
  assert.equal(result.repos[0].available, false);
  assert.equal(result.repos[0].reason, "not a git worktree");
});

test("collectRepos fails closed when critical git state cannot be read", async () => {
  const registry = normalizeRepoRegistry({
    repositories: [
      {
        id: "status-fails",
        name: "status-fails",
        path: "C:/GitHub/status-fails",
        lifecycle: "active",
        healthTarget: true,
      },
    ],
  }, "registry.json");
  const runCommand = makeGit({
    [gitRoute("C:/GitHub/status-fails", ["rev-parse", "--is-inside-work-tree"])]: { code: 0, stdout: "true\n", stderr: "" },
    [gitRoute("C:/GitHub/status-fails", ["log", "-1", "--format=%h|%cI|%s"])]: { code: 0, stdout: "abc123|2026-06-09T00:00:00Z|fix: fixture\n", stderr: "" },
    [gitRoute("C:/GitHub/status-fails", ["status", "--porcelain"])]: { code: 1, stdout: "", stderr: "fatal: index locked" },
    [gitRoute("C:/GitHub/status-fails", ["branch", "--show-current"])]: { code: 0, stdout: "agent/codex/155-fix\n", stderr: "" },
    [gitRoute("C:/GitHub/status-fails", ["worktree", "list", "--porcelain"])]: { code: 0, stdout: "worktree C:/GitHub/status-fails\nbranch refs/heads/agent/codex/155-fix\n", stderr: "" },
  });

  const result = await collectRepos({ githubRoot: "C:/ignored", registry, runCommand });

  assert.equal(result.status, "yellow");
  assert.equal(result.repos[0].available, false);
  assert.equal(result.repos[0].dirty, false);
  assert.equal(result.repos[0].branch, null);
  assert.equal(result.repos[0].reason, "git state unavailable");
});
