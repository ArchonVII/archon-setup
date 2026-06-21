# 2026-06-21 - Repo-template staged/worktree guard snapshot refresh

- **Issue/PR:** #272 / pending
- **Branch:** agent/codex/272-repo-template-staged-worktree-guard-snapshot
- **Changed paths:** `.changelog/unreleased/272-repo-template-staged-worktree-guard-snapshot.md`, `docs/ecosystem-overview.md`, `docs/repo-update-log/2026-06-21-272-repo-template-staged-worktree-guard-snapshot.md`, `src/snapshots/manifest.json`, `src/snapshots/repo-template/.githooks/pre-commit`, `src/snapshots/repo-template/.githooks/scripts/test-owner-maintenance.sh`, `src/snapshots/repo-template/AGENTS.md`, `src/snapshots/repo-template/README.md`.
- **What changed:** Refreshed the `repo-template` snapshot from `98a08fa` to `cd79b1c`, carrying repo-template#114's staged/worktree pre-commit guard into archon-setup snapshots. Regenerated `docs/ecosystem-overview.md` from the updated snapshot manifest. `agent:self-apply` reported the root baselines already current.
- **Verification:** `npm run refresh-snapshots` passed; `npm run agent:self-apply` passed with all baseline tasks already done; `npm run snapshots:verify` passed for `githubWorkflows@db5a917`, `repoTemplate@cd79b1c`, and `orgDefaults@fe48c2f`; `npm run update-ecosystem-overview` passed; `git diff --check` passed with CRLF normalization warnings only; `npm test` passed 581/583 with 2 skipped after rerunning with a longer timeout.
- **Propagation:** source fix landed in repo-template#114; archon-setup snapshot propagation in this lane; Pigafetta consumer propagation remains the next repo-local lane.
