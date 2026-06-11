# Fable Review — Agent OS v0.1 Audit (2026-06-11)

**What this is:** the single copy-paste prompt for a read-only Claude Fable 5 audit of the
archon-setup "Agent OS" v0.1 loop, plus the operator pre-run checklist. This file is the source
of truth — paste the fenced prompt into Fable, after completing the checklist.

**Repo under review:** `ArchonVII/archon-setup` — local main checkout `C:\GitHub\archon-setup`
(HEAD `e6adb60` as of 2026-06-11). This is the ecosystem integrator and the home of the contracts.

> This is a review-process doc, not part of the system under review. It is intentionally NOT in
> the prompt's read-list, so Fable will not audit its own prompt.

---

## Before you run (status 2026-06-11)

**The repo is clean and ready. Your only step:** open Fable with its working directory set to
`C:\GitHub\archon-setup` and paste the prompt below. Everything mechanical is already done.

- **The whole loop is on `main`, nothing in flight.** M3 (issue #159) and M6 — the e2e gate
  (PR #181, squash commit `e6adb60`) — are both merged. There are no conflicting or open PRs in
  the loop's path for Fable to trip over.
- **Test evidence is captured.** The full suite is green on the merged head (431 tests, 429 pass,
  0 fail, 2 skipped) locally, and `Node CI` ran Install + Test = success on the merge. The 15-case
  shakedown (`docs/testing/shakedown/PHASE2-RUNBOOK.md`) is the npm-publish gate, not a
  prerequisite for this audit.
- **Skill catalog for Deliverable F.** Fable reads `C:\Users\josep\skills\docs\skill-catalog.md`
  + `skills-policy.md`. If your Fable session can reach outside the repo, no action; if it's
  sandboxed, the review brief carries the needed excerpt.
- **Secrets.** Nothing to do — none live in the repo tree. Just don't paste a token or `.env` into
  the chat (Fable is cloud + 30-day retention, $10/M-in / $50/M-out).

---

## The prompt

```text
You are auditing and hardening a MID-BUILD agent-operations system ("Agent OS"). You are NOT
designing a greenfield system, and you are NOT implementing code in this pass.

PRIMARY GOAL
Produce a read-only RFC that (1) verifies the current state of the existing Agent OS v0.1 loop,
(2) finds where the merged code and the merged contracts disagree, (3) red-teams the trust gaps,
and (4) proposes the smallest PR sequence to close the loop to a trustworthy v0.1.

PRIORITY — read before allocating effort
Deliverables C (code/contract disagreements) and D (failure-mode red-team) are the point of this
review; spend disproportionate depth there — they are what justifies a frontier model. A, B, and
E are scaffolding: cross-reference rather than restate, and compress them first if output budget
is constrained. NEVER truncate findings to fit. If you approach output/context limits or hit a
refusal/fallback, prioritize C and D and explicitly list what you did NOT cover — do not silently
stop. Where evidence is missing, write "unverified," never "probably fine."

VERIFY FIRST, THEN REASON
Do not trust the state described below blindly — it is a set of claims to re-check, because the
repo may have changed since it was written. Re-read main, open PRs, schemas, fixtures, and the
prlane files before drawing conclusions.

PRE-RUN PACKET RULE
If docs/runtime-loop.md, src/contracts/README.md, or docs/reviews/2026-06-11-fable-review-brief.md
exist, treat them as ORIENTATION ONLY, not authority. A local agent wrote them to save you
reconstruction time; every material claim is tagged Verified / Assumption / Intent / Open question
/ Threat candidate. Verify every Verified/Assumption claim against source code, schemas, tests,
fixtures, PRs, or commits before relying on it. A disagreement between the packet and the code is
itself a finding (report it under C). Do not cite the packet as proof unless it points to a
verifiable repo artifact.

CONTEXT
- Repo under review: ArchonVII/archon-setup (local checkout C:\GitHub\archon-setup) — the
  ecosystem INTEGRATOR and the home of the contracts.
- ArchonVII/github-workflows, repo-template, and .github are downstream/shared-support repos.
- ArchonVII/jma-skill-review (local C:\Users\josep\skills) is the skill source: shared/ skills,
  docs/skills-policy.md, docs/skill-catalog.md.
- Role concepts: Issue-Admiral, Project-Captain, Open-Admiral, Project-Lieutenant, Release-Admiral.
- Intended loop:
  issue/task -> refresh audit -> decision doc -> ApplySet -> prlane execute in a temp worktree ->
  scoped edits -> run-state transitions -> verification evidence -> draft PR -> CI/validation ->
  auto-merge eligibility gate -> rollback or closeout -> Release-Admiral review.

STARTING ASSUMPTIONS TO VERIFY (do not trust without checking)
- archon-setup has merged contract schemas + golden fixtures, a refresh audit engine, a
  decision-doc/intake/issue-sync flow, and prlane runtime (autoMergeGate, ghPr, rollback,
  runRecord, runUpdate).
- M3 PR-lane execute (issue #159) and the M6 e2e gate (PR #181, squash e6adb60) are BOTH merged
  to main; the whole loop is on main with nothing in flight — verify.
- The contract/validator layer likely already exists: do NOT recommend rebuilding it unless you
  find a concrete failure it causes.
- WORKING HYPOTHESIS (verify or reject from code/contracts/tests — do not assume): agent-facing
  skill discovery wired into the existing ApplySet/run-state flow may be the highest-value missing
  v0.1 extension. If the evidence points elsewhere, design that instead.

READ FIRST (verify each is current)
- docs/ecosystem-overview.md ; docs/ecosystem-status.md ; docs/testing/shakedown/
- src/contracts/schemas/*.schema.json ; src/contracts/validate.mjs ; vocab.mjs ; run-states.json
- src/server/refresh/refreshRepo.mjs ; src/server/decisions/decisionDoc.mjs
- src/server/prlane/{autoMergeGate,rollback,runRecord,runUpdate,ghPr}.mjs
- src/snapshots/repo-template/scripts/pr-contract.mjs        (PR evidence/handoff validator - already enforced)
- src/snapshots/repo-template/templates/agent/agent.handoff.standard.md
- src/snapshots/repo-template/.agent/coordination/board.md   (claims = markdown board today, NOT a schema)
- any fixtures/tests proving contract behavior
- test/refreshPrLaneE2e.test.mjs (the merged M6 end-to-end gate — the loop's own proof)
FACTUAL NOTE to avoid false-gap findings: claims are a coordination-board convention, not a
schema; verification evidence and the PR handoff block are enforced by pr-contract.mjs, not by
JSON schemas. Decide whether to FORMALIZE them - do not report them as missing.

HARD CONSTRAINTS
- Begin with a directional review; do not jump straight into implementation design.
- Ask at most ONE blocking question, and only if it materially changes the contract design;
  otherwise proceed on an explicitly stated default assumption.
- Output an RFC + ordered PR sequence only. No multi-repo implementation in this pass.
- No platform rewrite; no parallel architecture. Build on what's merged.
- v0.1 executable scope = the smallest trustworthy loop; not every repo changes in v0.1.
- Prefer schema-first contracts and CI validation before any UI.
- All DB/cache/local artifacts stay outside tracked source or are explicitly gitignored.
- Every cross-repo mutation goes through a worktree, a claim, and a PR.
- Any model/API call carries a cost budget, retention note, and fallback path.
- Treat Windows path normalization as a first-class risk.
- Do not redesign merged contracts unless you can show a concrete failure they cause.
- You receive only public code/docs. No secrets, tokens, private cache, raw credentials,
  customer data, or sensitive local artifacts.

OUT OF SCOPE
jma-ui visual/UI work; the archon app fork (except where it touches the meta-layer); pigafetta;
proc-chem; full Skills Hub UI; automatic skill promotion/install in v0.1 unless explicitly
justified; npm publish mechanics unless they change the v0.1 trust boundary; multi-agent
autonomy beyond the one trustworthy loop.

DELIVERABLES

A - Verified current state (state table; do not repeat this status in B/C - cross-reference it)
Columns: component | status verified from repo | evidence path/file/PR/commit | confidence |
risk if stale. Cover at least: contract schemas; golden fixtures; contract validator; refresh
audit engine; decision-doc/intake/issue-sync; ApplySet; prlane execute; temp-worktree behavior;
run-state machine; run ledger/runRecord; PR create/update; auto-merge eligibility gate; rollback;
M6 e2e gate; shakedown matrix results (if present); skill catalog/policy source; the
claim/evidence/handoff conventions (pr-contract.mjs + coordination board).

B - Reconstructed control flow (reference A's status, don't restate it)
For each transition in the intended loop: producer | consumer | contract/schema involved |
persisted artifact | validation point | failure behavior | implemented / partial / missing.

C - Code/contract disagreement hunt  [HIGH PRIORITY]
Every place implementation behavior and contract/schema/run-state expectations disagree. For each:
file/path | schema/contract | observed behavior | expected behavior | why it matters |
severity (must-fix-v0.1 / should-fix-soon / later) | recommended fix shape | test that catches it.
Focus: run-state transitions; ApplySet shape/semantics; evidence fields; PR body/handoff-block
assumptions; rollback records; dirty-worktree handling; temp-worktree cleanup; path normalization;
event/run-ledger records; schema versioning; validator coverage.

D - Failure-mode red team  [HIGH PRIORITY]  (against the ACTUAL autoMergeGate/rollback/runRecord code + tests)
For each: current guard (if any) | missing guard | v0.1 required action | test fixture/CI check
that should prove it. The list below is MINIMUM coverage — add any additional failure modes you
find in the actual code paths, tests, schemas, or repo conventions. Cover at least:
dirty main or worktree; run interrupted mid-apply; stale temp worktree; stale claim; stale schema
version; Windows path normalization bug; path traversal / write outside the worktree; DB/cache/
local artifact accidentally tracked; secret-looking values copied into run ledgers; model-generated
PR body that passes text checks but lacks real evidence; Actions validate format but not semantic
truth; role-authority ambiguity (who may claim/release/promote/merge/rollback); human bypass after
a repo is created outside the baseline; duplicate/conflicting skills; prompt injection via
skill/tool metadata; model/API cost runaway; rollback claims success when main was not actually
restored; auto-merge gate treats partial evidence as complete.

E - Schema stability tiers
Classify every contract schema as: (1) freeze now, (2) stable core with replaceable adapter
fields, (3) provisional/may change before v0.1, (4) out of v0.1 scope. For each: producer |
consumers | versioning risk | backward-compat rule | fixture coverage | blocks v0.1? Cover
run-report, run-state-machine, decision-doc, apply-set, repo-refresh-report, operation-mapping,
and any claim/evidence/handoff schema if one exists. Mark each FIELD as required-now / optional-now
/ reserved-for-future.

F - The one design extension: skill discovery in the loop (DESIGN SKETCH only - read-only)
Design only the missing skill-discovery step as a v0.1-compatible extension to the EXISTING flow.
In v0.1, skill discovery is READ-ONLY SELECTION + EVIDENCE RECORDING - NOT automatic install or
promotion (those are later, authority-bound). Do not design the full Skills Hub UI; do not mutate
skill repos in v0.1. Answer: where in the flow does discovery occur; what inputs it takes (task,
decision doc, ApplySet, repo metadata, role); what source of truth it reads (skill-catalog);
the minimal skill-selection record; how the selection is recorded in the run ledger/evidence
(version/path/hash + why-selected rationale); how it resists prompt injection from skill metadata;
how it handles "no relevant skill found"; the fallback path if discovery fails; what CI must
validate and what CI cannot truthfully prove. Classify each element: required-for-v0.1 / deferrable
/ out-of-scope.

G - Documentation gaps (only those that block or materially improve the v0.1 audit)
The pre-run packet already created several of these — docs/runtime-loop.md, src/contracts/README.md,
the glossary, the current-state snapshot, and the threat checklist (in the review brief). Assess
whether each is ACCURATE against code and sufficient; then identify documentation that is STILL
missing (e.g. a generated run-state diagram). For each: why it matters | blocks v0.1? | accurate
as written? | minimal contents | owner | how to keep it from going stale.

H - PROPOSED PR sequence (pending human approval of A-F; implementation is a SEPARATE later pass)
Preferably 1-3 PRs, max 5 only if necessary. For each: repo | branch/worktree suggestion |
purpose | files likely touched | acceptance criteria | local test command | GitHub Actions test |
rollback plan | ordering (before/after which PR) | must-fix-v0.1 or later. Do not propose a PR for
anything already correctly implemented (M3 and M6 are merged); do not require all repos to change.

I - Final verdict
- Can this system be called Agent OS v0.1 after the proposed fixes?
- Minimum definition of done.
- What remains intentionally unsafe or manual (by design)?
- The single first implementation task after this RFC is approved.
- What should NOT be handed to a frontier model yet.

OUTPUT FORMAT
1. One-paragraph executive verdict
2. Verified state table (A)
3. Control-flow reconstruction (B)
4. Code/contract disagreement findings (C)
5. Failure-mode red-team table (D)
6. Schema stability tiers (E)
7. Skill-discovery v0.1 design sketch (F)
8. Documentation gaps (G)
9. Proposed PR sequence (H)
10. Final definition of done (I)

TONE
Direct and skeptical. Prefer concrete repo evidence over architectural speculation. "Unverified"
beats "probably fine." Build on what's merged; recommend new work only where you can point at a
concrete failure or a genuine gap.
```
