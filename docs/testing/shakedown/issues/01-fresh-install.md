<!-- title: test: fresh repo onboarding creates complete Archon baseline -->
<!-- repo: ArchonVII/archon-setup-lab-fresh -->
<!-- labels: type:test, status:shakedown, area:onboarding -->
<!-- prompt: prompts/general.md -->

## Context
This test exercises the happy-path onboarding flow for a brand-new repository using archon-setup's full feature set. The lab repo is itself created by dogfooding the onboard wizard (Test #0), making this the primary end-to-end signal that the bootstrapper correctly initialises a complete Archon baseline — files, hooks, workflows, labels, and branch protection — from a clean slate.

## Acceptance Criteria
- [ ] headless `--dry-run --json` plan is correct (lists files/commands to be created, no writes)
- [ ] the real write produces the baseline files
- [ ] `.github/archon-setup.json` records selected features + deferred post-checks
- [ ] `.githooks/` is present and `core.hooksPath` is set
- [ ] `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agent/check-map.yml`, and `docs/repo-update-log.md` all exist
- [ ] the PR-contract workflows are installed
- [ ] labels are applied
- [ ] baseline branch protection is applied
- [ ] the first PR makes the `repo-required-gate / decision` check appear
- [ ] `tighten-required-gate` succeeds after the first gate run

## Verification
Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
