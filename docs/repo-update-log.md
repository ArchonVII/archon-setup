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
