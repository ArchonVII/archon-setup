# RFC: Agent OS v0.1 — Read-Only Audit & Hardening Plan

**Reviewer:** Claude Fable 5 (read-only pass, 2026-06-11)
**Repo:** `ArchonVII/archon-setup`, local `C:\GitHub\archon-setup`, HEAD `d23d2e9` (= `origin/main`; two docs-only commits after the M6 squash `e6adb60`)
**Evidence basis:** direct source reads of every file in the prompt's read-list, the merged M6 e2e test, the prlane/decision/contract unit-test suites, `gh` state queries, and a full local test run (431 tests, 429 pass, 0 fail, 2 skipped — re-verified this session, not taken on faith).

---

## 1. Executive verdict

The Agent OS v0.1 loop is real, merged, and substantially better-guarded than most systems at this stage: the contract layer is fail-closed and enum-pinned, the refresh→decision→intake seam re-validates everything against the live tree, writes are catalog-sourced (a decision doc can select actions but can never inject content), path traversal is blocked at two layers, rollback never mutates main directly, and the M6 e2e gate proves the happy path end-to-end. However, the system's central trust claim — "auto-merge only behind a machine-enforced eligibility gate" — is **not currently true in production**: the gate's PR-evidence and required-check legs are fed synthetic, self-constructed inputs and an always-empty `requiredChecks` list, so the only real merge protection is whatever branch protection happens to exist on the consumer repo, which the lane neither verifies nor records (C1, C2). Additionally, the revert-PR rollback path can never reach `rollback_verified` (C12), a manually merged PR cannot be post-merge-verified at all (C6), and the CLI never wires `gh` into cleanup, silently skipping the close-PR step its own tests prove (C3). These are closable with two focused PRs to this repo alone; with them landed, calling this **Agent OS v0.1** is honest. Deliverables C and D below carry the depth; A, B, E compress and cross-reference.

---

## 2. A — Verified current state

Confidence: **V** = verified by direct read/execution this session; **V(t)** = verified via passing test; **U** = unverified.

