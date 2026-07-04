# 2026-07-03 - #330 Self-apply full startup support baseline

- **Issue/PR:** #330 / pending
- **Branch:** `agent/codex/330-fix-agent-self-apply-full-startup`
- **Changed paths:** `scripts/agent-self-apply.mjs`, `test/agentSelfApply.test.mjs`, `test/agentLifecycleScripts.test.mjs`, `docs/agent-process/{document-policy,doc-health}.md`, `docs/repo-update-log/README.md`, `scripts/doc-health/**`, `.changelog/unreleased/302-*.md`, fragments.
- **What changed:** Root self-apply now owns the snapshot-derived startup support files that `.agent/startup-baseline.json` requires but archon-setup root could not repair: the document-policy charter, doc-health runner/spec, and repo-update-log fragment guide. The task stays scoped away from intentionally repo-specific root files such as `AGENTS.md`, `.agent/check-map.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `package.json`, and `docs/plans/README.md`.
- **Verification:** `node --test test\agentLifecycleScripts.test.mjs test\agentSelfApply.test.mjs` -> 10 pass / 0 fail. `npm run snapshots:verify` -> ok githubWorkflows @ 990cbca, repoTemplate @ 58aa9b8, orgDefaults @ fe48c2f. `npm run agent:self-apply -- --check` -> all seven self-apply tasks already-done. `npm test` -> 640 pass / 0 fail / 2 skipped.
- **Propagation:** none; this fixes archon-setup's root self-apply lane. Future snapshot refreshes will continue to carry upstream repo-template changes through the existing `refresh-snapshots` plus `agent:self-apply` flow.
