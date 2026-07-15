## fix(distribution): bind managed updates to the capability manifest

- Require global-update bodies and managed-region sources to cite valid feature IDs from `src/registry/features.json`.
- Replace the startup-baseline managed block's fixed path inventory with selection-derived capability guidance while preserving its existing region ID for in-place updates.
