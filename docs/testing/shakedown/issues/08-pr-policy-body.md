<!-- title: test: pr-policy rejects missing verification and issue link -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:workflow -->
<!-- prompt: prompts/negative-control.md -->

## Context

This test exercises the pr-policy leaf check that validates the body of non-doc PRs against `archon-setup-lab-pr-contract`. The policy requires a structured body containing mandatory sections, at least one checked verification box backed by concrete evidence, and a `Closes #<issue>` reference. A PR with an incomplete body must cause the check to go red; supplying a fully conforming body must make it turn green.

## Acceptance Criteria

- [ ] Open a non-doc PR with an incomplete body (e.g. empty or missing required sections) against `archon-setup-lab-pr-contract`; confirm the `pr-policy` check reports **red**.
- [ ] Update the PR body to include the sections `## Summary`, `## Verification`, `### Verification Notes`, `## Docs / Changelog` in that order, at least one checked checkbox backed by concrete evidence, and `Closes #<issue>`; confirm the `pr-policy` check reports **green**.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
