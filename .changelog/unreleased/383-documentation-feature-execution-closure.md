### Fixed

- `foundation.doc-system` now installs an execution-closed documentation
  capability: its selection-aware doc map and seeds, all six provider-owned
  `scripts/docs/*.mjs` generators, selection-owned `docs:*` package commands, and
  the report-only doc-health dependency are selected, audited, repaired, and
  executed together.
- Selection validation now rejects dangling runtime imports and missing
  package-script callers before a generated consumer can receive a partial
  documentation surface. Documentation imports may be absent only when the
  owning `.agent/doc-map.yml` surface is not selected.
- Archon Setup self-apply now uses the same doc-system installer path as
  consumers and renders the root doc map from its recorded selected-feature
  contract instead of copying provider-only navigation.
