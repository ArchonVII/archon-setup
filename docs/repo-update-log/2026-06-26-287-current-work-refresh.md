# 2026-06-26 - CURRENT_WORK refresh + onboarding-baseline arc

- **Issue/PR:** #287 / (this PR)
- **Branch:** agent/claude/287-current-work-refresh
- **Changed paths:** `docs/CURRENT_WORK.md`, `docs/repo-update-log/2026-06-26-287-current-work-refresh.md`.
- **What changed:** Refreshed the current-work map after #275: marked the 2026-06-21 triage fixes that merged (#252 → #276, #153 → #274, #272 → #277), added a new **Onboarding-baseline self-consistency** section (PRs #284/#279/#273; issues #278/#280/#281/#282/#283/#286) and a civ-sim first-consumer-onboarding line (audited greenfield, queued behind #284), and bumped the Stage 1 telemetry note to ~day 11 (window closes ~2026-06-29). Docs-only.
- **Verification:** `git diff --check` clean; touched files are Markdown only (no code paths, no workflow changes, so node-test/actionlint unaffected). CI `ci-success` + `check` expected green.
- **Propagation:** archon-setup-local status doc only; no snapshot/consumer propagation.
