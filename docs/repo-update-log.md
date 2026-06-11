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

## 2026-06-11 - Foundation self-onboard

- **Issue/PR:** #202 / pending
- **Branch:** agent/codex/202-chore-onboard-complete-archon-setup-s
- **Changed paths:** .githooks/**, .github/workflows/actionlint.yml, .github/CODEOWNERS, .github/dependabot.yml, .github/archon-setup.json, .changelog/unreleased/README.md, .gitignore, CHANGELOG.md, docs/repo-update-log.md, src/server/tasks/writeGithooks.mjs, test/foundationParity.test.mjs, src/snapshots/manifest.json, src/snapshots/repo-template/.github/CODEOWNERS, src/snapshots/repo-template/docs/repo-update-log.md
- **What changed:** Ran `node bin/onboard.mjs C:\GitHub\archon-setup-202-chore-onboard-complete-archon-setup-s --owner ArchonVII --repo archon-setup` from the issue worktree to install the remaining foundation surface through the repo's own installer path: githooks, the actionlint caller, CODEOWNERS, Dependabot, and the changelog-fragment README. After repo-template#69 merged, refreshed snapshots so the repoTemplate pin advanced to `1a729fd3dc0ffb00fea464291d2038a56817d4cc`; githubWorkflows remains pinned to declared tag `v1` at `af0ac6e99683c107d5a420607642ff341e92713e` until an intentional workflow release/tag movement. Addressed PR review feedback by committing root `.githooks/**` files as executable and teaching `writeGithooks` to chmod installed hooks/scripts to `0755` for generated repos. Remaining audit drift is intentional: README.md is product documentation; AGENTS.md is the repo-specific agent contract; docs/repo-update-log.md is the operational ledger; .gitattributes keeps the Windows PowerShell EOL rule; CHANGELOG.md is accumulated release history; .github/PULL_REQUEST_TEMPLATE.md carries archon-setup's evidence-block contract; .agent/check-map.yml records this repo's node gate; and `docs/superpowers/plans/` remains a history-only legacy archive.
- **Verification:** `npm test` passed 499 tests (497 pass, 2 skipped). `npm run snapshots:verify` passed for githubWorkflows @ af0ac6e, repoTemplate @ 1a729fd, and orgDefaults @ 1962f27. `npm run agent:self-apply -- --check` reported already-done for agent lifecycle, doc-sweep, and startup baseline. `node bin\onboard.mjs C:\GitHub\archon-setup-202-chore-onboard-complete-archon-setup-s --audit --json` reported 29 present / 0 missing / 7 drifted, with the remaining drift adjudicated above. `C:\Program Files\Git\bin\bash.exe .githooks/scripts/install-githooks.sh`, `test-owner-maintenance.sh`, `test-checkout-role.sh`, and `bash -n .githooks/commit-msg .githooks/pre-commit .githooks/scripts/*.sh` passed. `C:\Users\josep\go\bin\actionlint.exe .github/workflows/actionlint.yml` and `git diff --check` passed.
- **Propagation:** repo-template#69 merged and snapshotted; github-workflows#67 merged, with snapshot propagation pending an intentional `v1` tag update/release.

## 2026-06-11 - Self-applied root baseline via the installer

- **Issue/PR:** #201 / pending
- **Branch:** agent/claude/201-self-apply-baseline
- **Changed paths:** scripts/agent-self-apply.mjs, package.json, test/agentSelfApply.test.mjs, test/agentLifecycleScripts.test.mjs, AGENTS.md, CHANGELOG.md, docs/repo-update-log.md
- **What changed:** New `npm run agent:self-apply` (CLI `--check` for a read-only drift report, exit 1 on drift) repairs the root agent baseline from the repo-template snapshot via the existing installer task modules — `writeAgentLifecycle` (five lifecycle scripts + `agent:*` package-script merge), `writeDocSweep` (three doc-sweep scripts + spec), and the startup baseline via the shared `writeSnapshotFile`/`checkAllMatch` primitives. AGENTS.md now documents the end-to-end flow (provider PR → `refresh-snapshots` → `agent:self-apply` → commit) and prohibits hand-edits to `src/snapshots/**` and the root copies; the parity test's guidance message points at the mechanism instead of "fix both in lockstep".
- **Verification:** `node --test test/agentSelfApply.test.mjs test/agentLifecycleScripts.test.mjs` passed 9/9 (fresh install matches snapshot bodies; second run already-done with byte-identical files; drifted copies repaired; `--check` reports without writing); real-root `npm run agent:self-apply -- --check` and apply both report already-done ×3 with a clean tree (the idempotent no-op acceptance proof); full `node --test "test/*.test.mjs"` green.
- **Propagation:** none (repo-local mechanism); unblocks onboarding lanes #202 / repo-template#68 / github-workflows#38 to use the same installer paths.

## 2026-06-11 - Snapshot integrity gate at the refresh seam

- **Issue/PR:** #200 / pending
- **Branch:** agent/claude/200-snapshot-integrity-gate
- **Changed paths:** scripts/refresh-snapshots.mjs, package.json, test/refreshSnapshots.test.mjs, CHANGELOG.md, docs/repo-update-log.md
- **What changed:** `refreshSnapshots` now verifies each existing snapshot directory against the provider at the manifest-recorded SHA before any delete/copy, with in-band status records (`fresh` / `ok` / `divergent` / `unverifiable`). Divergence or an unresolvable pin refuses with a per-file report unless `--accept-snapshot-divergence` is passed, which instead warns with the exact list of discarded content. New read-only `npm run snapshots:verify` (CLI `--verify`) runs the same comparison without writes; the comparison is EOL-tolerant per this repo's recorded CRLF gotcha but otherwise byte-exact.
- **Verification:** `node --test test/refreshSnapshots.test.mjs` passed 13/13 (six new integrity tests: ok + CRLF tolerance, fresh, refusal naming the file with no destructive write, override recapture, extra-file divergence, unverifiable pin); `node --test "test/*.test.mjs"` passed — 494 tests / 492 pass / 0 fail / 2 skipped; real-data `npm run snapshots:verify` reported ok for all three snapshots (githubWorkflows @ af0ac6e, 18 files; repoTemplate @ d74d23c, 79 files; orgDefaults @ 1962f27, 1 file).
- **Propagation:** none (repo-local tooling); #201 (self-apply) sequences next and assumes this gate.

## 2026-06-11 - Snapshot reconvergence with provider pin

- **Issue/PR:** #199 / pending
- **Branch:** agent/claude/199-reconverge-snapshot
- **Changed paths:** src/snapshots/manifest.json, src/snapshots/repo-template/**, scripts/agent/lib.mjs, scripts/agent/status.mjs, scripts/agent/prune.mjs, docs/ecosystem-overview.md, CHANGELOG.md, docs/repo-update-log.md
- **What changed:** Ran `node scripts/refresh-snapshots.mjs` after repo-template#67 landed the upstream port of the #197 review fixes; the repoTemplate pin advanced `292dada` → `d74d23c`. Reconvergence proof: zero body changes for `.agent/startup-baseline.json`, `scripts/doc-sweep/sweep.mjs`, `test/startup-baseline.test.mjs`; `scripts/agent/{lib,prune}.mjs` and `test/agent/lib.test.mjs` legitimately carry repo-template#65 (merged-PR-proof prune retirement), and `scripts/agent/status.mjs` carries the owner-review worktree-claims fix from repo-template#67. Root lifecycle copies synced snapshot→root for the three changed files (the parity-pinned lockstep, in the sanctioned direction); `docs/ecosystem-overview.md` regenerated from the manifest.
- **Verification:** `node --test "test/*.test.mjs"` passed — 488 tests / 486 pass / 0 fail / 2 skipped, matching the pre-refresh `origin/main` baseline at `7a4aa97`; the refresh preflight validated all three provider checkouts clean and at their declared refs (repo-template `main`@`d74d23c`, github-workflows `v1`@`af0ac6e`, .github `main`@`1962f27`); `git diff --check` clean.
- **Propagation:** root copies synced in this PR; consumer distribution intentionally sequenced behind #200 (refresh integrity gate) and #201 (self-apply), then onboarding lanes #202, repo-template#68, github-workflows#38.

## 2026-06-11 - Root startup baseline repair

- **Issue/PR:** #196 / pending
- **Branch:** agent/codex/196-bootstrap-lifecycle-baseline
- **Changed paths:** AGENTS.md, .agent/startup-baseline.json, .agent/check-map.yml, .agent/coordination/README.md, .github/PULL_REQUEST_TEMPLATE.md, docs/plans/README.md, docs/agent-process/doc-sweep.md, docs/repo-update-log.md, scripts/agent/**, scripts/doc-sweep/**, package.json, src/server/tasks/writeAgentLifecycle.mjs, src/server/onboard/auditPlan.mjs, src/registry/features.json, test/**
- **What changed:** Brought the `archon-setup` root checkout into the same startup/process baseline it audits and installs for consumers. The lifecycle installer now includes `agent:pr-body`, matching the current repo-template snapshot command surface.
- **Verification:** `node --test test/writeAgentLifecycle.test.mjs test/auditAgentLifecycle.test.mjs test/onboardAudit.test.mjs` passed (23/23); `npm test` passed (458 pass, 2 skip); `npm run agent:status` passed and reported issue #196; `npm run agent:prune -- --dry-run` passed and printed prune decisions; `npm run agent:pr-body -- 196` passed and filled `Closes #196`; `node bin/onboard.mjs C:\GitHub\archon-setup-196-bootstrap-lifecycle --audit --json` passed with no missing/stale startup files and `startupReadiness.status = warning` only because `docs/superpowers/plans/` remains as an intentional legacy archive; `git diff --check` passed; `node --check` passed for `scripts/agent/*.mjs`, `scripts/agent-close-preflight.mjs`, and `scripts/agent-pr-ready.mjs`.
- **Propagation:** audit only for sibling repos under `C:\GitHub`; no broad apply without owner confirmation. Initial read-only audit found `.github`, `archon`, `github-workflows`, `jma-ui`, and `repo-template` also report incomplete startup readiness.
