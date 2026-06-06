<!-- title: test: agent lifecycle scripts create status and prune worktrees safely -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:agent-contract -->
<!-- prompt: prompts/general.md -->

## Context

This test exercises the three agent-lifecycle npm scripts — `agent:start-task`, `agent:status`, and `agent:prune` — against the pr-contract lab repo. Because `DEFAULT_AGENT` is `codex`, the `--agent claude` flag must be passed explicitly when starting a task. The test validates that `start-task` correctly provisions a worktree and branch from an open GitHub issue, that the resulting task state file is present and gitignored, that `status` surfaces the expected fields, and that `prune` removes only worktrees that are both merged and clean.

## Acceptance Criteria

- [ ] an **open** issue is pre-created first
- [ ] `npm run agent:start-task -- <issue> --agent claude --slug lifecycle-smoke` creates worktree `../<repo>-<issue>-lifecycle-smoke` and branch `agent/claude/<issue>-lifecycle-smoke`
- [ ] `.agent/current-task.json` exists and is gitignored
- [ ] `npm run agent:status` reports branch / issue / PR / dirty / next-action
- [ ] `npm run agent:prune` removes only merged-clean agent worktrees
- [ ] a dirty/unmerged worktree is **not** pruned

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
