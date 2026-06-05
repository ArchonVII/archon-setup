# Changelog

## Unreleased

### Added

- Added a staged-disabled Copilot + repo-secrets capability (#92): `enableCopilot`
  (org-only, with a manual billing/policy checklist; personal accounts blocked)
  and `setRepoSecrets` (value piped to `gh secret set` via stdin only — never
  disk, argv, or logs; manifest records name + `wasSet`). Both ship
  `disabled: true` (v0.4 gate). A `redact.mjs` backstop masks accidental
  `gh secret set NAME VALUE` argv leaks. See `docs/SECURITY_MODEL.md`.
- Added the agent-lifecycle baseline (#64): the default `agent-lifecycle.baseline`
  feature installs the four `scripts/agent/*` worktree-lifecycle scripts and
  idempotently merges the three `agent:*` entries into the target `package.json`
  (minimal one created if absent; other keys preserved). Existing-repo audit
  gains an `entries` comparison reporting those entries present/missing/drifted.

- Added a thin Windows bootstrap `install.ps1` (#90): checks Node >= 20 + `gh`
  (with install guidance) then runs `npx @archonvii/archon-setup`; supports
  `-DryRun`. Ships in the package (`files[]` + tarball guard), with
  `docs/WINDOWS_INSTALL.md` and design-only winget/scoop stubs. Native
  installers remain deferred.

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
- Added workflow drift detection and upgrade: `archon-setup update --check`
  classifies each managed caller as current / drifted / unmanaged against the
  recorded snapshot (exits non-zero on drift), and `update --upgrade` rewrites
  drifted callers to the snapshot, re-injecting budget defaults. Both honor
  `--dry-run`; customizations beyond budget defaults are discarded on upgrade.
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

- Fixed agent-lifecycle drift repair after baseline install (#95): the
  `writeAgentLifecycle` `check()`/`verify()` paths now compare the four managed
  `scripts/agent/*` files against the repo-template snapshot by content (not just
  existence), and `apply()` overwrites a drifted managed script to repair it.
  Previously a present-but-drifted script reported `already-done`/`ok`, so an
  existing repo could retain stale lifecycle scripts while the install claimed
  success. New `checkAllMatch`/`verifyAllMatch` helpers back the comparison.
- Refreshed repo-template snapshots after Owner Maintenance Lane docs coverage
  expanded to add-only `docs/**` by default while preserving explicit unsafe
  docs paths; added the matching global update record.
- Fixed staged secret handling before Copilot activation (#96): `gh secret set`
  now reads the value from stdin by omitting `--body`, secret values are stripped
  from serialized plan/execution data and require a runtime-only provider, and
  `enableCopilot` is documented as manual-only until mutation semantics are
  proven.
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
- Refreshed the recorded `repo-template` provider SHA to 2295771 and updated the
  snapshotted `scripts/agent/prune.mjs` to the Windows-robust version, so the
  managed agent-lifecycle updater distributes the fixed prune to consumers
  (repo-template #41).
