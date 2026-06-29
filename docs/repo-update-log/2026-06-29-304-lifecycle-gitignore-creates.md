# 2026-06-29 - #304 Lifecycle gitignore creates

- **Changed paths:** `src/registry/features.json`, `test/registry.test.mjs`, `.changelog/unreleased/304-lifecycle-gitignore-creates.md`, `docs/repo-update-log/2026-06-29-304-lifecycle-gitignore-creates.md`.
- **What changed:** The `agent-lifecycle.baseline` feature now declares `requires: foundation.gitignore`, so the `.gitignore` write that lifecycle performs is represented in the resolved plan. This restores parity between `--dry-run`/plan output and the files actually created during onboarding, closing the gap where the gitignore creation was undeclared.
- **Verification:** `test/registry.test.mjs` covers the lifecycle→gitignore dependency and plan/creation parity. GitHub required checks pass on PR #308 (`repo-required-gate / node ci`, `pr contract`, `decision`, and the `check / check` repo-update-log gate). The fragment commit is docs-only.
