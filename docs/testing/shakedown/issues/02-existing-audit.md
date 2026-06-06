<!-- title: test: existing repo audit classifies present missing and drifted baseline files -->
<!-- repo: ArchonVII/archon-setup-lab-lived-in -->
<!-- labels: type:test, status:shakedown, area:onboarding -->
<!-- prompt: prompts/general.md -->

## Context
This test exercises the read-only audit phase of the existing-repo onboarding path. The lab repo is deliberately messy — carrying a real README, stale CLAUDE.md/AGENTS.md, bespoke CI workflow, pre-commit hook, drifted check-map, runbook, old process doc, real package scripts, and local notes — providing a representative surface to verify that the auditor correctly classifies every baseline file without touching the working tree.

## Acceptance Criteria
- [ ] the audit writes nothing (read-only; confirm the working tree is unchanged afterward)
- [ ] a baseline file that matches is classified `present`
- [ ] a baseline file that is absent is classified `missing`
- [ ] a managed file that was modified is classified `drifted`
- [ ] the repo origin is detected
- [ ] the audit output is saved into the issue/PR

## Verification
Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
Out of scope: applying any changes (that is issue #3).
