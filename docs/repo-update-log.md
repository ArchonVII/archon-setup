# Repository Update Log

This log records agent-visible repository changes that should be easy to audit
later. It complements `CHANGELOG.md`: the changelog is user-facing release
history, while this file is the operational ledger for startup, process, and
repository-policy changes in `archon-setup`.

## Entry Template

```markdown
## YYYY-MM-DD - <short title>

- **Issue/PR:** #issue / #pr
- **Branch:** agent/<tool>/<issue>-<slug>
- **Changed paths:** path, path
- **What changed:** One or two sentences.
- **Verification:** Exact commands/results, or docs-only rationale.
- **Propagation:** none | pending <repo/path> | completed <repo/path>
```

## 2026-07-09 - Anomaly-triage caller permission propagation

- **Issue/PR:** #342 / pending
- **Branch:** agent/codex/342-anomaly-triage-write-permissions
- **Changed paths:** `.github/workflows/anomaly-triage.yml`, `.github/workflows/repo-update-log-fragment.yml` (removed), `scripts/refresh-snapshots.mjs`, `scripts/agent-self-apply.mjs`, `src/registry/features.json`, `src/server/{onboard,tasks}/**`, `src/updater/updateManagedFiles.mjs`, `src/snapshots/**`, `test/**`, `README.md`, `docs/agent-process/**`, `docs/ecosystem-overview.md`
- **What changed:** Refreshed the `githubWorkflows` snapshot from `990cbca` to `e6ef54c` and `repoTemplate` from `58aa9b8` to `32dd578`, self-applied the least-privilege anomaly-triage caller permissions, and aligned onboarding with the template's S3 retirement of per-PR changelog/repo-update-log fragments. The normal updater now replaces only the anomaly caller's top-level permission block, preserving bespoke job inputs and secrets while removing widened scopes. The obsolete root repo-update-log caller was removed because its reusable workflow no longer exists at `github-workflows@v1`; its old feature ID remains a disabled no-op for manifest compatibility.
- **Verification:** TDD proved the root and both snapshot callers failed the exact permission contract before refresh (0/3) and passed after refresh (3/3); updater preservation/idempotency was red at 9/10 then green at 10/10. `npm run agent:self-apply -- --check` reported all six tasks already done; the focused integration set passed 127/127; the final `npm test` passed 671 with 2 platform skips; `npm run snapshots:verify` passed for all three providers; `node scripts/update-ecosystem-overview.mjs --check` passed; scoped `actionlint` passed for the root and both snapshotted anomaly callers.
- **Propagation:** pending consumer updater lanes for opted-in anomaly-triage callers; already-correct or non-opted-in repositories remain unchanged.

## 2026-06-20 - Repo-update-log fragment guard snapshot refresh

