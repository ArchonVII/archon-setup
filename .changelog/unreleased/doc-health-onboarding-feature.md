### Added

- New locked-default `agent-workflow.doc-health` feature installs the report-only
  doc-health runner (`scripts/doc-health/{lib,health}.mjs`,
  `docs/agent-process/doc-health.md`) from the `repo-template` snapshot, mirroring
  `agent-workflow.doc-sweep`. The new `writeDocHealth` task writes/checks/verifies
  these files content-aware (drift-repairing), and the onboard audit reports the
  spec via a `markdown-frontmatter` comparison.
- `foundation.agents` now also distributes `docs/repo-update-log/README.md` (the
  per-PR fragments front door that supersedes the frozen `docs/repo-update-log.md`
  archive). `writeAgentsMd` writes/checks/verifies it from the snapshot,
  frontmatter-tolerant like `docs/plans/README.md`.

### Fixed

- A fresh onboard now satisfies the `2026-06-15-document-policy` startup baseline
  with no manual patching. The baseline's `required` list already named
  `scripts/doc-health/{lib,health}.mjs`, `docs/agent-process/doc-health.md`, and
  `docs/repo-update-log/README.md` (and their directories), but no feature
  generated them, so every onboarded repo reported startup readiness "incomplete"
  until a human hand-copied the files from the snapshot. The onboard audit now
  detects drift in these files as `stale` rather than silently passing.
