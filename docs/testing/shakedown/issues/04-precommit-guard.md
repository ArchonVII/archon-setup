<!-- title: test: pre-commit blocks feature commits from the primary checkout -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:hooks -->
<!-- prompt: prompts/negative-control.md -->

## Context

This test exercises the worktree-guard and Owner-Maintenance Lane enforcement built into the pre-commit hook. The hook has two distinct guards: it blocks any commit made from the primary checkout while on a feature branch (directing the agent to use a worktree instead), and it blocks direct commits to `main`/`master` except for add-only changes to safe owner-maintained paths. Verifying both the blocking and the allowed lane confirms that the hook fires correctly without requiring any bypass override.

## Acceptance Criteria

- [ ] hooks are installed first via `.githooks/scripts/install-githooks.sh` (confirm `core.hooksPath` is set)
- [ ] from the **primary checkout** on a feature branch, a commit is **blocked** with a message pointing to worktrees
- [ ] an add-only Owner-Maintenance docs commit on the default branch is **allowed**
- [ ] no `--no-verify` and no `ALLOW_*` override is used at any point
- [ ] a clean repo state is restored afterward

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
