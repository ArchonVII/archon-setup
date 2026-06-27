# 2026-06-21 - Close-scan marker gitignore onboarding fix

- **Issue/PR:** #253 / #273
- **Branch:** agent/claude/253-close-scan-gitignore
- **Changed paths:** `.gitignore`, `src/server/tasks/writeAgentLifecycle.mjs`, `test/writeAgentLifecycleGitignore.test.mjs`, `docs/repo-update-log/2026-06-21-253-close-scan-gitignore.md`.
- **What changed:** The `agent-lifecycle.baseline` onboarding task now idempotently adds `.agent/close-scan/` to generated repo `.gitignore` files and reopens apply/verify when the marker ignore rule is missing. The source repo also self-ignores the generated close-scan marker directory.
- **Verification:** `node --test test/writeAgentLifecycleGitignore.test.mjs` passed 5/5, and `node --test "test/*.test.mjs"` passed 586/588 with 2 pre-existing skips.
- **Propagation:** none required for this lane; generated repos receive the rule on the next onboard/self-apply run.
