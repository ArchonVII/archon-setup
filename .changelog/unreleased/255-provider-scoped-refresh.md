### Added

- `scripts/refresh-snapshots.mjs` now accepts `--only <provider>` to refresh a single
  snapshot provider (known keys/aliases only: `repo-template`, `github-workflows`,
  `.github`). Scoped runs validate only the selected source and **merge** the manifest,
  preserving the other providers' pins — so one provider can be refreshed without the
  others being perfectly positioned at their declared refs.

### Changed

- Refreshed the `repo-template` snapshot to its current `main`: adds the new
  project-capsules convention (`docs/agent-process/project-capsules.md`, `projects/`, and
  the AGENTS Start Map pointer) and catches up `repo-template`'s other pending snapshot
  content. Regenerated `docs/ecosystem-overview.md` from the updated manifest. The
  `github-workflows` and `.github` snapshots are unchanged.
