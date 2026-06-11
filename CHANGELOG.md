# Changelog

## Unreleased

### Added

- `archon-setup` now dogfoods the remaining foundation baseline it installs for
  consumers: managed `.githooks`, the actionlint caller, CODEOWNERS,
  Dependabot, and `.changelog/unreleased/README.md`, all written through
  `bin/onboard.mjs` rather than hand-copied files. The PR also advances the
  repo-template snapshot to the merged onboarding residual cleanup from
  repo-template#69; github-workflows remains pinned to its declared `v1` tag.
  (#202)

- `refresh-snapshots` now proves each existing snapshot still matches its
  provider at the manifest-pinned SHA before overwriting anything
  (EOL-tolerant, otherwise byte-exact). On mismatch it refuses with a per-file
  report and proceeds only with an explicit `--accept-snapshot-divergence`;
  `npm run snapshots:verify` runs the same check read-only. A hand-edited
  snapshot (the #197 failure mode) now surfaces loudly instead of being
  silently clobbered. (#200)

- `npm run agent:self-apply` installs/repairs archon-setup's own root agent
  baseline (`scripts/agent/*`, `scripts/doc-sweep/*`,
  `.agent/startup-baseline.json`, the `agent:*` package scripts) from the
  repo-template snapshot through the same installer code paths consumers get —
  the hand-copy step #197 relied on is gone. `--check` reports drift read-only;
  the update flow is provider PR → `refresh-snapshots` → `agent:self-apply` →
  commit, audited by the root↔snapshot parity test. (#201)

### Fixed

- The repo-template snapshot is reconverged with its manifest pin: the five
  #197 review fixes now come from the provider (repo-template#67) instead of
  the hand-edits #199 flagged, and the pin advanced `292dada` → `d74d23c` with
  a null body diff for the three files the provider had not otherwise touched
  (the reconvergence proof). The refreshed snapshot — and the root lifecycle
  copies synced from it — also inherit repo-template#65's merged-PR-proof
  `agent:prune` retirement and the `agent:status` claims check now resolving
  against the current worktree instead of the primary checkout. (#199)

- The `agent-lifecycle.baseline` installer/audit path now includes
  `scripts/agent/pr-body.mjs` and the `agent:pr-body` package script, matching
  the current repo-template lifecycle command surface instead of silently
  installing only the older `start-task`/`status`/`prune` set. (#196)

- The `archon-setup` root checkout now carries the startup/process baseline it
  tells consumers to use: managed AGENTS start map, `.agent` startup files, PR
  template, lifecycle scripts, doc-sweep runner, root `agent:*` npm scripts, and
  a repo-specific update log. (#196)

- Lifecycle/doc-sweep script review fixes, applied to the root copies and the
  repo-template snapshot in lockstep (#196): the startup baseline now requires
  `scripts/agent/pr-body.mjs` so a missing pr-body tool fails the readiness
  audit; `agent:status` detects claims at `.agent/coordination/claims/` per the
  coordination contract (not a nonexistent `.agent/claims.json`); the
  `--git-common-dir` root derivation in `agent:status`/`agent:prune` tolerates
  Windows backslash paths via a shared `primaryRootFromCommonDir` helper; and
  the doc-sweep lock-held early return strips internal TOCTOU metadata so its
  item shape matches the normal path. A regression test also pins the root
  scripts byte-identical to their snapshot twins.

- `cleanupRun` now refuses from rollback-chain states before any destructive
  work, so `rollback_requested`, `rollback_pr_created`, `rollback_merged`, and
  `rollback_verified` can no longer delete worktrees or branches and then fail
  on an illegal `aborted` ledger append. (#193)

- PR-lane evidence artifacts are now truthful and contract-valid (#187):
  `RunReport.results` buckets derive from the ledger's reached state instead of
  being synthesized from the plan (failed-preflight runs report `applied: []`;
  keep-local ownership records report as skipped); generated forward and
  rollback PR bodies pass the repo-template's own PR contract with fenced
  `evidence` blocks carrying real run facts (runId, baseSha, decision-doc
  fingerprint, item set, run ledger path), enforced by a unit test importing
  `validatePrContract` from the snapshot; `runUpdate` recomputes
  `expectedFileSha256`/`expectedRegionInnerSha256` per item inside the
  execution worktree before any write (null-tolerant for create-file) and
  refuses stale ApplySets with a per-item reason. New
  `docs/authority-model.md` states the trust anchor (the `gh` token, not the
  derivable confirmation phrase), and the `.archon/` tracking policy is
  documented in `ecosystem-overview.md`.

- PR-lane rollback and cleanup lifecycle gaps (#186): manual merges of runs
  held at `checks_pending`/`pr_created` are now legal transitions and
  post-merge verifiable (ledger-stamped `mergedBy:"manual"`); `verify-merged`
  resolves the merge SHA from the PR's merge commit and records an explicit
  `mergeShaSource:"assumed-origin-head"` fallback instead of silently trusting
  the origin head; `cleanup` refuses from `merge_queued`/`merged` before
  deleting anything and closes unmerged PRs through the default gh runner (the
  CLI previously skipped PR closure entirely); rollback re-entry verifies a
  merged revert PR through `rollback_merged` → `rollback_verified`, and
  rollback conflict/tree-mismatch failures remove and record the unpushed
  rollback worktree and branch.

- The `ecosystem-overview.md` sync gate no longer false-fails on a Windows
  checkout (autocrlf → CRLF): `extractEcosystemMapBlock` is CRLF-aware and the
  comparison strips every `\r` rather than only `\r\n` pairs. Regression test
  added that exercises a CRLF document on any platform. (#151)

### Added

- Added a read-only `skill-selection` provenance contract (#188) with schema
  fixtures, a zero-dependency validator path, LF-normalized `SKILL.md` hashing,
  first-class `noRelevantSkill` / `repo-dirty` / `catalog-unreadable` /
  `repo-missing` outcomes, and an optional `runUpdate` planned-ledger field.
  Runtime validation rejects missing commits for non-`repo-missing` discoveries,
  mismatched failure fallbacks, and blank `whySelected` rationales. The contract
  records evidence only; it does not install, promote, or mutate skills.

- Global update record `2026-06-10-plan-status-closeout`, so existing repos can
  receive a confirmation-gated AGENTS.md block requiring agents to close,
  narrow, or supersede lane-created or lane-used plan/status artifacts before
  PR ready/merge. (#182)

- The M6 single-repo e2e gate (#163): a hermetic test now composes refresh,
  DecisionDoc resolution, intake, PR-lane execution, local-bare-origin merge,
  post-merge verification, cleanup, and the second-run no-op path. Intake now
  carries source issue numbers into ApplySets for PR execution, and refresh
  honors `.archon/region-ownership.json` keep-local records so later audits do
  not keep recommending owned local items.

- PR-lane rollback and post-merge closeout (#160, M4): `verify-merged --run`
  audits the recorded merge commit in a detached disposable worktree and
  requires all applied items to be `clean_apply changed:false`; `cleanup --run`
  idempotently removes recorded worktrees and branches; `rollback --run|--last`
  opens a safe revert PR without mutating `main`, auto-detecting squash versus
  merge commits and stopping for manual review on same-region collisions.
  Already-reverted affected paths are detected and recorded as
  `rollback_verified` without opening a duplicate PR. Run records now carry the
  original `ApplySet` context needed for later verification and rollback.

- The PR lane (#159, M3): `refresh --intake <doc.json|issue:#N> --execute
  --confirm "<phrase>"` now consumes the M2 `ApplySet`, creates a disposable
  branch/worktree from `origin/<default>`, applies allowed managed-region
  changes outside the source checkout, verifies with a post-apply audit, records
  JSONL run states, and supports `--local-only`, `--pr-only`/`--no-automerge`,
  and default auto mode. Auto mode gates `gh pr merge --auto` behind the
  confirmation hash, resolved-item/path/category allowlists, the
  `automated-distribution` label, decision-doc/issue PR-body evidence, required
  checks passing, and a clean post-apply audit. (#159)

- The decision flow (#158, M2): `refresh --report` renders a self-contained
  HTML decision face (canonical JSON embedded byte-equal; oversized diffs
  truncate in the face only; submit affordance renders only with a live
  nonce); `refresh --save-issue` ships the same canonical JSON to a GitHub
  issue in a dedicated ` ```archon-decision-doc ` fence with supersession
  comments on older open decision issues; `refresh --intake <doc.json|issue:#N>
  [--allow-partial]` re-validates a completed doc against the live target
  (schema, repo identity, base SHA, LF-normalized file/region fingerprints,
  fresh reconcile) and emits the schema-valid `ApplySet` plus the two-layer
  confirmation summary the M3 PR lane will consume. Evidence diffs are
  redacted via `redact.mjs`; conflicts resolved as anything but defer require
  a rationale; malformed or ambiguous issue JSON never executes. (#158)

- The `refresh` subcommand (#157, M1): read-only single-repo ecosystem audit.
  `refresh --target <path> [--json]` reconciles ArchonVII-managed regions in
  the new distributor `audit` mode (write-safety gates don't apply — a repo
  sitting clean on `main`, the normal consumer state, is auditable; read-trust
  gates still skip unreadable targets) and emits a schema-valid
  `RepoRefreshReport`: every finding carries its raw reconcile status, the
  `Operation` projection through the M0.5 golden mapping, the server-computed
  diff for drifted regions, and a deterministic recommendation
  (conflicts always `recommended: null`). Exit codes `0/10/20/1` mirror
  `distribute` (A6). The engine validates its own output against the M0.5
  schema before returning. (#157)

- M0.5 contract fixtures (#156): JSON Schemas for the e2e refresh seams
  (`RepoRefreshReport`, `DecisionDoc`, `ApplySet`, PR-lane `RunReport`) under
  `src/contracts/schemas/`, validated by a zero-dependency fail-closed subset
  validator (`src/contracts/validate.mjs`). The PR-lane run state machine
  (`src/contracts/run-states.json`) and the operation-mapping golden table
  (`src/contracts/operation-mapping.json` + runtime accessor) pin every raw
  AGENTS-group distributor state to exactly one `Operation` action, and golden
  valid/invalid documents live under `test/fixtures/contracts/` so the M2
  decision-doc and M3 PR-lane milestones can build in parallel against the
  same contracts. (#156)

- The `distribute` subcommand (#145 PR2, #155): repo-owned-by-default
  reconciliation of ArchonVII-managed regions across consumer repos. Dry-run by
  default (writes nothing; exit 10 signals pending changes), `--apply` writes
  only `clean_apply` files atomically with exec bit/shebang/EOL preserved,
  `--write-preview` emits adoption proposals under `.archon/distribute-preview/`,
  `--all --apply` is gated by a scope-bound confirmation phrase, and every run
  appends a JSONL log outside consumer worktrees
  (`~/.claude/archon-distribute-log.jsonl`). Exit codes `0/10/20/1` are stable
  for automation. `distributeGlobalUpdate` now delegates through the same
  engine with byte-compatible results; a malformed or catalog-orphaned AGENTS
  block now surfaces as `failed/managed-region-conflict` instead of being
  silently bypassed. (#155)

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

- Recorded the e2e ecosystem-management roadmap and the auto-merge
  distribution-lane decision for owner-initiated mechanical distribution PRs:
  eligibility is machine-gated by explicit scope confirmation, resolved
  decision items, category/path allowlists, `automated-distribution` labeling,
  decision-doc/issue links, and a clean post-apply audit. Agent code PRs remain
  on the normal reviewed close path. (#154)

- Advanced the `github-workflows` snapshot to `v1` commit `dc64da5`, carrying the
  required-gate caller fix that stops arbitrary PR label changes such as
  `no-changelog` from rerunning and canceling the stable branch-protection gate.
  `archon-setup update` now also applies that trigger-only repair to customized
  managed callers without replacing their repo-specific `with:` inputs. (#168,
  pairs with github-workflows#57/#58)

- Advanced the `github-workflows` snapshot again to `v1` commit `62d3f86`,
  preserving the `ci:full` force-full label as the only label change that can
  run or cancel the required gate. Other label changes skip the guarded caller
  path instead of replacing the stable `repo-required-gate / decision` result.
  `archon-setup update` repairs customized required-gate callers to this guarded
  trigger pattern while preserving repo-specific `with:` inputs. (#170, pairs
  with github-workflows#59/#60)

- Advanced the `github-workflows` snapshot again to `v1` commit `af0ac6e`,
  moving skipped non-`ci:full` label-only workflow runs into a separate
  `label-skip-*` concurrency group so they cannot replace pending real
  required-gate runs. `archon-setup update` repairs customized required-gate
  callers to the isolated concurrency pattern while preserving repo-specific
  `with:` inputs. (#172, pairs with github-workflows#61/#62)

- Refreshed the `repo-template` snapshot to `main` commit `292dada`, carrying
  the default plan/status artifact closeout rule in `AGENTS.md` and the PR
  template prompt that asks authors to record closed, narrowed,
  deprecated/superseded, or not-applicable status. (#182, pairs with
  repo-template#62/#63)

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
