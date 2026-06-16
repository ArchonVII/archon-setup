### Added

- `foundation.agents` now distributes the document-policy charter: new repos get
  `docs/agent-process/document-policy.md` alongside `AGENTS.md` (document-policy
  spec §5.1, lane 1c). The `writeAgentsMd` task writes/checks/verifies it from the
  snapshot, frontmatter-tolerant like `docs/plans/README.md`, and the onboard audit
  reports it via a `markdown-frontmatter` comparison.
- `scripts/refresh-snapshots.mjs` now pulls three previously-unmirrored
  `repo-template` files its baseline already required:
  `docs/agent-process/document-policy.md` (lane 1b charter),
  `docs/agent-process/doc-health.md` (doc-health checker spec), and
  `docs/repo-update-log/README.md` (per-PR fragments front door). This makes the
  snapshot self-consistent with the `2026-06-15-document-policy` startup baseline.

### Changed

- Refreshed the `repo-template` snapshot to `13a9265` and the `.github`
  (org-defaults) snapshot to `fe48c2f` (lane 1a `STARTER.md` charter columns).
  The `repo-template` bump also catches up the rest of `repo-template`'s pending
  snapshot content (Librarian wiki front doors, doc-health runner, message-protocol,
  per-PR repo-update-log fragments, prompt-batch template). Regenerated
  `docs/ecosystem-overview.md` from the updated manifest. The `github-workflows`
  snapshot is **unchanged** (preserved at `ae00ba3`).
