# Changelog

## Unreleased

### Added

- Added a hermetic no-remote fresh-repo smoke test that exercises the full
  remote path (repo create + push + readiness poll) against a local bare repo
  via a `gh` mock, creating no real GitHub repo (#43). Backed by a `gh`/`git`
  binary-injection seam in the command runner and a
  `scripts/cleanup-smoketest-repos.mjs` remediation helper for the repos leaked
  before the policy landed.
- Added npm publication prep (#82): a `prepublishOnly` gate
  (`scripts/prepublish-check.mjs`) that runs tests + bin syntax checks before
  publish, a `test/packageManifest.test.mjs` guard on the published tarball
  contents, a manual-dispatch `publish.yml` workflow, and a README quickstart
  leading with `npx @archonvii/archon-setup`. Actual publish remains owner-gated
  (NPM_TOKEN + version bump).

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
