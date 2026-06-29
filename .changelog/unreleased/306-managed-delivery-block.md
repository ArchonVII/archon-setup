### Added

- Onboarding now emits a managed `delivery-workflow` block in `AGENTS.md` so
  every onboarded repo carries the cross-tool issue -> branch -> atomic-commit
  -> PR delivery contract in a re-syncable managed region, and `onboard
  --audit` flags its absence. The onboarding changelog default is now Mode 2
  (fragment-based) to match the shipped close guard. (#306, #291)
