### Added

- Persist validated existing-repo onboarding dispositions in the setup
  manifest, including decision provenance, accepted-local fingerprints,
  durable capability declines, and reviewable deferrals.

### Changed

- Rehydrate owner dispositions during local and post-merge audit so stale local
  overrides and unresolved manual work remain actionable without treating
  matching accepted-local content as unmanaged drift.
