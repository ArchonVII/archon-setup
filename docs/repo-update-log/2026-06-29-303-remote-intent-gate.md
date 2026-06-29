# 2026-06-29 - #303 Remote intent gate

- **Changed paths:** `src/server/planner/buildPlan.mjs`, `test/registry.test.mjs`, `.changelog/unreleased/303-remote-intent-gate.md`, `docs/repo-update-log/2026-06-29-303-remote-intent-gate.md`.
- **What changed:** The planner's "Create GitHub repo" omission guard now triggers on a non-empty `plan.remoteMutations` set rather than on any `remoteRequirement`. A workflow-only local plan that carries a remote requirement but performs no remote mutations is no longer spuriously blocked, while real new-repo plans that intend remote mutations still receive the blocking warning.
- **Verification:** `test/registry.test.mjs` covers the gate firing on real remote intent and staying silent for workflow-only local plans. GitHub required checks pass on PR #309 (`repo-required-gate / node ci`, `pr contract`, `decision`, and the `check / check` repo-update-log gate). The fragment commit is docs-only.
