# 2026-07-10 - #348 Decisioned onboarding repair and merged verification

- **Issue:** #348
- **What changed:** Existing-repo onboarding now has a decision-gated CLI repair path. It emits a versioned decision document, optionally persists it in a GitHub issue, revalidates the current target/base SHA before any write, applies only `apply-central` items in a fresh default-branch worktree, and opens a draft PR. `verify-merged` audits a detached worktree at fetched `origin/<default>` and distinguishes fully onboarded, partial, and blocked outcomes. The lane does not auto-merge or modify branch protection.
- **Verification:** Focused onboarding repair tests cover decision generation/intake, stale decision rejection, issue serialization, worktree repair/draft PR creation, and merged default-branch audit. `npm test` passed 682 tests (680 pass, 0 fail, 2 skipped); `npm run snapshots:verify`, syntax checks, and `git diff --check` also passed.
