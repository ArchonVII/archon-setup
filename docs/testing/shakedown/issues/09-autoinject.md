<!-- title: test: pr-body-autoinject fills an empty PR body at open -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:workflow -->
<!-- prompt: prompts/general.md -->

## Context

This test exercises the pr-body-autoinject workflow on `archon-setup-lab-pr-contract`. The workflow is triggered only on the `opened` event; it detects an empty PR body at the moment of opening and inserts the standard body template/stub. This ensures contributors receive the correct structure automatically even when they submit a PR with no body text.

## Acceptance Criteria

- [ ] Open a PR against `archon-setup-lab-pr-contract` with an **empty body**; confirm the pr-body-autoinject workflow runs and inserts the body template/stub.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.

> Note: synchronize re-runs are NOT tested here because the pr-body-autoinject workflow does not trigger on `synchronize` — only on `opened`.
