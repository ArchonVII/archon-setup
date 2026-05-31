# Changelog

## Unreleased

### Added

- Added global update records for shared agent/workflow fixes, starting with the
  2026-05-31 Browser backend preflight policy.
- Added a global update record for the strict PR ready-for-review contract that
  forbids direct `gh pr ready` and points agents to the shared contract wrapper.
- Added Ecosystem UI controls to dry-run or distribute a recorded global fix
  with an exact confirmation phrase and per-repo applied/skipped/failed results.
- Added persistent distribution run logging at
  `C:\Users\<you>\.codex\archon-setup\global-update-runs.jsonl`.
- Added ecosystem snapshot governance output for the four hub repos, separating
  classic branch protection from repository rulesets and marking unavailable API
  data as unknown.

### Changed

- Documented that agents must ask before disseminating global fixes across the
  ecosystem and must report explicit per-repo outcomes.
- Refreshed workflow, repo-template, and org-default snapshots for the strict
  PR contract rollout.
