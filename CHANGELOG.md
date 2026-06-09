# Changelog

## Unreleased

### Fixed

- The `ecosystem-overview.md` sync gate no longer false-fails on a Windows
  checkout (autocrlf → CRLF): `extractEcosystemMapBlock` is CRLF-aware and the
  comparison strips every `\r` rather than only `\r\n` pairs. Regression test
  added that exercises a CRLF document on any platform. (#151)

### Added

- Began the granular marker-based distributor (#145): a repo-owned-by-default
  capability that updates only ArchonVII-managed regions
  (`BEGIN`/`END ARCHONVII MANAGED: <id>` markers) and surfaces conflict/adoption
  instead of the `update --upgrade` clobber, which discards intentional repo
  customization. This first slice ships the pure layer — the region engine
  (`parse`/`replace`/`reconcile`, with legacy AGENTS marker support), the
  markdown/yaml/shell adapters (path-aware YAML duplicate-key detection), and the
  marker lint/manifest (`npm run lint:markers`). The `distribute` subcommand and
  provider markup follow. Design:
  `docs/superpowers/specs/2026-06-09-granular-distributor-design.md`.

### Changed

- Refreshed the `repo-template` snapshot to `main` commit `de95850`: agents no
  longer get an untracked `.pr-body.md` scratch file from `agent:start-task`
  (it dirtied worktrees and tripped close/preflight clean-tree gates). The
  snapshot now ships `scripts/agent/pr-body.mjs` and the `agent:pr-body` script,
  which print the issue-filled committed PR template to stdout for
  `gh pr create/edit --body-file -`. (#141, pairs with repo-template#59)

- Advanced the `github-workflows` snapshot to `v1` commit `c1ad03e`,
  adding the Go CI caller snapshot and refreshing the required-gate caller
  example with Go/polyglot options after the moving major tag was intentionally
  released. (#139)

- Corrected the snapshot manifest after a clean provider refresh so
  `githubWorkflows` records current `v1` (`b27979b`) and `orgDefaults` records
  `.github` `origin/main` (`1962f27`). Snapshot file bodies were unchanged.
  (#127)

- `refresh-snapshots` now preflights every existing provider checkout before
  deleting or copying snapshot directories. The script refuses dirty providers
  and refuses to label copied files as `v1`/`main` unless local `HEAD` matches
  the declared tag or fetched `origin/main`, preventing manifest SHAs from
  drifting away from the source ref they claim to describe. (#127)

- `onboard --audit` now uses the same CRLF/LF-normalized managed-file
  comparison as the apply/check path, so `audit.startupReadiness` does not mark
  LF-enforced consumer script files stale when the setup snapshot checkout is
  CRLF on Windows. (#135)

- Managed repo-template snapshot comparisons now normalize CRLF/LF line endings,
  and snapshot writes normalize to LF, so LF-enforced consumer repos do not
  report false stale doc-sweep or agent-lifecycle files when `archon-setup` is
  checked out on Windows. Scoped onboarding manifest writes now merge prior
  `selectedFeatures`, `createdFiles`, skipped files, remote actions, and
  post-check history instead of replacing it with only the current scoped run.
  (#133)

- Refreshed the `repo-template` snapshot to `6a8fda9`, adding the versioned
  startup baseline, plan README, startup-aware `agent:status`, managed AGENTS
  start map, and concrete agent lifecycle/doc-sweep startup file contract from
  the staged repo-template rollout. (#130)

- Dropped `package-lock.json` from the `repo-template` snapshot and from
  `refresh-snapshots.mjs` `copyFiles`. The template is depless (the lock locked zero
  packages) and removes it in `repo-template#52`; keeping it listed would make the next
  `refresh-snapshots` run fail by copying a nonexistent file. Added a root `.npmrc`
  (`package-lock=false`) as a depless-repo guard for archon-setup itself (local-dev only;
  not shipped). (#124)

- Refreshed the `repo-template` snapshot to `98c871b`, so the managed `.githooks`
  now carry the append-log ledger Owner Maintenance Lane (`repo-template#50`):
  `archon-setup update` propagates the lane (`.claude/noticed.md` and
  `.claude/napkin.md` addable/modifiable on `main`) instead of writing the stale
  hook and regressing it. (#110)

### Added

- `docs/ecosystem-overview.md` — canonical high-level map of the ArchonVII meta
  layer (org-default/workflow/template providers, the archon-setup integrator,
  and the `jma-skill-review` skill source), with change-routing and
  managed-content rules. The repo-inventory block is generated from
  `config/ecosystem-map.json` + live `src/snapshots/manifest.json` refs via
  `npm run update-ecosystem-overview`; `npm test` enforces it is in sync. The
  overview is meta-repo only and intentionally not snapshotted into consumer
  repos, preserving per-repo coordination-isolation. (#147)

- Added a coordinator-only Ecosystem Fix Queue in `docs/ecosystem-status.md`
  so small source-of-truth fixes can be reviewed and batched before a later
  `archon-setup` snapshot refresh instead of forcing one snapshot PR per small
  policy or provider-doc change. (#149)

- Added a canonical ecosystem repo registry for the Ecosystem snapshot/health
  surface. `src/server/ecosystem/repoRegistry.json` now defines the active set
  (`archon`, `archon-setup`, `github-workflows`, `repo-template`, `.github`,
  `pigafetta`, `jma-history`, `skills-review`, and `hudson-bend`) and marks
  `jma-ui` inactive; `ecosystem-state.json` now exposes both active repo health
  and the registry metadata. (#143)

- Added startup readiness auditing for `onboard --audit`: JSON output now
  includes `audit.startupReadiness` with a baseline version, missing, stale,
  misplaced, and legacy-path findings plus a warning-level repair command.
  The human audit output now explicitly distinguishes the full startup/process
  audit from the workflow-only `archon-setup update` path. The audit now checks
  concrete agent lifecycle/doc-sweep files and `package.json` `agent:*` entries,
  and treats repo-local YAML frontmatter on managed wiki docs as current when
  the baseline body matches. It also treats `.agent/startup-baseline.json` as an
  implicit required path and compares the contract body, so same-version contract
  drift reopens repair. (#130)
- Added a global update record for the agent startup baseline so the managed
  AGENTS distribution path can tell agents to use `AGENTS.md`, `agent:status`,
  `.agent/startup-baseline.json`, and `docs/plans/README.md` before searching
  for known process paths. (#130)
- Added the `agent-workflow.doc-sweep` feature (#103, locked default): every
  onboarded repo gets the doc-sweep runner (`scripts/doc-sweep/{lib,git,sweep}.mjs`)
  and full spec (`docs/agent-process/doc-sweep.md`) via the new `writeDocSweep` task,
  with self-contained content-aware drift repair. Repairs preserve repo-local
  YAML frontmatter on the markdown spec. The `## Doc Sweep-Up` AGENTS.md
  contract ships with the agent foundations.
- Added the `agent-workflow.doc-orphan-detector` opt-in (#103): a weekly cron caller
  to `github-workflows/doc-orphan-detector.yml@v1` (doc-sweep §4.7) that opens a
  tracking issue for committed docs stranded on stale, PR-less branches. Detection
  only; pairs with the locked doc-sweep runner that recovers them.

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