| Component | Status verified from repo | Evidence | Conf. | Risk if stale |
|---|---|---|---|---|
| Contract schemas (6) | Merged, all `schemaVersion: 1`, `additionalProperties:false` throughout | `src/contracts/schemas/*.schema.json` (read: apply-set, run-report, decision-doc; others validated by `test/contractSchemas.test.mjs:111,187,260`) | V | Drift would be caught: enums pinned to `vocab.mjs` by test |
| Golden fixtures | Valid + invalid fixtures per schema | `test/fixtures/contracts/{apply-set,decision-doc,repo-refresh-report,run-report}/*` (16 files) | V | Low |
| Contract validator | Zero-dep, fail-closed (unsupported keyword throws; static walk `assertSchemaSupported`) | `src/contracts/validate.mjs:55-61,148-161` | V | None — do **not** rebuild it; no failure found it causes |
| Refresh audit engine (M1) | Merged; reuses `distributeRepo(mode:"audit")`, projects via operation-mapping golden, self-validates output, filters owned items | `src/server/refresh/refreshRepo.mjs:151-220`; `test/refreshRepo.test.mjs` | V | — |
| Decision doc / intake / issue-sync (M2) | Merged; LF-normalized fingerprints, redacted diffs, fenced-JSON issue transport, fail-closed resume, fresh-audit cross-check at intake | `src/server/decisions/{decisionDoc,intake,issueSync}.mjs`; `test/decisionFlow.test.mjs` (24 tests) | V | — |
| ApplySet | Produced only by intake in-process; guards = `allowAutoMerge`, path allowlist, phrase hash | `src/server/decisions/intake.mjs:253-286`; schema `apply-set.schema.json` | V | `expected*Sha256` fields advertised but unconsumed (C9) |
| prlane execute (M3) | Merged (#179 `56cc739`, issue #159 CLOSED); preflight pins HEAD==origin==baseSha, clean tree, repo identity, path allowlist | `src/server/prlane/runUpdate.mjs:195-448`; `gh issue view 159` | V | — |
| Temp-worktree behavior | Sibling dir `.archon-prlane-worktrees/`, unique names, removed by cleanup; **rollback failure paths orphan theirs** (C11) | `runUpdate.mjs:286-300`; `rollback.mjs:232-250,613-650` | V | Stale worktrees accumulate on rollback conflicts |
| Run-state machine | 21 states, explicit transitions + wildcards, terminal-only-to-rollback; enforced on every append | `src/contracts/run-states.json`; `src/server/prlane/runRecord.mjs:43-70`; reachability test `contractSchemas.test.mjs:197` | V | Missing edges block real flows (C6, C12) |
| Run ledger | Append-only JSONL at `~/.claude/archon-prlane-runs/<runId>.jsonl`; outside tracked source; no locking, no tamper-evidence (by design v0.1) | `rollback.mjs:24-30`; `runRecord.mjs:94-102` | V | — |
| PR create/update | `gh` via injectable runner; draft/non-draft; label; checks via `--json name,state,bucket` | `src/server/prlane/ghPr.mjs` | V | `checkPassed` accepts bare `"completed"` (C10) |
| Auto-merge eligibility gate | Merged; 11 reason classes; **production inputs synthetic** (C1) and `requiredChecks` always `[]` (C2) | `autoMergeGate.mjs:48-111`; `runUpdate.mjs:425-432`; `bin/archon-setup.mjs:350-356` | V | **This is the trust gap** |
| Rollback (M4) | Merged (#180 `d8ee908`, issue #160 CLOSED); already-reverted check, mainline revert, tree-match guard, revert-PR; **no path to verify a merged revert PR** (C12) | `rollback.mjs:540-691`; `test/prLaneRollback.test.mjs` (8 tests) | V | Rollback can't ever claim verified success on the PR path |
| M6 e2e gate | Merged (PR #181, squash `e6adb60`, MERGED 2026-06-10T23:51Z); covers refresh→decide→intake→execute→merge→verify→cleanup→idempotent-second-run incl. keep-local ownership persistence | `test/refreshPrLaneE2e.test.mjs`; `gh pr view 181` | V | gh fake's check shape (`status:"passed"`) is not a shape real `gh` emits (C10 note) |
| Whole loop on main, nothing in flight | **Confirmed**: 0 open PRs; `main`==`origin/main`==`d23d2e9`; clean tree | `gh pr list` = `[]`; `git status -sb` | V | — |
| Test suite | **Re-run this session: 431 tests, 429 pass, 0 fail, 2 skipped** at `d23d2e9` | local `npm test`, exit 0 | V | — |
| Shakedown 15-case matrix | **Not run** (runbook only; it is the npm-publish gate, not an audit prerequisite) | `docs/testing/shakedown/PHASE2-RUNBOOK.md` | V | Publish stays deferred until run |
| Skill catalog / policy source | `C:\Users\josep\skills` is a clean git repo at `a71a422`; catalog is **markdown-only**, entries carry no hash/version; policy defines root semantics, duplicate hard-fail, PR-only repair | `docs/skill-catalog.md`, `docs/skills-policy.md`, 74 active shared skills (spot-checked both directions) | V | Selection records must pin git SHA + computed content hash (Deliverable F) |
| Claims / evidence / handoff conventions | Claims = markdown board (convention, **not** a schema — per prompt, assessed for formalization, not reported missing); PR evidence enforced by `pr-contract.mjs` (strict: evidence fences, no placeholders, no generic verification) + `pr-policy.yml@v1` in CI | `src/snapshots/repo-template/scripts/pr-contract.mjs`; `.agent/coordination/board.md`; `templates/agent/agent.handoff.standard.md` | V | The prlane's own PR bodies fail this contract (C8) |
| Pre-run packet accuracy | Largely accurate; **stale claim found**: "local worktree `archon-setup-160-rollback-cleanup` @ `551cfbd` not on main" — worktree is gone and `git diff main 551cfbd -- src/server/prlane/` is empty (absorbed by #180) | `git worktree list`; diff run this session | V | None (point-in-time doc) |
| Model/API calls in the loop | **None exist** — the runtime loop is deterministic Node + `gh`; cost-budget constraint applies to operator agents outside this repo | grep over `src/` (hits are docs/UI strings only) | V | — |

---

## 3. B — Reconstructed control flow

Statuses reference A; not restated. Persisted artifact paths are absolute conventions, target-relative where noted.

| # | Transition | Producer → Consumer | Contract | Persisted artifact | Validation point | Failure behavior | Status |
|---|---|---|---|---|---|---|---|
| 1 | task → refresh audit | operator/CLI → `refreshTarget` | repo-refresh-report | none (stdout/JSON) | self-validate before return (`refreshRepo.mjs:214-218`) | throw / exit 1 | implemented |
| 2 | audit → decision doc | `buildDecisionDoc` → human/agent reviewer | decision-doc | HTML face under `.html-artifacts/` (never in target) and/or GitHub issue | self-validate; diffs redacted; F19 truncation in face only | throw | implemented |
| 3 | decision doc → issue (save/resume) | `saveDecisionIssue`/`resumeDecisionIssue` | decision-doc in fenced JSON | GitHub issue, label `archon-decision`, supersession comments | fence singleton + JSON parse + schema on resume (F18) | refuse, never degrade | implemented |
| 4 | completed doc → ApplySet | `intakeDecisionDoc` | apply-set | none (in-process only) | schema, repo identity, baseSha pin, per-item fingerprints vs live tree, fresh-audit option re-derivation, rationale gates | reject with coded reason / `--allow-partial` skips | implemented |
| 5 | ApplySet → execute | CLI `refresh --execute` → `runUpdate` | apply-set + run-state-machine | run ledger `~/.claude/archon-prlane-runs/<runId>.jsonl` | phrase hash, path allowlist (`assertAllowedRelpath`), catalog↔ApplySet match, clean tree, HEAD==origin==baseSha | throw + `failed` ledger entry (`appendFailure`) | implemented |
| 6 | apply → verified_local | `distributeRepo(apply)` + `refreshRepo` re-audit in worktree | operation-mapping | worktree commit; `.archon/region-ownership.json` (tracked, in-repo by design) | post-apply audit: every item `clean_apply`/`changed:false` | throw → `failed` | implemented |
| 7 | verified_local → pr_created | `git push` + `createDraftPr` + label | — | remote branch `agent/refresh/<runId>-…`, PR | gh exit codes | throw → `failed` | implemented |
| 8 | pr_created → merge_queued | `evaluateAutoMergeEligibility` → `queueAutoMerge` (`gh pr merge --auto --squash --delete-branch`) | apply-set guards | ledger entries | **gate inputs synthetic; requiredChecks=[]** | ineligible → stop at `checks_pending` (PR stays open) | **partial — C1/C2** |
| 9 | merge_queued → merged | **GitHub** (branch protection + auto-merge) | none of ours | GitHub merge commit | external only — the loop records nothing at merge time | n/a | external by design; back-filled by #10 |
| 10 | merged → verified_merged | `verifyMergedRun` re-audit at merge commit in detached worktree | run-report | ledger + RunReport (self-validated) | post-merge audit content check; **mergeSha assumed = head of origin/default** (C5); **illegal transition if run stopped at `checks_pending`** (C6) | `failed` + safeNextAction "run rollback" | **partial — C5/C6** |
| 11 | verified_merged → cleaned_up | `cleanupRun` | run-state-machine | worktree/branches removed | remote-deletion verified before `cleaned_up` (tested) | **CLI never passes `runGh` → close-PR silently skipped** (C3); crash-after-delete from state `merged` (C7) | **partial — C3/C7** |
| 12 | any-merged → rollback_verified | `rollbackRun` | run-state-machine + run-report | revert branch/worktree/PR | already-reverted diff check; mainline revert; tree-match guard | conflict → `failed` + **orphaned worktree, unrecorded** (C11); **revert-PR path never reaches `rollback_merged`/`rollback_verified`** (C12) | **partial — C11/C12** |
| 13 | run → Release-Admiral review | RunReport + PR body | run-report + pr-contract convention | PR body | `pr-policy.yml@v1` (not branch-protection-required) | **machine PR bodies fail the repo-template's own contract** (C8); report buckets synthesized from intent (C4) | **partial — C4/C8** |
| 14 | skill discovery | — | — | — | — | — | **missing — Deliverable F confirms the working hypothesis: this is the right v0.1 extension, as read-only selection + evidence recording** |

---

## 4. C — Code/contract disagreement findings [HIGH PRIORITY]

Severity: **MF** = must-fix-v0.1, **SF** = should-fix-soon, **L** = later.

### C1 — The auto-merge gate is self-referential in its only production call path — SF
- **File:** `src/server/prlane/runUpdate.mjs:425-432` (also preflight call at `:232-241`); gate `src/server/prlane/autoMergeGate.mjs:48-111`
- **Observed:** the final eligibility evaluation receives `pr: { labels: ["automated-distribution"], body: prBody }` — the label *assumed* and the body *locally constructed*, never fetched from GitHub — plus `postApplyAudit: { clean: true }` hardcoded. The gate's PR-evidence legs (label present, decision-doc fingerprint in body, issue link) verify the code's own output. They can only fail in tests.
- **Expected:** `docs/runtime-loop.md:135-150` presents the gate as checking PR evidence; the decision log (2026-06-09) promises a "machine-enforced" eligibility gate.
- **Why it matters:** any divergence between intended and actual GitHub state (label removed by automation, body edited between create and queue, audit refactor) is invisible. The `post-apply-audit-not-clean` reason is dead code in production — confirming the packet's open question: that branch is **not load-bearing**; the load-bearing guard is the throw at `runUpdate.mjs:344`.
- **Fix shape:** before queueing, `gh pr view <n> --json labels,body` and feed actual values; pass the real audit result object instead of a literal.
- **Test:** fake gh returning a PR without the label → `runUpdate` must stop at `checks_pending` with `missing-pr-label`. Today this is impossible to exercise through `runUpdate`.

### C2 — `requiredChecks` is always empty in production; merge safety silently delegates to unverified branch protection — MF
- **File:** `bin/archon-setup.mjs:350-356` (no `requiredChecks` passed); `runUpdate.mjs:203` (default `[]`); grep confirms only tests pass `["test"]`
- **Observed:** `refresh --intake … --execute --confirm …` evaluates the gate with zero required checks; `listPrChecks` output is collected then ignored. `queueAutoMerge` runs `gh pr merge --auto`. If the consumer repo has no required status checks, **auto-merge merges immediately with no CI having run**.
- **Expected:** `docs/runtime-loop.md:149` lists "any requiredChecks entry missing or not passing" as an active gate reason; the v0.1 trust story is "CI/validation → auto-merge eligibility gate".
- **Why it matters:** this is the loop's central safety claim. The lane neither verifies that branch protection exists on the target nor records what it was. `tightenRequiredGate` (and `DEFAULT_REQUIRED_GATE_CHECK`) already exist in this repo but are not consulted by the execute path.
- **Fix shape:** resolve required checks at execute time (from the target's branch protection via `gh api`, or the `.github/archon-setup.json` manifest) and pass them to the gate; **refuse `auto` mode when the resolved set is empty** (suggest `--pr-only`). Record the resolved set in the ledger.
- **Test:** e2e variant where the fake gh reports no checks → `auto` mode must refuse or stop at `checks_pending`; ledger records the refusal reason.

### C3 — CLI never wires `runGh` into `cleanupRun`/`rollbackRun`; the close-PR step its own tests prove is unreachable — SF
- **File:** `bin/archon-setup.mjs:202-207`; `rollback.mjs:398-402` (`if (!context.prNumber || !runGh) return;`), `:404-410` (default `runGh = null`)
- **Observed:** `test/prLaneRollback.test.mjs:393` ("cleans up failed unmerged PR runs by closing the PR") passes a fake `runGh`; the production CLI passes none, so cleanup of an unmerged run deletes the remote branch without closing the PR (GitHub then closes it as a side effect, with no record). Contradicts `run-states.json:27` ("the branch is never deleted while the PR is open").
- **Fix shape:** default `runGh` to the `ghRunner` used by `ghPr.mjs` (one-line each in `cleanupRun`/`rollbackRun`), matching `createDraftPr`'s own default-parameter pattern.
- **Test:** CLI-level cleanup with `ARCHON_GH_BIN` fake must record `pr close` before branch deletion.

### C4 — `RunReport.results` is synthesized from the ApplySet, not from outcomes — SF
- **File:** `rollback.mjs:133-143,219` — every report lists **all** items under `results.applied` (with keep-local shown as `action:"skip"` inside `applied`), and `skipped`/`blocked`/`failed` are hardcoded `[]` — even for a run that failed at preflight and applied nothing.
- **Expected:** `run-report.schema.json:77-87` defines four outcome buckets; the schema title says "extended, not reinvented" from the frontend spec where buckets are outcomes.
- **Why it matters:** the RunReport is the evidence artifact the Release-Admiral reviews; a failed run's report currently asserts items were applied.
- **Fix shape:** derive buckets from the ledger's reached state: nothing in `applied` before the `applied` state; keep-local under `skipped`; failure stage's items under `failed`.
- **Test:** report built from a failed-preflight record → `results.applied` must be `[]`.

### C5 — `verifyMergedRun` back-fills `mergeSha` as head-of-origin without verifying it is this run's merge commit — SF
- **File:** `rollback.mjs:289-294`
- **Observed:** when the ledger lacks `mergeSha` (normal: runUpdate ends at `merge_queued`), verify records `rev-parse origin/<default>` as the merge SHA. If unrelated commits landed after the squash, the ledger permanently records a foreign commit as this run's merge; a later `rollback` would revert that foreign commit — caught only by the `RollbackTreeMismatch` guard (`rollback.mjs:640-650`), which turns a wrong revert into a failed run rather than a wrong merge, but the ledger evidence is still false.
- **Fix shape:** when `prNumber` exists, resolve via `gh pr view --json mergeCommit,state`; only fall back to head-of-origin with an explicit `mergeShaSource: "assumed-origin-head"` ledger field.
- **Test:** bare-remote fixture with one extra commit pushed after the squash → verify must record the PR's actual merge SHA.

### C6 — No legal path to record a manual merge of a gate-ineligible run — MF
- **File:** `src/contracts/run-states.json:54-78` (transitions); `rollback.mjs:296-314`
- **Observed:** if `runUpdate` stops at `checks_pending` (gate ineligible — the designed human-review outcome) and a human merges the PR, `verifyMergedRun` appends `merged`, but `checks_pending → merged` is not a legal transition (only `merge_queued → merged`); `appendRunState` throws and **post-merge verification — the trust step — becomes impossible exactly in the human-override case v0.1 is supposed to support.** Same for `pr_created → merged` (pr-only mode then merged by hand).
- **Fix shape:** additive transitions in `run-states.json`: `checks_pending → merged` and `pr_created → merged` (data-only change; machine schema unchanged). Optionally a `mergedBy: "manual"` ledger field.
- **Test:** record ending at `checks_pending`; merge in fixture remote; `verifyMergedRun` must reach `verified_merged`.

### C7 — `cleanupRun` from state `merged` performs destructive deletes, then crashes on an illegal `aborted` append — SF
- **File:** `rollback.mjs:404-457`; `run-states.json:88` (abort wildcard excludes `merged`)
- **Observed:** cleanup on a merged-but-unverified run deletes worktree and branches, then falls into the `else` branch and appends `aborted`, which the wildcard forbids from `merged` → throws *after* the destructive work, leaving the ledger un-advanced.
- **Fix shape:** in `cleanupRun`, route `merged`/`merge_queued` states to "verify first" guidance (refuse with safeNextAction) instead of the abort append; or allow `cleaned_up` from `verified_merged` only and make cleanup refuse earlier.
- **Test:** record at `merged`; `cleanupRun` must refuse cleanly (no deletes) or complete with a legal state — never throw post-delete.

### C8 — The PR lane's generated PR bodies fail the ecosystem's own PR contract — SF
- **File:** `runUpdate.mjs:149-173` (`prBodyForApplySet`), `rollback.mjs:465-494` (`rollbackPrBody`); validator `src/snapshots/repo-template/scripts/pr-contract.mjs:195-210` (evidence fences required after checked items, default-on), `:16-18` (issue link / placeholder rules)
- **Observed:** both bodies contain checked verification items (`- [x] Local post-apply audit passed…`) with **no** ```` ```evidence ```` fence; the rollback body has no issue link when `issueNumber` is absent. `pr-policy.yml@v1` enforces the strict body contract in CI, but the branch-protection-required check is only `repo-required-gate / decision` — so machine PRs either stall (where pr-policy is made required) or merge while being held to a **weaker evidence standard than the repo-template demands of agents**. This is threat D-14 made concrete.
- **Fix shape:** emit evidence fences containing the actual post-apply audit facts (item count, itemIds, audit timestamp, baseSha, run ledger path) — all already in hand at body-construction time; add `Refs #N` fallback or an explicit no-issue marker on rollback bodies.
- **Test:** unit test asserting `validatePrContract({title, body: prBodyForApplySet(applySet), branch, files}).ok === true` — a cheap permanent cross-module gate.

### C9 — `expectedFileSha256`/`expectedRegionInnerSha256` are produced, schema-required, and never consumed; a source comment claims otherwise — SF
- **File:** producer `intake.mjs:241-245`; schema `apply-set.schema.json:53-77`; **no consumer** (grep: gate validates shape only); contradicting comment `decisionDoc.mjs:42-44`: "M3 MUST reuse this helper for its inside-worktree re-validation" — M3 never fingerprints anything.
- **Observed:** staleness at execute is enforced only transitively via the baseSha triple-pin (`runUpdate.mjs:260-272`). That holds for the current in-process CLI path, but `runUpdate` is an exported API accepting any ApplySet (the e2e test itself constructs one), so the schema advertises a per-item integrity property that does not exist for any out-of-process ApplySet.
- **Fix shape:** in the worktree, before `distributeRepo(apply)`, recompute `contentFingerprint` per item and compare against `expected*Sha256` (null-tolerant for create-file); fail with a precise per-item reason.
- **Test:** ApplySet with a stale `expectedFileSha256` against a moved fixture → `failed` at `worktree_created` stage with the hash reason.

### C10 — `checkPassed` accepts bare `"completed"` as passing — L
- **File:** `autoMergeGate.mjs:35-41`
- **Observed:** the status chain `bucket ?? conclusion ?? status ?? state` plus pass-list containing `"completed"` means a raw GitHub API check-run `{status:"completed"}` (no conclusion yet, a real race shape) counts as passing. Current callers are safe (`gh pr checks --json name,state,bucket` always yields `bucket`), and the e2e fake's `{status:"passed"}` is a shape real gh never emits (test-fidelity gap).
- **Fix shape:** drop `"completed"`/`"ok"` from the pass list; treat `completed` as requiring a conclusion. Align the e2e fake to gh's real `bucket` vocabulary.
- **Test:** `{status:"completed", conclusion:"failure"}` and `{status:"completed"}` both → not passing.

### C11 — Rollback failure paths orphan the rollback worktree and branch, and never record them — SF
- **File:** `rollback.mjs:613-650` (worktree/branch created before revert; `RollbackConflict`/`RollbackTreeMismatch` paths return without removal), `:521-538` (failure entry carries no `rollbackBranch`/`rollbackWorktreePath`), `:422-424` (`cleanupRun` removes only the *original* worktree/branch)
- **Why it matters:** stale-temp-worktree threat (D-3) realized; because the paths are unrecorded, even a later cleanup cannot find them from the ledger.
- **Fix shape:** wrap revert in try/finally removing the worktree on failure; include rollback paths in the failure entry; extend `cleanupRun` to remove rollback artifacts when present.
- **Test:** forced revert-conflict fixture → assert no worktree remains and the failure entry carries the paths.

### C12 — The revert-PR rollback path can never reach `rollback_merged`/`rollback_verified` — MF
- **File:** `run-states.json:76-77` defines the transitions; **no code appends either state for the PR path** (grep: only the already-reverted shortcut appends `rollback_verified`, `rollback.mjs:586-610`); re-running `rollback` at `rollback_pr_created` returns idempotently without checking whether the revert PR merged (`rollback.mjs:551-558`).
- **Why it matters:** the threat "rollback claims success when main was not actually restored" currently inverts: rollback can never *claim verified success at all* for its primary mechanism. The run ends at `rollback_pr_created` forever; no command verifies main was restored after the revert PR merges.
- **Fix shape:** on re-entry at `rollback_pr_created`, query the revert PR state; if merged, append `rollback_merged` then run `refAffectedPathsMatchBase` against fresh `origin/<default>` → `rollback_verified` (or `failed` with `RollbackTreeMismatch`).
- **Test:** fixture merges the revert branch into the bare remote, re-runs `rollback` → must end `rollback_verified`; a poisoned merge (paths still differ from base) → `failed`.

### C13 (minor) — `resumeDecisionIssue` ignores supersession — L
`issueSync.mjs:141-156`: a superseded issue at an unchanged baseSha resumes successfully. Intake's stale-base check covers the moved-HEAD case. Fix later: refuse when a `superseded-by:` comment exists, or check label state.

### C14 (minor) — `evidence.truncated` is always `false` from `buildDecisionDoc` — L
`decisionDoc.mjs:143-148`: truncation exists only in the HTML face (F19, tested). A pathological diff could exceed GitHub's issue-body cap; `gh issue create` fails loudly (acceptable). Dead field until a truncation policy exists at the doc layer.

---

## 5. D — Failure-mode red team [HIGH PRIORITY]

Evaluated against the **actual** `autoMergeGate`/`rollback`/`runRecord`/`runUpdate` code and the merged tests. "Proof" = the fixture/CI check that should exist.

| # | Failure mode | Current guard | Missing guard | v0.1 required action | Proof |
|---|---|---|---|---|---|
| D1 | Dirty main / target worktree at execute | `runUpdate.mjs:257-258` throws on porcelain output; HEAD==origin==baseSha triple-pin `:260-272` | Audit/intake tolerate a dirty tree by design (read-only) — decisions can be formed on uncommitted content; execute then applies catalog-true content anyway (writes are catalog-sourced, never doc-sourced — the system's strongest property) | None beyond C9 (worktree fingerprint re-check); document the "decisions-on-dirty-evidence" residual | Unit fixture: dirty target → execute throws (add explicit test; not in current suite by name) |
| D2 | Run interrupted mid-apply | `failed` wildcard + `failedStage`/`safeNextAction`; worktree recorded at `worktree_created` before apply; `cleanupRun` removes it | (a) interrupt in the window between `git worktree add` and the ledger append orphans an unrecorded worktree; (b) `appendFailure` swallows ledger-write failures silently (`runUpdate.mjs:191-192`) | Accept (a) as documented residual or add a pre-add "intent" entry; for (b) at minimum `console.error` the secondary failure | Fixture: simulate append failure → stderr carries both errors |
| D3 | Stale temp worktree | Unique names (`Date.now`+pid+random); `withDetachedWorktree` has try/finally (`rollback.mjs:237-250`); cleanup removes recorded exec worktree | Rollback-failure orphans (C11); no sweep for unrecorded leftovers in `.archon-prlane-worktrees/` | Fix C11; optional `cleanup --scan` listing leftovers under the sibling dir | C11 test |
| D4 | Stale claim (coordination board) | None (markdown convention; any agent may remove stale rows per board text) | No machine check that a claim exists/was released for a lane | **Accept for v0.1** (single-operator); formalization is a v0.2 decision, not a missing schema | n/a |
| D5 | Stale schema version | Every schema `const: 1`; validators fail closed on mismatch; enum-pinning test | Consumer repos carry no schemas (single-producer world) — nothing to skew yet | None for v0.1 | `contractSchemas.test.mjs:260` exists |
| D6 | Windows path normalization | `patternAllows` normalizes `\`→`/` (`autoMergeGate.mjs:20-29`); `assertAllowedRelpath` rejects absolute (incl. drive-letter) and `..` on both separators (`runUpdate.mjs:31-41`); `safeJoin` resolve+sep prefix check (`src/server/lib/paths.mjs`); fingerprints LF-normalized | Case-insensitive FS vs case-sensitive compares — fails **closed** (a case-variant path fails the allowlist), correct direction | None | Add a unit case: `item.file: "agents.md"` vs pattern `AGENTS.md` → disallowed-path |
| D7 | Path traversal / write outside worktree | Two layers: `assertAllowedRelpath` + `safeJoin` for ownership records; commit scope limited to `git add -- <changedPaths>` so the commit cannot contain non-allowlisted files | `safeJoin` is lexical — a symlink **inside** the consumer repo at an allowlisted path writes through to outside. Low for owner-controlled repos | Document residual; later: `lstat` check before write | Fixture: symlinked `AGENTS.md` → define and pin expected behavior |
| D8 | DB/cache/local artifacts tracked | Ledger in `~/.claude/`; worktrees in sibling dir; HTML faces under `.html-artifacts/` "never in the target repo" (CLI help, tested at `decisionFlow.test.mjs:575`) | **Collision pending:** backlog item plans gitignoring `.archon/` in generated repos, but `.archon/region-ownership.json` MUST be tracked (keep-local persistence, proven by e2e:223-245). If `.archon/` is ignored wholesale, ownership records silently stop persisting and keep-local decisions resurface every audit | Write the `.archon/` tracking policy doc **before** the gitignore backlog item ships: ignore `events.jsonl`, track `region-ownership.json` | A refreshRepo test already covers malformed ownership (`refreshRepo.test.mjs:259`); add one for *ignored/absent after decision* if policy slips |
| D9 | Secret-looking values in ledgers/issues | DecisionDoc diffs pass `redactString` (tested incl. hostile content, `decisionFlow.test.mjs:177,192`); ApplySet/ledger entries carry no file content; phrase stored only as SHA-256 | Run ledger entries embed the full ApplySet repeatedly (size, not secrecy) | None for v0.1 | Existing redaction tests |
| D10 | Model PR body passes text checks without real evidence | `bodyIncludesIssue` + fingerprint-substring checks exist (`autoMergeGate.mjs:43-46,93-99`) — but evaluated against self-constructed body (C1) | Machine bodies carry no actual evidence payload (C8); fingerprint check is substring-match on a body the same process wrote | Fix C1 + C8 | C8's `validatePrContract` unit gate |
| D11 | Actions validate format, not semantic truth | The loop's semantic truth is content-based re-audit (post-apply, post-merge) — genuinely strong | No remote check that an `automated-distribution` PR's diff ⊆ allowlisted paths (local construction guarantees it; nothing re-proves it server-side against tampered tooling) | Defer: optional `distribution-guard` Action for v0.2 | n/a (documented residual) |
| D12 | Role-authority ambiguity | None machine-readable. The confirmation phrase is **derivable** (`intake.mjs:39-41` — `APPLY <repo> <runId>`): it scopes intent, it does not authenticate. Real authority boundary = whoever holds the `gh` token. `enforce-role-separation` exists in pr-policy but defaults off; note `role-protected-paths` includes `AGENTS.md` — the very file the lane distributes | An authority doc; a decision on flipping role-separation for consumer repos (which would then require non-author approval for AGENTS.md PRs — interacts with auto-merge!) | Write the authority-model doc (G); decide the role-separation/auto-merge interaction explicitly | Doc review |
| D13 | Human bypass / repo created outside baseline | Registry (`config/ecosystem-map.json`) is the perimeter; non-registry repos are never audited | Nothing detects an unregistered ArchonVII repo | Accept v0.1; ecosystem snapshot could later diff `gh repo list` vs registry | n/a |
| D14 | Duplicate/conflicting skills | Policy: same-name different-hash = hard failure (skills-policy.md); junction architecture | No CI enforces it; catalog has no hashes | Deliverable F selection record pins commit SHA + computed SKILL.md hash | F's validator |
| D15 | Prompt injection via skill/tool metadata | n/a today (no discovery step exists) | Entire surface arrives with F | F design: name-allowlist from catalog, metadata treated as data, hash-pinned, rationale authored not copied | F's tests |
| D16 | Model/API cost runaway | No model calls exist anywhere in the loop (verified) | n/a inside this repo | Document: the cost-budget constraint binds operator agents, not this codebase | grep gate in CI if desired |
| D17 | Rollback claims success when main not restored | Already-reverted path: real diff check vs `origin/<default>` (`rollback.mjs:586`); revert path: tree-match guard before any push (`:640-650`) | The opposite defect: verified success unreachable for the PR path (C12); wrong-mergeSha revert possible but caught by tree guard (C5) | Fix C12 + C5 | C12's e2e-style fixture |
| D18 | Gate treats partial evidence as complete | Schema-valid ApplySet, phrase hash, category/path allowlists are real checks | PR-evidence legs synthetic (C1); required checks empty (C2); checks evaluated once at PR-creation time (always pending) rather than at merge time — by design delegated to GitHub, but unverified (C2) | Fix C1 + C2 | C1/C2 tests |
| D19 | Concurrent runs / ledger races (found in code, beyond the minimum list) | Unique branch/worktree names; runId-keyed ledgers | No file locking on read-validate-append (`runRecord.mjs:94-102`); two concurrent processes on one runId can interleave; `--last` resolves by mtime and can pick the wrong run when interleaved (`rollback.mjs:32-45`) | Accept v0.1 (single operator); document | n/a |
| D20 | `gh pr merge --auto --delete-branch` deletes the branch at merge while cleanup also deletes (found in code) | `deleteRemoteBranchIfPresent` verifies post-delete state and tolerates already-gone | None — handled | None | covered by `prLaneRollback.test.mjs:370` |

---

## 6. E — Schema stability tiers

Confirms/amends the `src/contracts/README.md` `[INTENT]` proposal. "Blocks v0.1" = must change before v0.1 can be declared.

| Schema | Tier | Producer → Consumers | Versioning risk | Backward-compat rule | Fixture coverage | Blocks v0.1? |
|---|---|---|---|---|---|---|
| **run-state-machine** (`run-states.json` + its schema) | **1 — freeze after PR2** | hand-authored → `runRecord`, reports | Low; data-only file | Additive transitions only; never remove a state; `requires` may only grow optional context | reachability + dead-row tests | **Yes — C6/C12 need two additive transitions first** |
| **apply-set** | **1 — freeze now** | `intake` → `runUpdate`, `autoMergeGate`, `rollback` | Low | New fields optional-only; `guards` required trio immutable; **document the path-pattern grammar** (exact-match or `**/`-suffix only — implicit in `patternAllows`, surprising vs full glob) | valid + 3 invalid | No (C9 is consumer behavior, not shape) |
| **operation-mapping** | **1 — freeze now** | golden JSON → refresh, decisionDoc, intake | Lowest | Rows may be added only with new raw statuses (vocab-pinned) | exactly-one + no-dead-row + status-coverage tests | No |
| **repo-refresh-report** | **2 — stable core** | `refreshRepo` → decisionDoc, gate audits, humans | Medium | `raw`/`operation`/`recommended*` frozen; `repo` block may gain optional fields (e.g. `dirty`) | valid ×2 + invalid ×3 | No |
| **decision-doc** | **2 — stable core** | `buildDecisionDoc` → HTML face, issue transport, intake | Medium (it round-trips through GitHub) | `items[].fingerprints`/`resolution` frozen; adapter fields: `evidence.truncated` (dead today, C14), `resolution.freeText` (reserved), `provenance.snapshotShas` (optional-now) | valid ×2 + invalid ×3, plus round-trip golden | No |
| **run-report** | **3 — provisional until C4** | `buildRunReport` → operator/Release-Admiral | Medium | `results` bucket *semantics* must be fixed (C4) before freezing; `repoState`/`copyable` reserved-for-future (frontend spec, unproduced here); `pr.url` optional-now | valid ×2 + invalid ×2 | **Semantics yes (C4), shape no** |
| claim / evidence / handoff | **4 — out of v0.1 scope** | conventions (`board.md`, `pr-contract.mjs`, handoff template) | n/a | Decision: **do not formalize in v0.1.** `pr-contract.mjs` is already an executable contract; the board stays a convention until multi-agent concurrency is real. Revisit at v0.2 with a claim schema + skill-selection record (F) as the first new contracts | pr-contract has its own test suite | No |

Field-level: every field listed in a schema's `required` array is required-now; explicitly **reserved-for-future**: `run-report.repoState`, `run-report.copyable`, `decision-doc.items[].resolution.freeText`, `decision-doc.provenance.snapshotShas`, `decision-doc.items[].evidence.truncated` (until a doc-layer truncation policy exists), `apply-set.items[].expected*Sha256` (becomes required-enforced after C9).

---

## 7. F — Skill discovery in the loop (design sketch, read-only)

**Working hypothesis: confirmed.** The loop's mechanical spine is complete; the genuinely missing v0.1 extension is recording *which skills guided the operating agent* — read-only selection + evidence recording, no install/promotion.

- **Where in the flow:** at lane start — after the issue/decision doc is accepted, before `planned` is appended. The selection record rides into the run ledger as an optional field on the `planned` entry (additive; `runRecord` field requirements unchanged).
- **Inputs:** task/issue text, decision doc (repo, categories), repo metadata (stack from registry), declared role (e.g. Project-Lieutenant).
- **Source of truth:** `C:\Users\josep\skills\docs\skill-catalog.md` (ArchonVII/jma-skill-review) at a pinned commit. Verified this session: the catalog is **markdown-only**; SKILL.md frontmatter has `name`/`description` (+ sparse `metadata.risk`, `date_added`); **no hashes or versions exist** — so identity must be pinned as *(skills-repo commit SHA, relative path, computed content hash)*. The repo is clean at `a71a422` today.
- **Minimal skill-selection record** (new contract, `schemaVersion: 1`):

  ```json
  {
    "kind": "skill-selection", "schemaVersion": 1, "runId": "…", "selectedAt": "…",
    "source": { "repo": "ArchonVII/jma-skill-review", "commit": "<40-hex>", "root": "shared/" },
    "selections": [
      { "name": "<catalog name>", "relpath": "close/SKILL.md",
        "skillSha256": "<computed over SKILL.md, LF-normalized via contentFingerprint>",
        "whySelected": "<authored by the selecting agent — never copied from skill metadata>" }
    ],
    "noRelevantSkill": false,
    "discovery": { "status": "ok | catalog-unreadable | repo-dirty", "fallback": "proceeded-without-skills" }
  }
  ```

- **Prompt-injection resistance:** selection is constrained to an allowlist of names parsed from the catalog; skill `description`/body are treated as data (displayed quoted, never interpolated into commands or instructions during discovery); `whySelected` is authored, not copied; the content hash makes post-hoc tampering of the consulted skill detectable; a dirty skills repo downgrades to `repo-dirty` status with the dirtiness recorded.
- **No relevant skill:** `noRelevantSkill: true` is a first-class, valid outcome — recorded, never blocking.
- **Discovery failure:** catalog unreadable / repo missing → record `discovery.status` + `fallback`, proceed; the mechanical lane must never be blocked by the advisory layer.
- **CI can validate:** record schema; SHA formats; (within archon-setup CI) nothing cross-repo — archon-setup CI cannot see `C:\Users\josep\skills`, so existence-of-skill checks are operator-side only. **CI cannot truthfully prove:** that the skill was read, followed, or causally helped — do not pretend otherwise; the record is provenance, not proof of compliance.
- **Classification:** required-for-v0.1: the record schema + ledger field + validator + fixtures. Deferrable: generated machine-readable catalog index (JSON from frontmatters, with hashes — belongs in jma-skill-review), cross-repo CI existence check. Out-of-scope: auto-install, promotion, Skills Hub UI, any mutation of skill repos.

---

## 8. G — Documentation gaps

| Doc | Accurate as written? | Blocks v0.1? | Action |
|---|---|---|---|
| `docs/runtime-loop.md` | Yes — every spot-checked claim matched code; its two `[OPEN]` questions are now answered (gate branch **not** load-bearing → C1; `merge_queued→merged` advanced by GitHub, back-filled by verify → C5/C6) | No | Update after PR1/PR2 land; close the two `[OPEN]` tags |
| `src/contracts/README.md` | Yes; tiers were `[INTENT]` — superseded by Deliverable E above | No | Replace tier section with E's table |
| `docs/reviews/2026-06-11-fable-review-brief.md` | Mostly; **stale**: the `archon-setup-160-rollback-cleanup` worktree no longer exists and `551cfbd`'s prlane content is fully on main via #180 (verified by diff) | No | Point-in-time doc; annotate or leave |
| `docs/ecosystem-overview.md`, `ecosystem-status.md` | Consistent with each other and with repo state (agent-swept, spot-verified) | No | Routine refresh cadence already documented |
| **Missing: authority model** (who may execute/rollback/merge; the confirmation phrase is derivable and therefore *not* an authorization boundary; the gh token is) | — | **Yes** — "trustworthy v0.1" is unfalsifiable without stating the trust anchor | New short doc `docs/authority-model.md`; owner: repo owner; staleness guard: link from runtime-loop.md |
| **Missing: `.archon/` tracking policy** (track `region-ownership.json`, ignore `events.jsonl`) | — | **Yes-if** the pending gitignore backlog item ships first (D8 collision) | One section in ecosystem-overview or repo-template AGENTS.md before that backlog item |
| **Missing: consumer prerequisites for auto mode** (required gate configured; `tighten-required-gate` run; what happens when absent) | — | Companion to C2 | Fold into PR1's docs |
| Missing: generated run-state diagram | — | No | Nice-to-have: generate from `run-states.json` in CI so it cannot go stale |
| `docs/glossary.md` | Does not exist (loop glossary lives inline in runtime-loop.md) | No | Leave inline |

---

## 9. H — Proposed PR sequence (pending approval; implementation is a separate pass)

All in `ArchonVII/archon-setup`; no other repo must change for v0.1. Each PR: branch `agent/claude/<n>-<slug>`, worktree under the repo's normal lane convention, local test `npm test`, CI `Node CI` (existing), rollback = revert the squash (no consumer impact until the next distribution run). M3/M6 are merged — nothing here re-implements them.

### PR1 — `fix(prlane): make the auto-merge gate consume real evidence` — must-fix-v0.1
- **Closes:** C1, C2, C10 (+ e2e fake fidelity)
- **Files:** `src/server/prlane/{autoMergeGate,runUpdate,ghPr}.mjs`, `bin/archon-setup.mjs`, `test/prLane{AutoMergeGate,RunUpdateLocal}.test.mjs`, `test/refreshPrLaneE2e.test.mjs`, `docs/runtime-loop.md`
- **Acceptance:** gate evaluates `gh pr view`-fetched labels/body and the real audit result; execute resolves required checks from the target (manifest or branch protection) and **refuses `auto` mode when the set is empty**, recording the resolved set in the ledger; `checkPassed` no longer accepts bare `completed`; e2e fake emits gh-real `bucket` shapes; new ineligibility paths covered by fixtures.
- **Order:** first — it is the trust core.

### PR2 — `fix(prlane): close the rollback/cleanup lifecycle` — must-fix-v0.1
- **Closes:** C3, C5, C6, C7, C11, C12
- **Files:** `src/server/prlane/rollback.mjs`, `src/contracts/run-states.json`, `bin/archon-setup.mjs`, `test/prLaneRollback.test.mjs`, `test/prLaneRunRecord.test.mjs`, run-record fixtures
- **Acceptance:** additive transitions `checks_pending→merged`, `pr_created→merged`; re-entrant `rollback` advances `rollback_pr_created→rollback_merged→rollback_verified` with the tree check against fresh origin; `mergeSha` resolved from the PR (fallback explicitly marked `assumed-origin-head`); `runGh` defaulted in `cleanupRun`/`rollbackRun`; cleanup from `merged`/`merge_queued` refuses safely before any delete; rollback failures remove their worktree and record branch/worktree paths.
- **Order:** after PR1 (independent code paths, but PR1's ledger fields are referenced in tests).

### PR3 — `feat(prlane): truthful evidence artifacts` — should-fix-soon
- **Closes:** C4, C8, C9 (and the `decisionDoc.mjs:42-44` comment/code mismatch)
- **Files:** `src/server/prlane/{rollback,runUpdate}.mjs`, `test/prLane*.test.mjs`, new unit test importing `validatePrContract` from the repo-template snapshot, `docs/authority-model.md`, `.archon/` policy section
- **Acceptance:** RunReport buckets derive from the reached state (failed-preflight ⇒ `applied: []`); generated PR bodies pass `validatePrContract` with evidence fences carrying real audit facts; `runUpdate` re-verifies `expected*Sha256` in the worktree via `contentFingerprint`; authority-model and `.archon/` policy docs land.
- **Order:** last of the three.

**Follow-on (separate RFC-approved lane, not in the 3):** PR4 `feat(contracts): skill-selection record` implementing Deliverable F (schema + fixtures + ledger field + validator). Must-fix for "Agent OS with skills"; not required for the v0.1 mechanical-loop claim.

---

## 10. I — Final verdict / definition of done

**Can this be called Agent OS v0.1 after the fixes?** Yes — after PR1 and PR2. PR3 is strongly recommended before the loop's artifacts are shown to any external reviewer as evidence.

**Minimum definition of done:**
1. The gate consumes fetched PR state and a non-empty, target-derived required-check set, or refuses auto mode (PR1).
2. A manually merged PR can be post-merge verified; a revert PR can reach `rollback_verified`; cleanup never destroys state it cannot legally record (PR2).
3. `npm test` green; e2e extended to cover the refusal and rollback-verify paths.
4. `docs/runtime-loop.md` updated; authority-model doc exists.

**Intentionally unsafe or manual, by design (documented, not hidden):**
- Branch protection configuration on consumer repos is operator responsibility (`tighten-required-gate` is the tool); the loop verifies it (post-PR1) but does not create it.
- The confirmation phrase scopes intent; it does not authenticate. The `gh` token is the only authority boundary.
- Claims remain a markdown convention; single-operator concurrency assumptions (no ledger locking) stand.
- The shakedown matrix gates npm publish, not this RFC.

**Single first implementation task after approval:** PR1's smallest core — in `bin/archon-setup.mjs` + `runUpdate.mjs`, resolve required checks from the target and refuse `auto` mode when empty. It is ~30 lines, immediately converts the loop's biggest silent assumption into a loud, tested refusal, and everything else in PR1 builds on its plumbing.

**What should NOT be handed to a frontier model yet:** auto-merge enablement decisions and rollback execution (until PR1/PR2 land, both rest on unverified assumptions); any distribution category beyond `agents`; skill installation/promotion (F is read-only for a reason); and editing the contracts themselves — the enum-pinning and fail-closed validator are the system's immune system, and a helpful model "improving" a schema is exactly the failure mode they exist to stop.