- **Issue/PR:** #270 / #271
- **Branch:** agent/codex/270-repo-update-log-fragment-snapshots
- **Changed paths:** scripts/refresh-snapshots.mjs, scripts/agent-self-apply.mjs, src/registry/features.json, test/refreshSnapshots.test.mjs, test/agentSelfApply.test.mjs, test/registry.test.mjs, test/onboardHeadless.test.mjs, test/onboardAudit.test.mjs, .github/workflows/repo-update-log-fragment.yml, .agent/startup-baseline.json, scripts/close/**, src/snapshots/manifest.json, src/snapshots/github-workflows/**, src/snapshots/repo-template/**, README.md, CHANGELOG.md, docs/ecosystem-overview.md, docs/ecosystem-status.md, docs/repo-update-log.md
- **What changed:** Refreshed the `githubWorkflows` snapshot from `ae00ba3` to `db5a917` after the reusable repo-update-log fragment guard landed and `v1` moved, and refreshed the `repoTemplate` snapshot from `13a9265` to `98a08fa` after the template caller/local close-scan guard landed. The self-apply path now repairs the root `repo-update-log-fragment.yml` caller from the snapshot, matching the refreshed startup baseline, and the registry now exposes it as a locked default local onboarding feature so generated repos receive the required caller.
- **Verification:** `npm run snapshots:verify` passed (`githubWorkflows@db5a917`, `repoTemplate@98a08fa`, `orgDefaults@fe48c2f`); `npm run agent:self-apply -- --check` reported all five tasks already done; `actionlint .github/workflows/repo-update-log-fragment.yml` passed; `node --check` passed for `scripts/refresh-snapshots.mjs`, `scripts/agent-self-apply.mjs`, `scripts/close/lib.mjs`, `scripts/close/scan-complete.mjs`, and `src/registry/features.json`; `node --test test/refreshSnapshots.test.mjs test/agentSelfApply.test.mjs test/agentLifecycleScripts.test.mjs test/prLanePrBodyContract.test.mjs test/packageManifest.test.mjs test/registry.test.mjs test/onboardHeadless.test.mjs test/onboardAudit.test.mjs` passed 86/86; `npm test` passed 581 with 2 skipped; `git diff --check` passed with Windows LF-to-CRLF warnings only. TDD checkpoints covered `node --test test/refreshSnapshots.test.mjs` (17/17 after the copy-list fix), `node --test test/agentSelfApply.test.mjs` (4/4 after adding the self-apply task), and `node --test test/registry.test.mjs test/onboardHeadless.test.mjs test/onboardAudit.test.mjs` red (3 expected failures for the missing feature) then green (53/53 after registry wiring).
- **Propagation:** completed for archon-setup snapshots/root baseline; Hudson Bend consumer wiring remains the next repo-local lane.

## 2026-06-15 - Document-policy snapshot refresh + foundation.agents wiring (lane 1c)

- **Issue/PR:** #225 / (this PR) — also closes ArchonVII/github-workflows#63
- **Branch:** agent/claude/225-snapshot-refresh-foundation-agents
- **Changed paths:** scripts/refresh-snapshots.mjs, src/registry/features.json, src/server/tasks/writeAgentsMd.mjs, src/server/onboard/auditPlan.mjs, src/snapshots/manifest.json, src/snapshots/org-defaults/STARTER.md, src/snapshots/repo-template/**, .agent/startup-baseline.json + scripts/agent/** + scripts/close/** + package.json (root twins re-synced via `npm run agent:self-apply`), docs/ecosystem-overview.md, test/{writeAgentsMd,manifestAccuracy,onboardAudit}.test.mjs, .changelog/unreleased/225-document-policy-snapshot-wiring.md, docs/repo-update-log.md
- **What changed:** Integrator leg of the document-policy rollout (epic #223, spec §5.1). Scoped refresh (`--only repo-template,.github`) bumped repoTemplate `6d64ca2`→`13a9265` and orgDefaults `3187457`→`fe48c2f` (lane 1a STARTER.md charter columns), preserving the `github-workflows` snapshot byte-for-byte (`ae00ba3`). `foundation.agents` `creates` now distributes `docs/agent-process/document-policy.md` via the `writeAgentsMd` task (frontmatter-tolerant, audited by `markdown-frontmatter`). The refresh `copyFiles` list also gained `docs/agent-process/doc-health.md` and `docs/repo-update-log/README.md` so the snapshot is self-consistent with the new `2026-06-15-document-policy` startup baseline it now ships.
- **Verification:** `npm run snapshots:verify` ok for all three (githubWorkflows @ ae00ba3 18 files; repoTemplate @ 13a9265 114 files; orgDefaults @ fe48c2f 1 file); refresh scope line `refreshed repoTemplate, orgDefaults; preserved githubWorkflows`; idempotent re-run produced a byte-identical working-tree (only the manifest `capturedAt` re-stamps, by design); `node --test --test-concurrency=1 "test/*.test.mjs"` passed 579/579 (2 skipped). Note: the default parallel `npm test` intermittently trips a rotating subset of the git-subprocess lifecycle tests (`prLaneRollback`, `smokeFreshRepo`) under concurrency — all 22 pass in isolation; pre-existing flake, logged to `.claude/noticed.md`.
- **Propagation:** none in this PR (repo-local snapshot + wiring); consumer distribution flows on the next `archon-setup` snapshot/publish per the rollout sequence.

## 2026-06-15 - Friction ledger self-apply wiring

- **Issue/PR:** #238 / #264
- **Branch:** agent/claude/238-friction-self-apply
- **Changed paths:** .gitignore, .githooks/scripts/owner-maintenance.sh, .githooks/pre-commit, .githooks/commit-msg, .claude/friction.md, docs/repo-update-log.md
- **What changed:** Self-applied the friction-ledger mechanism (AGENTS.md already carried the instruction): `.gitignore` exception so `.claude/friction.md` is trackable, the ledger added to the owner-maintenance direct-main allowlist (hook case + pre-commit/commit-msg help text), and the seeded ledger. Surgical — no broad hook re-sync, no snapshot pin bump. Part of the OS Stage 1 friction-telemetry rollout (#238); sibling: ArchonVII/github-workflows#79.
- **Verification:** `node --test test/agentLifecycleScripts.test.mjs test/agentSelfApply.test.mjs test/onboardAudit.test.mjs` 17/17 (no live-hook/snapshot identity is enforced, so the friction-only hook edit is clean); `bash -n` clean on the three edited hooks.
- **Propagation:** none (repo-local self-apply wiring; existing-repo rollout tracked on #238).

## 2026-06-14 - Provider-scoped snapshot refresh + repo-template L1a'

- **Issue/PR:** #255 / (pending)
- **Branch:** agent/claude/255-provider-scoped-refresh
- **Changed paths:** scripts/refresh-snapshots.mjs, test/refreshSnapshots.test.mjs, scripts/close/scan-complete.mjs (root twin re-synced via `npm run agent:self-apply`), src/snapshots/repo-template/**, src/snapshots/manifest.json, docs/ecosystem-overview.md, .changelog/unreleased/255-provider-scoped-refresh.md, docs/repo-update-log.md
- **What changed:** Added `--only <provider>` to `refresh-snapshots.mjs` (scoped validation + manifest-merge so unselected providers' pins survive), then refreshed **only** the `repo-template` snapshot to current `main`. Propagates the project-capsules convention v1 (ArchonVII/repo-template#87, lane L1a') plus repo-template's other pending snapshot drift (#84 close-scan, dependabot, changelog README). Regenerated `docs/ecosystem-overview.md` to match the updated manifest.
- **Verification:** `node --test test/refreshSnapshots.test.mjs` 17/17 (incl. 2 new: provider-key resolution; scoped refresh preserves other pins + ignores an off-ref provider). `node scripts/refresh-snapshots.mjs --verify` → all three `ok` (repoTemplate@6d64ca2, githubWorkflows@ae00ba3, orgDefaults@3187457). Full `node --test test/*.test.mjs` = 573 pass / 6 fail, where the 6 are identical to the pre-change baseline (Windows-CRLF byte-identical/startup tests + gh/git integration tests; green on CI/LF).
- **Propagation:** completed — repo-template snapshot now at `main`. `github-workflows`/`.github` snapshots intentionally untouched (their pins preserved).

- **Issue/PR:** #232 / pending
- **Branch:** agent/codex/232-chore-snapshots-refresh-provider-snapshots-once
- **Changed paths:** AGENTS.md, CHANGELOG.md, docs/CURRENT_WORK.md, docs/ecosystem-overview.md, docs/ecosystem-status.md, docs/repo-update-log.md, .agent/startup-baseline.json, .github/workflows/anomaly-triage.yml, package.json, scripts/agent-self-apply.mjs, scripts/agent/**, scripts/close/**, scripts/doc-sweep/**, scripts/refresh-snapshots.mjs, src/registry/features.json, src/server/onboard/auditPlan.mjs, src/server/tasks/writeAgentLifecycle.mjs, src/server/tasks/writeGithooks.mjs, src/snapshots/manifest.json, src/snapshots/repo-template/**, test/**
- **What changed:** Refreshed the `repoTemplate` snapshot from `1a729fd3dc0ffb00fea464291d2038a56817d4cc` to `78531751357787eeb28fe9a96f5a48c2faaa446c`, carrying repo-template PRs #80/#79/#81/#82/#83 for issues #75/#76/#77/#28/#78 in one pass. Expanded the repo-template snapshot allowlist to include `.github/workflows/anomaly-triage.yml` because the refreshed startup baseline requires it, extended the lifecycle installer/self-apply path to carry `scripts/close/*` and `close:*` package scripts, made anomaly triage a locked default runtime caller, and updated the root managed start map/status docs. The second refresh used `--accept-snapshot-divergence` only to recapture the now-expected anomaly workflow file that the previous allowlist omitted.
- **Verification:** `npm run snapshots:verify` passed for githubWorkflows @ `af0ac6e` (18 files), repoTemplate @ `7853175` (85 files), and orgDefaults @ `1962f27` (1 file). `npm run agent:self-apply -- --check` reported already-done for `agent-lifecycle`, `doc-sweep`, `anomaly-triage-workflow`, and `startup-baseline`. `npm test` passed 566 tests (564 pass, 2 skipped). `git diff --check` passed with Windows LF-to-CRLF normalization warnings only. `node bin\onboard.mjs C:\GitHub\archon-setup-232-chore-snapshots-refresh-provider-snapshots-once --audit --json` passed with startupReadiness `warning`, no missing/stale startup paths, and only the intentional `docs/superpowers/plans/` legacy archive warning.
- **Propagation:** completed `repo-template` provider snapshot refresh for the merged Stage 0/1 batch; no fleet distribution in this lane.

## 2026-06-11 - Foundation self-onboard

- **Issue/PR:** #202 / pending
- **Branch:** agent/codex/202-chore-onboard-complete-archon-setup-s
- **Changed paths:** .githooks/**, .github/workflows/actionlint.yml, .github/CODEOWNERS, .github/dependabot.yml, .github/archon-setup.json, .changelog/unreleased/README.md, .gitignore, CHANGELOG.md, docs/repo-update-log.md, src/server/tasks/writeGithooks.mjs, test/foundationParity.test.mjs, src/snapshots/manifest.json, src/snapshots/repo-template/.github/CODEOWNERS, src/snapshots/repo-template/docs/repo-update-log.md
- **What changed:** Ran `node bin/onboard.mjs C:\GitHub\archon-setup-202-chore-onboard-complete-archon-setup-s --owner ArchonVII --repo archon-setup` from the issue worktree to install the remaining foundation surface through the repo's own installer path: githooks, the actionlint caller, CODEOWNERS, Dependabot, and the changelog-fragment README. After repo-template#69 merged, refreshed snapshots so the repoTemplate pin advanced to `1a729fd3dc0ffb00fea464291d2038a56817d4cc`; githubWorkflows remains pinned to declared tag `v1` at `af0ac6e99683c107d5a420607642ff341e92713e` until an intentional workflow release/tag movement. Addressed PR review feedback by committing root `.githooks/**` files as executable and teaching `writeGithooks` to chmod installed hooks/scripts to `0755` for generated repos. Remaining audit drift is intentional: README.md is product documentation; AGENTS.md is the repo-specific agent contract; docs/repo-update-log.md is the operational ledger; .gitattributes keeps the Windows PowerShell EOL rule; CHANGELOG.md is accumulated release history; .github/PULL_REQUEST_TEMPLATE.md carries archon-setup's evidence-block contract; .agent/check-map.yml records this repo's node gate; and `docs/superpowers/plans/` remains a history-only legacy archive.
- **Verification:** `npm test` passed 499 tests (497 pass, 2 skipped). `npm run snapshots:verify` passed for githubWorkflows @ af0ac6e, repoTemplate @ 1a729fd, and orgDefaults @ 1962f27. `npm run agent:self-apply -- --check` reported already-done for agent lifecycle, doc-sweep, and startup baseline. `node bin\onboard.mjs C:\GitHub\archon-setup-202-chore-onboard-complete-archon-setup-s --audit --json` reported 29 present / 0 missing / 7 drifted, with the remaining drift adjudicated above. `C:\Program Files\Git\bin\bash.exe .githooks/scripts/install-githooks.sh`, `test-owner-maintenance.sh`, `test-checkout-role.sh`, and `bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed. `C:\Users\josep\go\bin\actionlint.exe .github/workflows/actionlint.yml` and `git diff --check` passed.
- **Propagation:** repo-template#69 merged and snapshotted; github-workflows#67 merged, with snapshot propagation pending an intentional `v1` tag update/release.

## 2026-06-11 - Self-applied root baseline via the installer

- **Issue/PR:** #201 / #205
- **Branch:** agent/claude/201-self-apply-baseline
- **Changed paths:** scripts/agent-self-apply.mjs, package.json, test/agentSelfApply.test.mjs, test/agentLifecycleScripts.test.mjs, AGENTS.md, CHANGELOG.md, docs/repo-update-log.md
- **What changed:** New `npm run agent:self-apply` (CLI `--check` for a read-only drift report, exit 1 on drift) repairs the root agent baseline from the repo-template snapshot via the existing installer task modules — `writeAgentLifecycle` (five lifecycle scripts + `agent:*` package-script merge), `writeDocSweep` (three doc-sweep scripts + spec), and the startup baseline via the shared `writeSnapshotFile`/`checkAllMatch` primitives. AGENTS.md now documents the end-to-end flow (provider PR → `refresh-snapshots` → `agent:self-apply` → commit) and prohibits hand-edits to `src/snapshots/**` and the root copies; the parity test's guidance message points at the mechanism instead of "fix both in lockstep".
- **Verification:** `node --test test/agentSelfApply.test.mjs test/agentLifecycleScripts.test.mjs` passed 9/9 (fresh install matches snapshot bodies; second run already-done with byte-identical files; drifted copies repaired; `--check` reports without writing); real-root `npm run agent:self-apply -- --check` and apply both report already-done ×3 with a clean tree (the idempotent no-op acceptance proof); full `node --test "test/*.test.mjs"` green.
- **Propagation:** none (repo-local mechanism); unblocks onboarding lanes #202 / repo-template#68 / github-workflows#38 to use the same installer paths.

## 2026-06-11 - Snapshot integrity gate at the refresh seam

- **Issue/PR:** #200 / #204
- **Branch:** agent/claude/200-snapshot-integrity-gate
- **Changed paths:** scripts/refresh-snapshots.mjs, package.json, test/refreshSnapshots.test.mjs, CHANGELOG.md, docs/repo-update-log.md
- **What changed:** `refreshSnapshots` now verifies each existing snapshot directory against the provider at the manifest-recorded SHA before any delete/copy, with in-band status records (`fresh` / `ok` / `divergent` / `unverifiable`). Divergence or an unresolvable pin refuses with a per-file report unless `--accept-snapshot-divergence` is passed, which instead warns with the exact list of discarded content. New read-only `npm run snapshots:verify` (CLI `--verify`) runs the same comparison without writes; the comparison is EOL-tolerant per this repo's recorded CRLF gotcha but otherwise byte-exact.
- **Verification:** `node --test test/refreshSnapshots.test.mjs` passed 13/13 (six new integrity tests: ok + CRLF tolerance, fresh, refusal naming the file with no destructive write, override recapture, extra-file divergence, unverifiable pin); `node --test "test/*.test.mjs"` passed — 494 tests / 492 pass / 0 fail / 2 skipped; real-data `npm run snapshots:verify` reported ok for all three snapshots (githubWorkflows @ af0ac6e, 18 files; repoTemplate @ d74d23c, 79 files; orgDefaults @ 1962f27, 1 file).
- **Propagation:** none (repo-local tooling); #201 (self-apply) sequences next and assumes this gate.

## 2026-06-11 - Snapshot reconvergence with provider pin

- **Issue/PR:** #199 / #203
- **Branch:** agent/claude/199-reconverge-snapshot
- **Changed paths:** src/snapshots/manifest.json, src/snapshots/repo-template/**, scripts/agent/lib.mjs, scripts/agent/status.mjs, scripts/agent/prune.mjs, docs/ecosystem-overview.md, CHANGELOG.md, docs/repo-update-log.md
- **What changed:** Ran `node scripts/refresh-snapshots.mjs` after repo-template#67 landed the upstream port of the #197 review fixes; the repoTemplate pin advanced `292dada` → `d74d23c`. Reconvergence proof: zero body changes for `.agent/startup-baseline.json`, `scripts/doc-sweep/sweep.mjs`, `test/startup-baseline.test.mjs`; `scripts/agent/{lib,prune}.mjs` and `test/agent/lib.test.mjs` legitimately carry repo-template#65 (merged-PR-proof prune retirement), and `scripts/agent/status.mjs` carries the owner-review worktree-claims fix from repo-template#67. Root lifecycle copies synced snapshot→root for the three changed files (the parity-pinned lockstep, in the sanctioned direction); `docs/ecosystem-overview.md` regenerated from the manifest.
- **Verification:** `node --test "test/*.test.mjs"` passed — 488 tests / 486 pass / 0 fail / 2 skipped, matching the pre-refresh `origin/main` baseline at `7a4aa97`; the refresh preflight validated all three provider checkouts clean and at their declared refs (repo-template `main`@`d74d23c`, github-workflows `v1`@`af0ac6e`, .github `main`@`1962f27`); `git diff --check` clean.
- **Propagation:** root copies synced in this PR; consumer distribution intentionally sequenced behind #200 (refresh integrity gate) and #201 (self-apply), then onboarding lanes #202, repo-template#68, github-workflows#38.

## 2026-06-11 - Root startup baseline repair

- **Issue/PR:** #196 / #197
- **Branch:** agent/codex/196-bootstrap-lifecycle-baseline
- **Changed paths:** AGENTS.md, .agent/startup-baseline.json, .agent/check-map.yml, .agent/coordination/README.md, .github/PULL_REQUEST_TEMPLATE.md, docs/plans/README.md, docs/agent-process/doc-sweep.md, docs/repo-update-log.md, scripts/agent/**, scripts/doc-sweep/**, package.json, src/server/tasks/writeAgentLifecycle.mjs, src/server/onboard/auditPlan.mjs, src/registry/features.json, test/**
- **What changed:** Brought the `archon-setup` root checkout into the same startup/process baseline it audits and installs for consumers. The lifecycle installer now includes `agent:pr-body`, matching the current repo-template snapshot command surface.
- **Verification:** `node --test test/writeAgentLifecycle.test.mjs test/auditAgentLifecycle.test.mjs test/onboardAudit.test.mjs` passed (23/23); `npm test` passed (458 pass, 2 skip); `npm run agent:status` passed and reported issue #196; `npm run agent:prune -- --dry-run` passed and printed prune decisions; `npm run agent:pr-body -- 196` passed and filled `Closes #196`; `node bin/onboard.mjs C:\GitHub\archon-setup-196-bootstrap-lifecycle --audit --json` passed with no missing/stale startup files and `startupReadiness.status = warning` only because `docs/superpowers/plans/` remains as an intentional legacy archive; `git diff --check` passed; `node --check` passed for `scripts/agent/*.mjs`, `scripts/agent-close-preflight.mjs`, and `scripts/agent-pr-ready.mjs`.
- **Propagation:** audit only for sibling repos under `C:\GitHub`; no broad apply without owner confirmation. Initial read-only audit found `.github`, `archon`, `github-workflows`, `jma-ui`, and `repo-template` also report incomplete startup readiness.
