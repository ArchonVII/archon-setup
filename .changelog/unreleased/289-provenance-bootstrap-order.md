### Fixed

- Headless onboarding now commits its provenance artifacts (onboarding manifest
  and CODEOWNERS) as a sanctioned final bootstrap step so a fresh onboard ends
  with a clean working tree, and the onboarded `.gitignore` now ignores
  `.archon/events.jsonl` and `.agent/bypass.log`. (#289)
