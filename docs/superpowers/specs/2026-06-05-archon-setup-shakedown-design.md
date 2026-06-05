# archon-setup Release Shakedown — Design Spec

- **Date:** 2026-06-05
- **Status:** Draft for review
- **Tracking issue:** ArchonVII/archon-setup#109
- **Related:** #107 / #108 (publish held for testing), `project_deploy_readiness_sweep` memory

## 1. Goal & non-goals

**Goal.** Before `@archonvii/archon-setup` is published, produce *behavioral* evidence that every
scaffolded hook/skill/process actually fires in a generated repo — generated files, local git hooks,
agent-lifecycle scripts, GitHub Actions gates, repo governance, the doc/update lifecycle, and the
human-readable audit path. Unit tests (218/218) prove the planner/executor logic; this harness proves
the *product* works end-to-end against real GitHub.

**Secondary goal.** Make it reusable: the harness (issue bodies, prompt pack, results matrix) is
committed to archon-setup so it becomes a repeatable pre-publish release gate, not a one-shot.

**Non-goals.**

- Browser-wizard UX testing — owned by a separate agent (see §10). This harness covers *runtime
  behavior after generation*.
- Publishing. The publish stays deferred until the shakedown passes and the release is re-cut.
- Exhaustive coverage of every foundation file (README/LICENSE/.gitignore are trivially confirmable
  and folded into the fresh-install test, not given dedicated issues).

## 2. Strategy: three lab repos, not one

A single repo can't be both a clean baseline and a messy upgrade target. Use three throwaway repos
under **ArchonVII** (org-level fidelity: real rulesets, CODEOWNERS, labels). All three are
disposable and deleted/archived after the sweep (they join the existing smoketest-cleanup concern —
see §12).

### 2.1 `ArchonVII/archon-setup-lab-fresh` — golden happy-path

Created **by dogfooding archon-setup's own onboard** with the full shakedown feature set. Repo
creation *is* Test #0. Keep it pristine (no hand-added weird files) so it proves default install
behavior. Exercises: headless dry-run, real write, manifest, initial commit, hook install, baseline
workflows, labels, branch protection, required-gate first-run + `tighten-required-gate`.

Feature set:

```
foundation.*            remote.github           remote.labels
remote.branch-protection
agent-workflow.check-map  agent-workflow.coordination-board  agent-workflow.anomaly-triage
workflow.pr-policy  workflow.semantic-pr-title  workflow.pr-body-autoinject  workflow.branch-naming
workflow.required-gate  workflow.node-ci
agent-lifecycle.baseline  agent-workflow.doc-sweep  agent-workflow.doc-orphan-detector
```

