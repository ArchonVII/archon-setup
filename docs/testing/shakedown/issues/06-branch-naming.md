<!-- title: test: branch-naming workflow rejects nonconforming PR branches -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:workflow -->
<!-- prompt: prompts/negative-control.md -->

## Context

This test exercises the branch-naming leaf check that runs on every PR opened or updated against `archon-setup-lab-pr-contract`. The check enforces the ArchonVII branch-naming convention (`agent/<tool>/<issue>-<slug>` or equivalent approved prefixes). A nonconforming source branch must cause the check to go red; renaming to a conforming branch must make it turn green, confirming the check re-evaluates on `edited`/`synchronize` events.

## Acceptance Criteria

- [ ] Open a PR from a branch with a nonconforming name (e.g. `my-feature`) against `archon-setup-lab-pr-contract`; confirm the `branch-naming` check reports **red**.
- [ ] Recreate the source branch as `agent/claude/<issue>-<slug>` (conforming name), push, and update or reopen the PR; confirm the `branch-naming` check reports **green**.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
