<!-- title: test: close-preflight blocks a malformed PR before ready-for-review -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:agent-contract -->
<!-- prompt: prompts/negative-control.md -->

## Context

This shakedown exercises the close-preflight negative-control path: the `agent:close-preflight` script must reject a draft PR that has incomplete verification (missing title convention, incomplete body, missing update log, or unrecorded verification steps) before any `agent:pr-ready` call is made. No raw `gh pr ready` command is used at any point — the agent contract requires going through the preflight gate. After all defects are remediated the preflight passes and `agent:pr-ready` successfully marks the PR ready for review.

## Acceptance Criteria

- [ ] A draft PR with incomplete verification makes `npm run agent:close-preflight -- --repo OWNER/REPO --pr <n>` **fail**
- [ ] No raw `gh pr ready` is used at any point during the test
- [ ] After fixing the title/body/verification/update-log, `npm run agent:close-preflight -- --repo OWNER/REPO --pr <n>` passes
- [ ] `npm run agent:pr-ready -- --repo OWNER/REPO --pr <n>` marks the PR ready for review

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