(`workflow.node-ci` added so the required-gate's `language-ci` route has a real check to run.)

### 2.2 `ArchonVII/archon-setup-lab-lived-in` — deliberately messy existing repo

Hand-seeded with realistic cruft, then run through the **existing-repo audit → apply** path. Tests
that onboarding inspects existing instructions/automation/hooks/local-tool-state and folds useful
facts forward rather than blind-overwriting. Pre-seed:

```
README.md                         # real project facts worth preserving
CLAUDE.md / AGENTS.md             # duplicate/stale partial process
.github/workflows/ci.yml          # bespoke old CI
.github/PULL_REQUEST_TEMPLATE.md  # incomplete PR body
.github/CODEOWNERS                # nonstandard owner
.githooks/pre-commit              # stale/repo-specific hook
.agent/check-map.yml              # drifted check map
.claude/ , .codex/                # local tool notes
docs/runbook.md                   # useful repo-specific commands
docs/process/old-agent-flow.md    # stale process
package.json                      # actual scripts
```

### 2.3 `ArchonVII/archon-setup-lab-pr-contract` — tiny onboarded Node repo

Minimal real Node repo used only for intentionally good/bad PRs:

```
package.json   # scripts: lint = node --check src/math.js ; test = node --test "test/*.test.mjs"
src/math.js    test/math.test.mjs    docs/usage.md    README.md
```

Reset/archive/delete after the PR-contract sweep.

## 3. Verified interface facts (corrections folded in)

These were checked against `src/snapshots/**` on 2026-06-05; the test bodies must use these, not the
summaries:

1. **Lifecycle (`scripts/agent/*`):** `agent:start-task -- <issue> [--agent <name>] [--slug <slug>]`,
   `agent:status`, `agent:prune` are the three npm entries; `lib.mjs` is a shared lib. `DEFAULT_AGENT`
   is **`codex`** → pass `--agent claude` for claude branches. `start-task` requires an **OPEN issue +
   `gh`**, makes the worktree at `../<repo>-<issue>-<slug>`, and writes gitignored
   `.agent/current-task.json`. `agent:close-preflight` / `agent:pr-ready` are **separate** wrappers.
2. **`pre-commit` has two guards:** (a) primary-checkout-on-feature-branch is blocked (override
   `ALLOW_PRIMARY_FEATURE_COMMIT=1`, audit-logged to `.agent/bypass.log`); (b) direct commits to
   `main`/`master` are blocked **except** the Owner-Maintenance Lane (add-only safe paths:
   docs/research, docs/notes, docs/assets, images, `.changelog`) (override `ALLOW_MAIN_COMMIT=1`).
   A `commit-msg` hook also requires an issue ref unless the subject is `docs(owner):`/`chore(owner):`.
   Hooks must be installed first via `.githooks/scripts/install-githooks.sh` (sets `core.hooksPath`).
3. **doc-sweep:** CLI `node scripts/doc-sweep/sweep.mjs --repo <path> [--apply] [--owner]
   [--allow-main-commit] [--issue <ref>]`. Report mode (no `--apply`) returns buckets
   `eligible/leaveLog/skip/surfaceOnly`. **Apply uses `gitleaks` and fails closed (no commit) if
   gitleaks is not installed.** Apply is lane-aware: primary-default needs `--owner`; worktree lane
   commits only when an **open PR** tracks the branch. The allow-list (`isSweepable`) excludes
   code/scripts/`.github`/governance/manifests/Docusaurus — code/CI/hooks/AGENTS/README/package/tool
   dirs are never swept.
4. **anomaly-triage:** reads `.archon/anomalies-thispr.md` from the PR branch; related entries →
   sticky PR review comment, unrelated → new issue. **The exact entry field format lives in the
   reusable workflow body**, not the caller snapshot — pull the canonical format from
   `ArchonVII/github-workflows` (or repo-template AGENTS.md) before writing issues #11/#12. Triggers
   on `[opened, ready_for_review, synchronize]`.
5. **pr-body-autoinject:** triggers on **`opened` only**. The "doesn't overwrite on re-run" case can't
   fire via synchronize — reframe issue #9 to *empty body at open → injected*.
6. **check-map routing:** `docs/**`,`**/*.md` → `requires: []` (low-cost path); code (`src/lib/bin/
   scripts/test`, `*.js/.mjs/.ts/.py`) → `language-ci`; `.github/workflows/**`+`.githooks/**` →
   `workflow-validation`; policy (`AGENTS/CLAUDE/GEMINI`, `.agent/**`, `.github/**`) →
   `policy-validation`; deps (`package.json`, lockfiles) → `dependency-review`+`language-ci`; release
   (`CHANGELOG.md`,`.changelog/**`) → `policy-validation`. The single required check is
   `repo-required-gate / decision`. semantic-pr-title / branch-naming / pr-policy are **separate**
   checks — baseline branch protection defers *named required* checks until first run, so a negative
   test's "fail" means the check goes red, not necessarily a hard merge-block.

## 4. Test matrix (15 issues)

| # | Repo | Capability | Type | Primary pass signal |
|---|------|-----------|------|---------------------|
| 1 | fresh | Fresh install happy path | happy | baseline files + manifest + labels + protection; required-gate appears; tighten succeeds |
| 2 | lived-in | Existing-repo audit (read-only) | happy | correct present/missing/drifted; no writes |
| 3 | lived-in | Existing-repo apply/reconcile | happy | useful facts preserved, stale policy replaced, machine paths dropped; update-log records |
| 4 | pr-contract | pre-commit guard (primary checkout + owner lane) | negative | feature commit in primary blocked; owner add-only docs allowed |
| 5 | pr-contract | Agent lifecycle scripts | happy | start-task makes correct worktree/branch; status reports; prune skips dirty/unmerged |
| 6 | pr-contract | branch-naming gate | negative | bad branch → check red; rename → green |
| 7 | pr-contract | semantic-pr-title gate | negative | bad title → red; Conventional title → green |
| 8 | pr-contract | pr-policy body contract | negative | missing sections/issue-link → red; fixed → green |
| 9 | pr-contract | pr-body-autoinject | happy | empty body at open → template injected |
| 10 | pr-contract | required-gate path routing | happy | docs-only=low-cost; code=language-ci; workflow=workflow-validation; matches check-map |
| 11 | pr-contract | anomaly-triage (related) | happy | related entry → sticky PR comment; idempotent on re-run |
| 12 | pr-contract | anomaly-triage (unrelated) | happy | unrelated entry → new issue w/ backlink; no dupes |
| 13 | pr-contract | doc-sweep recovery | happy | report buckets correct; apply commits only allow-listed safe docs (gitleaks present); unsafe left |
| 14 | pr-contract | close-preflight wrapper | negative | malformed draft blocked by close-preflight; fixed → pr-ready marks ready; no raw `gh pr ready` |
| 15 | pr-contract | managed update drift | happy | `update --check` flags drift (exit≠0); `update` preserves custom inputs; `update --upgrade` replaces |

Full issue bodies (with the §3 corrections applied) live in `docs/testing/shakedown/issues/01..15-*.md`.

## 5. Deliberate PR set (pr-contract repo)

| PR | Purpose | Expected first | Expected final |
|----|---------|---------------:|---------------:|
| `test(pr-contract): happy path smoke` | all gates pass | Pass | Merged |
| bad branch name | branch-naming | Fail | renamed → pass |
| `update stuff` (bad title) | semantic-pr-title | Fail | retitled → pass |
| missing body | pr-policy | Fail | sections+evidence+link → pass |
| empty body | autoinject | body injected at open | pass after evidence |
| docs-only typo | doc-only exception | minimal ceremony | pass |
| code w/o test evidence | close-preflight | wrapper blocks | evidence added → ready |

Keep them tiny — the value is the workflow behavior, not the code.

## 6. Prompt pack

Five reusable prompts in `docs/testing/shakedown/prompts/`, designed to stop agents from "helpfully"
over-repairing: **general shakedown**, **negative-control** (intentionally create the invalid
condition, confirm the guard fails, repair only that, confirm it passes — never bypass), **existing-
repo reconciliation** (treat existing files as evidence not authority; PR body carries a
file/signal/decision/reason table), **off-task anomaly** (record, don't fix), **closeout** (run
required verification, update PR body + update-log, then `agent:close-preflight` → `agent:pr-ready`;
never raw `gh pr ready`). Verbatim text is from the proposal, lightly adjusted for the §3 facts.

## 7. Tooling prerequisites

- `gh` authenticated with repo-create + (for cleanup) `delete_repo` scope.
- **`gitleaks` installed on whatever runs doc-sweep apply** (#13) — else apply fails closed.
- `actionlint` on PATH / `C:\Tools\actionlint` for any workflow edits.
- Node ≥ 20.
- The lab repos must each have `.githooks` installed (`install-githooks.sh`) before hook tests (#4).

## 8. Execution order

1. Headless fresh dry-run against a scratch dir (no remote).
2. Headless fresh real write (no remote) — confirm files/hooks/manifest.
3. Create `lab-fresh` real remote with the full feature set (#1).
4. First trivial PR → make `repo-required-gate / decision` appear.
5. `tighten-required-gate` after the gate exists.
6. PR-contract negatives (#4, #6–#10, #14) in `lab-pr-contract`.
7. Existing-repo audit-only (#2), then apply/reconcile (#3) in `lab-lived-in`.
8. Managed update drift (#15).
9. doc-sweep (#13) and anomaly triage (#11/#12).
10. Lifecycle scripts (#5).
11. Publish-readiness dry run (`npm test`, `prepublishOnly`) — **do not publish**.

## 9. Results tracking & pass/fail

Each test records into `docs/testing/shakedown/results-template.md` (copied per run): test #, repo,
capability, expected, observed, **pass/fail**, evidence (exact commands, workflow run URLs, check
names), cleanup done, follow-ups opened. A test passes only when the observed behavior matches the
expected signal in §4 with captured evidence — generic "CI green" is not evidence.

## 10. Browser-wizard division of labor

The other agent owns wizard UX only: Doctor failures (missing/unauth `gh`, no write perms), Location
(fresh/populated/existing/wrong-target), feature-dependency UI, Review screen (planned files/commands),
Execute streaming states, existing-repo write confirmation, Ecosystem drift/update dry-run visibility.
This harness avoids duplicating those and focuses on post-generation runtime.

## 11. Harness layout in archon-setup (this PR)

```
docs/superpowers/specs/2026-06-05-archon-setup-shakedown-design.md   # this spec
docs/testing/shakedown/
  README.md            # how to run the sweep + prerequisites
  issues/01..15-*.md   # the 15 issue bodies (corrections applied)
  prompts/*.md         # the 5-prompt pack
  results-template.md  # per-run pass/fail matrix
```

## 12. Lab repo lifecycle & cleanup

Lab repos are throwaway. After the sweep, archive then delete via `delete_repo` scope. They extend
the existing `*-smoketest-*` cleanup concern — add a `lab-*` glob to
`scripts/cleanup-smoketest-repos.mjs` (or document manual deletion) so they don't leak like the
earlier smoketest repos did.

## 13. Definition of done

Evidence captured for: fresh creation works; existing audit works; existing apply/reconcile works;
hooks block the wrong lane; lifecycle create/status/prune correct; PR title/body/branch gates fail
and recover; required gate appears + tightens into protection; anomaly triage → right comment/issue;
doc-sweep preserves safe docs + refuses unsafe; update drift check + repair work; close-preflight
blocks malformed PRs; **direct publish remains deferred.**

## 14. Risks & open notes

- **Required-check wiring:** negative gates (semantic/branch-naming/pr-policy) may only go red, not
  hard-block, until wired as required checks. Tests assert the check conclusion; merge-block is a
  separate (optional) assertion once the checks have run once.
- **Anomaly entry format** must be sourced from the reusable body before #11/#12 are authored.
- **gitleaks dependency** for doc-sweep apply (#13) — install on the runner or scope #13 to report
  mode + expected `leaveLog`.
- **Cost/visibility:** three real ArchonVII repos + Actions minutes; clean up promptly.

---

This spec is the design contract. The 15 issue bodies, prompt pack, and results template are produced
during implementation (writing-plans → execute) from this spec and the proposal.
