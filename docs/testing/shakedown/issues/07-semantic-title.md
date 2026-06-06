<!-- title: test: semantic-pr-title workflow rejects malformed titles -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:workflow -->
<!-- prompt: prompts/negative-control.md -->

## Context

This test exercises the semantic-pr-title leaf check that validates PR titles against the Conventional Commits format on every PR opened or edited against `archon-setup-lab-pr-contract`. A freeform title that omits a type prefix must cause the check to go red; retitling to a well-formed Conventional Commits title must make it turn green, confirming the check re-evaluates on `edited` events.

## Acceptance Criteria

- [ ] Open a PR titled `update stuff` against `archon-setup-lab-pr-contract`; confirm the `semantic-pr-title` check reports **red**.
- [ ] Edit the PR title to `test(pr-contract): exercise semantic title gate`; confirm the `semantic-pr-title` check reports **green**.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
