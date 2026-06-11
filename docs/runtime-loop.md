# Runtime Loop — the Agent OS v0.1 control flow (for agents)

The **dynamic** companion to [`docs/ecosystem-overview.md`](./ecosystem-overview.md) (which maps the
repos statically). This walks the prlane/refresh/contracts loop hop by hop, from an audit finding
through a merged-and-verified managed-region change, and back out through rollback. For *who is
authorized to make any of it happen* — the `gh` token as the sole trust anchor, and why the
confirmation phrase is scope rather than authentication — see
[`docs/authority-model.md`](./authority-model.md).

> **Orientation only — verify before relying on it.** A local agent wrote this to save a reviewer
> reconstruction time. Every material claim is tagged. Re-check anything tagged `[V]`/`[ASSUME]`
> against the cited source before treating it as true; a disagreement between this doc and the code
> is itself a finding.

**Evidence tags**
- `[V file:line]` — verified against source on 2026-06-11 (HEAD `e6adb60`).
- `[ASSUME]` — inferred from contracts/imports, not directly read end-to-end.
- `[INTENT]` — claimed/desired behavior, not asserted as implemented; confirm against code.
- `[OPEN]` — a genuine ambiguity worth verifying. Not a conclusion.

---

## Mental model

The loop has **one forward path** and **two ways out**:

1. **Audit (M1)** — `refreshRepo()` reconciles one repo's managed regions against the central
   catalog and projects every finding through a deterministic golden table into a
   `RepoRefreshReport`. `[V src/server/refresh/refreshRepo.mjs:151-220]`
2. **Decide (M2)** — the report becomes a `DecisionDoc` (canonical JSON) where each item gets a
   human/agent `resolution`; intake resolves that into an `ApplySet`. `[ASSUME` — DecisionDoc/intake
   read at contract level only; see `src/server/decisions/decisionDoc.mjs`, `intake.mjs`]`
3. **Execute (M3)** — `runUpdate()` applies the `ApplySet` in a throwaway worktree, audits it,
   commits, pushes, opens a PR, and (in `auto` mode) queues auto-merge behind the eligibility gate.
   `[V src/server/prlane/runUpdate.mjs:195-448]`
4. **Verify / close / roll back (M4)** — after merge, `verifyMergedRun()` re-audits the merge commit;
   `cleanupRun()` retires the worktree/branch; `rollbackRun()` reverts **via a PR**, never by
   mutating `main`. `[V src/server/prlane/rollback.mjs:275-691]`

Every step appends one transition to an **append-only JSONL run ledger**, and the legal transitions
are machine-enforced. The ledger is the spine; the contracts are the seams between steps.

**Reconcile-by-audit is the core invariant:** the audit (M1), the post-apply check (M3), and the
post-merge check (M4) all call the *same* `distributeRepo(mode:"audit")` + operation-mapping
projection, so "is this region clean?" has exactly one definition everywhere.
`[V refreshRepo.mjs:179]` `[V runUpdate.mjs:336-344]` `[V rollback.mjs:252-273]`

---

## The run-state machine

The authoritative source is [`src/contracts/run-states.json`](../src/contracts/run-states.json) (21
states). `runRecord.mjs` loads it and **enforces** every append: known state, required fields
present, `runId`/`baseSha` consistency, legal transition, and "terminal may only go to
`rollback_requested`." `[V src/server/prlane/runRecord.mjs:43-70]`

```
                      planned
                         │
                  preflight_started
                         │
                  preflight_passed
                    │          │
              issue_created    │
                    │          │
                 worktree_created
                         │
                      applied
                         │
                   verified_local        ── (mode=local-only stops here)
                         │
                      committed
                         │
                       pushed
                         │
                    pr_created            ── (mode=pr-only stops here)
                         │
                   checks_pending         ── (gate ineligible → stops here)
                         │
                    merge_queued
                         │
                       merged
                         │
                   verified_merged
                         │
                     cleaned_up  ◄── terminal
                         │
   (any merged/verified/cleaned/failed) ─► rollback_requested
                         │
              ┌──────────┴───────────┐
        rollback_pr_created   rollback_verified ◄── terminal (already-reverted shortcut)
              │
        rollback_merged
              │
        rollback_verified ◄── terminal

  Wildcards: any non-terminal ─► failed (terminal).  [V run-states.json:79-91]
             any pre-merge non-terminal ─► aborted (terminal).
