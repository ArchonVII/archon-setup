# Fable Review Brief — Agent OS v0.1 (2026-06-11)

Read this first. It is an **orientation index**, not an analysis or an answer key. It points you at
the verified state and the open questions; the conclusions are yours to produce.

Repo: `ArchonVII/archon-setup`, local `C:\GitHub\archon-setup`, `main` HEAD `e6adb60` (2026-06-11).
Companion docs: [`docs/runtime-loop.md`](../runtime-loop.md) (control flow) and
[`src/contracts/README.md`](../../src/contracts/README.md) (the seams).

## How to use this packet

1. Skim this brief for the map and the open questions.
2. Read `docs/runtime-loop.md` then `src/contracts/README.md` for the hop-by-hop loop and the seams.
3. **Verify before relying.** Everything here is tagged; re-check `[V]`/`[ASSUME]` against the cited
   source. A packet-vs-code disagreement is a finding (Deliverable C).
4. Spend your depth on the prompt's Deliverables **C** (code/contract disagreements) and **D**
   (red-team). This packet exists to buy you that time, not to pre-answer them.

## Evidence labels (used across all three packet docs)

| Tag | Meaning |
| --- | --- |
| `[V file:line]` | Verified against source on 2026-06-11. |
| `[ASSUME]` | Inferred from contracts/imports; not read end-to-end. Treat as a claim to verify. |
| `[INTENT]` | A proposed reading (e.g. a stability tier). **Not** authoritative — confirm or reject it. |
| `[OPEN]` | A genuine ambiguity to resolve. Not a conclusion. |
| `[THREAT]` | A candidate failure mode needing red-team. Minimum coverage, not the full universe. |

## Current-state snapshot (claims to verify, not authoritative state)

| Component | Status | Evidence | Label |
| --- | --- | --- | --- |
| 6 contract schemas | merged, on `main` | `src/contracts/schemas/*.schema.json` | `[V]` |
| Zero-dep fail-closed validator | merged | `src/contracts/validate.mjs:55-61,148-161` | `[V]` |
| Closed vocabularies | merged | `src/contracts/vocab.mjs:1-47` | `[V]` |
| 21-state run-state machine | merged | `src/contracts/run-states.json` | `[V]` |
| Run ledger (JSONL, transition-enforced) | merged | `src/server/prlane/runRecord.mjs:43-70` | `[V]` |
| Forward execute (M3) | merged | `src/server/prlane/runUpdate.mjs:195-448` | `[V]` |
| Refresh audit engine (M1) | merged | `src/server/refresh/refreshRepo.mjs:151-220` | `[V]` |
| Eligibility gate | merged | `src/server/prlane/autoMergeGate.mjs:48-111` | `[V]` |
| Verify / cleanup / rollback (M4) | merged | `src/server/prlane/rollback.mjs:275-691` | `[V]` |
| M3 PR-lane (issue #159) | merged | `gh issue view 159` = CLOSED | `[V]` |
| M6 e2e gate (PR #181) | merged | squash `e6adb60`; `test/refreshPrLaneE2e.test.mjs` | `[V]` |
| DecisionDoc / intake (M2) | merged | read at contract level only | `[ASSUME]` |
| `ghPr.mjs` (createDraftPr/listPrChecks/queueAutoMerge) | merged | imports verified; body not read | `[ASSUME]` |
| PR evidence/handoff validator | present | `src/snapshots/repo-template/scripts/pr-contract.mjs` | `[ASSUME]` (not re-read this session) |
| Claims | convention, **not a schema** | `src/snapshots/repo-template/.agent/coordination/board.md` | `[V]` |
| Shakedown 15-case matrix | **not run** | `docs/testing/shakedown/PHASE2-RUNBOOK.md` is the runbook | `[OPEN]` |

### Local work NOT on `main` (do not treat as system behavior)

- Worktree `C:\GitHub\archon-setup-160-rollback-cleanup`, branch
  `agent/codex/160-rollback-post-merge-cleanup` @ `551cfbd` ("fix(prlane): harden rollback cleanup")
  — **a commit that is not on `main` and has no open PR.** Verified via `git worktree list` +
  `git log` (2026-06-11). It may harden the same `rollback.mjs` reviewed above; inspect it only if
  asked to assess a proposed future fix, not as current behavior. `[V]`

## Open questions already spotted (verify; not conclusions)

- The eligibility gate's `post-apply-audit-not-clean` branch may be dead in `runUpdate`: both gate
  calls hard-code `postApplyAudit:{clean:true}` `[V runUpdate.mjs:241,431]`, while the real guard is
  the upstream throw `[V :344]`. Is the gate branch load-bearing anywhere? `[OPEN]`
- The `merge_queued → merged` handoff is event-driven (`gh pr merge --auto`); `verifyMergedRun`
  back-fills `merged` if absent `[V rollback.mjs:296-314]`. Trace who advances it in practice. `[OPEN]`

## Threat checklist — MINIMUM coverage (add any you find; status starts `unverified`)

Each item: confirm the current guard against the cited code, then mark real/guarded/gap.

- [ ] dirty target worktree blocks execution — guard at `[V runUpdate.mjs:257-258]`; `unverified`
- [ ] base-SHA drift (origin/HEAD ≠ ApplySet base) — guard at `[V runUpdate.mjs:260-272]`; `unverified`
- [ ] path traversal / write outside allowlist — guard at `[V runUpdate.mjs:31-41,246]`; `unverified`
- [ ] run interrupted mid-apply — recovery via `failed` + `safeNextAction`; `unverified`
- [ ] stale temp worktree cleanup — `withDetachedWorktree` finally `[V rollback.mjs:244-249]`; `unverified`
- [ ] rollback claims success without restoring main — `RollbackTreeMismatch` `[V rollback.mjs:640-650]`; `unverified`
- [ ] rollback mutates main directly — claimed PR-only `[V rollback.mjs:652-662]`; `unverified`
- [ ] auto-merge gate treats partial evidence as complete — gate reasons `[V autoMergeGate.mjs:48-111]`; `unverified`
- [ ] secret-looking values in run ledger — ledger at `~/.claude/...` `[V rollback.mjs:24-30]`; `unverified`
- [ ] Windows path normalization bug — `patternAllows` normalizes `\`→`/` `[V autoMergeGate.mjs:20-29]`; `unverified`
- [ ] schema-version drift across repos — every schema `schemaVersion:1`; `unverified`
- [ ] stale claim (markdown board) — no machine guard known; `unverified`
- [ ] role-authority ambiguity (who may claim/merge/rollback) — no schema exists; `unverified`
- [ ] PR body passes text checks but lacks real evidence — `bodyIncludesIssue`/fingerprint `[V autoMergeGate.mjs:43-99]`; `unverified`
- [ ] prompt injection via skill/tool metadata — relevant once skill discovery exists; `unverified`
- [ ] human bypass after a repo is created outside the baseline — `unverified`

## Deliverable F source (skill discovery)

The skill catalog is **not inlined here** (not read this session). Source:
`C:\Users\josep\skills\docs\skill-catalog.md` + `C:\Users\josep\skills\docs\skills-policy.md`
(`ArchonVII/jma-skill-review`). If your Fable session is sandboxed to `archon-setup`, paste those two
files — their skill-entry shape is what F's minimal skill-selection record must reference. Keep F a
**design sketch**: read-only selection + evidence recording in v0.1, **not** install/promotion.
