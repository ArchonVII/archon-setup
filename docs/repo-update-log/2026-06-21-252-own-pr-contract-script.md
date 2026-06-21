# 2026-06-21 - Install pr-contract with close scripts

- **Issue/PR:** #252 / #276
- **Branch:** agent/claude/252-own-pr-contract-script
- **Changed paths:** `src/registry/features.json`, `src/server/tasks/writeAgentLifecycle.mjs`, `test/writeAgentLifecycle.test.mjs`, `docs/repo-update-log/2026-06-21-252-own-pr-contract-script.md`.
- **What changed:** `agent-lifecycle.baseline` now installs `scripts/pr-contract.mjs` before the close-scan scripts that import it, and the feature registry describes the additional copied file.
- **Verification:** `node --test test/writeAgentLifecycle.test.mjs` passed 12/12 including the new import-graph regression; `node --test "test/*.test.mjs"` passed 582/584 with 2 pre-existing skips.
- **Propagation:** none required in this lane; the repo-template snapshot already contains `scripts/pr-contract.mjs`.