```

Each state declares the fields it `requires` (e.g. `pr_created` requires
`runId,baseSha,branch,headSha,prNumber`); `runRecord.mjs` rejects an append missing any of them.
`[V run-states.json:7-53]` `[V runRecord.mjs:17-26,49-50]`

**Terminal rule:** a terminal state may transition *only* to `rollback_requested` — post-merge
regression reopens a settled run through the rollback chain, never through retry.
`[V run-states.json:5]` `[V runRecord.mjs:64-66]`

---

## Forward path, hop by hop (`runUpdate.mjs`, M3)

Each row: the transition, what guards it, and how it fails. All line refs are
`src/server/prlane/runUpdate.mjs` unless noted.

| → state | Guard / action before the append | Failure behavior |
| --- | --- | --- |
| `planned` | ApplySet validated against `apply-set.schema.json`; throw on invalid. `[V :208-212]` | throw before any side effect |
| `preflight_started` | — `[V :230]` | catch → `failed` `[V :444-447]` |
| (within preflight) | **confirmation phrase** hash must match `guards.requiredConfirmationPhraseHash` `[V :232-244]`; **path allowlist** per item: reject absolute, reject `..` traversal, must match `allowedPathPatterns` `[V :31-41,246]`; catalog↔ApplySet id/target match `[V :247]`; target toplevel name == repo, current branch == default, **worktree clean**, `origin/default`==`baseSha`, `HEAD`==`baseSha` `[V :249-272]` | throw → `failed` with `failedStage` |
| `preflight_passed` | all preflight guards passed `[V :274-275]` | — |
| `issue_created` | `sourceDecisionDoc.issueNumber` present (required for PR execution) `[V :277-283]` | throw if missing in non-local mode |
| `worktree_created` | new branch `agent/refresh/<runId>-<suffix>` + worktree under sibling `.archon-prlane-worktrees/` from `origin/default` `[V :285-300]` | catch → `failed`; `cleanup` removes worktree+branch if no PR yet `[V run-states.json:16]` |
| `applied` | `distributeRepo(mode:"apply")` for selected catalog ids; **throw if any file is `failed`/`conflict`/`adoption_needed`** `[V :309-325]`; keep-local items write `.archon/region-ownership.json` `[V :96-122,326]` | throw → `failed` |
| `verified_local` | `refreshRepo()` audit of the worktree; **`postApplyAuditClean` requires every non-ownership item `clean_apply` & `changed:false`** else throw `[V :336-344]` | throw → `failed`. *(mode `local-only` returns here `[V :363]`)* |
| `committed` | `git add` only the ApplySet's changed paths, commit `feat(agents): apply refresh <runId>`; throw if nothing to commit `[V :365-373]` | catch → `failed` |
| `pushed` | `git push -u origin <branch>` `[V :383]` | catch → `failed` |
| `pr_created` | `createDraftPr` (draft unless `auto`) + label `automated-distribution` `[V :394-403]` | catch → `failed`. *(mode `pr-only` returns here `[V :414]`)* |
| `checks_pending` | `listPrChecks`; resolve the **required-check set** (an explicit set wins, else from the target's live branch protection via `resolveRequiredChecks`, recorded in the ledger as `requiredChecks*`); then **`evaluateAutoMergeEligibility`** against the PR's *actual* labels/body (`getPrView`) and the real post-apply audit, with `requireConfiguredChecks:true`. **If not eligible — including an empty resolved set (`no-required-checks-configured`) — the run STOPS here and returns** `[V :416-470]` | not a failure — a deliberate hold; the CLI exits 20 |
| `merge_queued` | only if eligible → `queueAutoMerge` (`gh pr merge --auto`) `[V :435-443]` | catch → `failed` |

`merged` / `verified_merged` / `cleaned_up` are **not** reached inside `runUpdate`; they are appended
later by the M4 commands once GitHub actually merges the PR. **Resolved (#186, C6):** `verifyMergedRun`
appends `merged` if it isn't already present, and the transition is legal from `merge_queued`,
`checks_pending`, **and** `pr_created` `[V run-states.json]` — a human merging a held (gate-ineligible
or pr-only) run is stamped `mergedBy:"manual"` in the ledger and is post-merge verifiable like any
auto-merge. The auto-merge→`merged` handoff stays pull-based: nothing watches GitHub; the next
`verify-merged` invocation records it.

### The eligibility gate (`autoMergeGate.mjs`)

`evaluateAutoMergeEligibility` is a **pure function**: eligible **iff zero reasons accumulate**.
`[V src/server/prlane/autoMergeGate.mjs:48-111]` Reasons checked:

- ApplySet fails its schema → immediately ineligible. `[V :59-62]`
- `sha256(confirmationPhrase)` ≠ `guards.requiredConfirmationPhraseHash`. `[V :64-66]`
- `guards.allowAutoMerge` false. `[V :67-69]`
- any item category ∉ `allowedCategories` (default `["agents"]` only). `[V :11-14,71-77]`
- any item path ∉ `guards.allowedPathPatterns`. `[V :78-80]`
- any item `resolution` is `merge-manual` or `defer` (unresolved). `[V :81-83]`
- `conflictAutoResolved` true. `[V :86]`
- PR missing the `automated-distribution` label. `[V :88-91]`
- PR body missing the decision-doc fingerprint, or missing the issue link. `[V :93-99]`
- with `requireConfiguredChecks` (set by `auto` mode), an **empty** required-check set →
  `no-required-checks-configured` (auto refuses rather than delegate merge safety to unverified
  branch protection). `[V autoMergeGate.mjs]`
- any `requiredChecks` entry missing or not passing — `checkPassed` accepts only real terminal-success
  shapes (`bucket:"pass"` / `conclusion:"success"`), **not** a bare `completed`/`ok`. `[V :35-41,~101-110]`
- `postApplyAudit.clean !== true` — fed the **real** audit result by `runUpdate`. `[V autoMergeGate.mjs]`

**Resolved (#185).** The production gate in `runUpdate` now evaluates the PR's *actual* GitHub state —
labels and body fetched via `getPrView` — together with the real post-apply audit result
(`postApplyAudit:{clean}`) and the resolved required-check set, instead of synthetic inputs. The
required set is resolved at execute time from the target's live branch protection
(`resolveRequiredChecks`, fail-closed: missing/unreadable protection ⇒ empty set), recorded in the
`checks_pending` ledger entry, and `auto` mode **refuses** (stops at `checks_pending`, CLI exit 20)
when it is empty. The earlier preflight gate call survives only to surface
`confirmation-phrase-mismatch` (PR-independent); the genuine post-apply protection remains the
upstream *throw*, with the gate's audit leg now fed the real value rather than a literal.

---

## The two ways out (`rollback.mjs`, M4)

- **`verifyMergedRun`** — fetch `origin/default`, resolve `mergeSha` **from the PR itself**
  (`getPrMergeState` → `gh pr view --json state,mergeCommit`); when the PR cannot supply a merge
  commit, fall back to the head of `origin/default` **and record
  `mergeShaSource:"assumed-origin-head"` in the ledger** — the fallback is never silent (#186, C5).
  Append `merged` if needed (manual merges of held runs stamped `mergedBy:"manual"` — C6), then
  re-audit the **merge commit** inside a *detached* throwaway worktree (`refreshAtCommit` →
  `withDetachedWorktree`). If `postApplyAuditClean` holds → `verified_merged`; else → `failed`
  (`PostMergeVerificationError`, `safeNextAction: run rollback`). Idempotent. `[V :275-393]`
- **`cleanupRun`** — **refuses from `merge_queued`/`merged`** before any delete (`refused:true` +
  `safeNextAction`: verify-merged first, or rollback — #186, C7). Otherwise remove worktree + local
  branch + remote branch, sweep local rollback artifacts when the ledger records them (C11), and
  close the PR if there was no merge — `runGh` now defaults to the real gh runner, so the CLI path
  actually closes PRs (C3). Append `cleaned_up` (from `verified_merged`) or `aborted` (pre-merge).
  `[V :427-499]`
- **`rollbackRun`** — if no `mergeSha` → delegates to cleanup. Else append `rollback_requested`,
  fetch default; **if affected paths already match the recorded base** → `rollback_verified`
  (`alreadyReverted`, no duplicate PR) `[V :700-744]`; otherwise create a rollback worktree/branch
  from `origin/default`, `git revert` (with `-m 1` for merge commits), verify the reverted tree
  matches base for affected paths, push, open a revert PR + label, append `rollback_pr_created`.
  Conflict or tree-mismatch before the push → `failed` (`RollbackConflict`/`RollbackTreeMismatch`)
  with the unpushed rollback worktree + local branch removed and recorded on the failure entry
  (#186, C11). **Re-entry at `rollback_pr_created` closes the loop (C12):** query the revert PR via
  `getPrMergeState`; merged → append `rollback_merged`, re-verify affected paths against fresh
  `origin/default` → `rollback_verified` (mismatch → `failed`/`RollbackTreeMismatch`); not merged →
  idempotent hold with guidance. `[V :603-676]` **The lane never auto-merges its own revert PR, and
  `main` is never mutated directly — rollback always goes through a PR.** `[V :678-838]`

---

## Where state lives

| Artifact | Location | In repo tree? | Ref |
| --- | --- | --- | --- |
| Run ledger (JSONL, one file per run) | `~/.claude/archon-prlane-runs/<runId>.jsonl` | **No** (home dir) | `[V rollback.mjs:24-30]` |
| Throwaway exec/verify worktrees | sibling `<parent>/.archon-prlane-worktrees/` | **No** (sibling of target) | `[V runUpdate.mjs:286]` `[V rollback.mjs:232-234]` |
| Keep-local ownership records | `.archon/region-ownership.json` | **Yes** (committed) | `[V runUpdate.mjs:100]` `[V refreshRepo.mjs:121-149]` |
| `.archon/events.jsonl` status stream | repo `.archon/` | **Yes** | `[ASSUME]` (lane D; not re-read this session) |

The run ledger and worktrees being outside the tree is the mechanism behind the "no DB/cache in
tracked source" guard — worth confirming nothing writes ledger/worktree content back into the repo.

---

## Loop glossary

- **RepoRefreshReport** — one repo's per-category audit, each finding projected to an `Operation`.
  Contract: `src/contracts/schemas/repo-refresh-report.schema.json`.
- **DecisionDoc** — canonical-JSON audit + per-item `resolution` (`apply-central`/`keep-local`/
  `merge-manual`/`defer`) + review bundle. Contract: `decision-doc.schema.json`.
- **ApplySet** — the resolved, guarded execution plan handed to the PR lane: items + `guards`
  (`allowAutoMerge`, `allowedPathPatterns`, `requiredConfirmationPhraseHash`). Contract:
  `apply-set.schema.json`.
- **RunReport** — the rendered status of a run at a point in time (state, results, verification
  gates, rollback command). Contract: `run-report.schema.json`.
- **Operation** — the "atom of trust": `{action, currentState}` a raw distributor status maps to,
  via the deterministic `operation-mapping` golden table.
- **run-state** — one of the 21 ledger states; transitions enforced by `run-states.json`.
- **eligibility gate** — `evaluateAutoMergeEligibility`, the pure pass/fail that guards auto-merge.

See [`src/contracts/README.md`](../src/contracts/README.md) for the per-schema detail and the closed
vocabularies (`src/contracts/vocab.mjs`).
