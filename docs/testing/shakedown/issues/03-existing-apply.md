<!-- title: test: existing repo onboarding preserves useful facts and replaces stale process -->
<!-- repo: ArchonVII/archon-setup-lab-lived-in -->
<!-- labels: type:test, status:shakedown, area:onboarding -->
<!-- prompt: prompts/reconciliation.md -->

## Context
This test exercises the write phase of the existing-repo onboarding path, immediately following the audit in issue #2. The lab repo contains a realistic mix of keeper content (project facts, runbook commands, real scripts) and stale policy (outdated CLAUDE.md/AGENTS.md content, machine-local paths, sibling-repo references), verifying that the reconciliation step surgically preserves what matters and replaces what does not.

## Acceptance Criteria
- [ ] useful facts are preserved (README project facts, `docs/runbook.md` commands, real `package.json` scripts)
- [ ] stale duplicated policy is replaced
- [ ] machine-local paths and sibling-repo references are dropped
- [ ] existing workflows are each marked preserved / replaced / needs-review with a rationale
- [ ] `.agent/check-map.yml` reflects the repo's real scripts
- [ ] `docs/repo-update-log.md` records the onboarding
- [ ] the PR body includes a reconciliation table (file / signal found / decision / reason)

## Verification
Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
