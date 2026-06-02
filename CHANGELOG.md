# Changelog

## Unreleased

### Added

- Added a best-effort `.archon/events.jsonl` event stream: `appendEvent` writes
  append-only `{ts,type,actor,ref,detail}` lines (never throwing into the task
  flow), the executor emits plan-start / task-applied / plan-end, and the
  ecosystem snapshot renders a "Recent events" section. See
  `docs/archon-events-convention.md`.

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
- Added browser wizard existing-repo mode with read-only audit results,
  explicit write confirmation, no-create workflow/label/protection targeting,
  execution result summaries, and AGENTS/CLAUDE plus required-gate handoff
  commands.
- Added repo-local `agent:close-preflight` and `agent:pr-ready` wrappers so
  archon-setup can follow its own strict PR-ready contract.
- Added repo-template snapshot coverage for reusable template-system artifacts
  and repo-owned PR readiness wrapper source files.
- Added repo-template snapshot coverage for the template library inventory
  document and root README link.

### Changed

- Documented that agents must ask before disseminating global fixes across the
  ecosystem and must report explicit per-repo outcomes.
- Refreshed workflow, repo-template, and org-default snapshots for the strict
  PR contract rollout.
- Refreshed the recorded `github-workflows@v1` provider SHA after the required
  gate disabled-input fix.
- Refreshed the recorded `repo-template` provider SHA after the strict PR-ready
  wrapper and centralized template-system baseline landed.
- Refreshed the recorded `repo-template` provider SHA after the template
  library inventory landed.
