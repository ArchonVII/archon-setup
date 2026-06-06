# archon-setup Release Shakedown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a reusable, evidence-producing shakedown that confirms every hook/skill/process archon-setup scaffolds actually fires in real generated repos, before the package is published.

**Architecture:** Two phases. **Phase 1 (committable)** authors the harness — issue bodies, prompt pack, results template, README — under `docs/testing/shakedown/` in archon-setup and lands it as one doc-only PR. **Phase 2 (operational)** uses that harness to create three throwaway ArchonVII lab repos, file the issues, run the agent matrix per the execution order, capture evidence into a results matrix, then clean up and gate the re-cut.

**Tech Stack:** Node ≥20 (`node --test`), `gh` CLI, GitHub Actions (reusable `@v1` workflows), git worktrees, `gitleaks` (doc-sweep apply), `actionlint`.

**Spec:** `docs/superpowers/specs/2026-06-05-archon-setup-shakedown-design.md` (§ references below point there).

---

## File structure (Phase 1 — created in this branch)

```
docs/testing/shakedown/
  README.md              # how to run the sweep, prereqs, repo map, execution order
  results-template.md    # per-run pass/fail matrix (copied per execution)
  prompts/
    general.md  negative-control.md  reconciliation.md  off-task-anomaly.md  closeout.md
  issues/
    01-fresh-install.md            02-existing-audit.md        03-existing-apply.md
    04-precommit-guard.md          05-lifecycle.md             06-branch-naming.md
    07-semantic-title.md           08-pr-policy-body.md        09-autoinject.md
    10-required-gate-routing.md    11-anomaly-related.md       12-anomaly-unrelated.md
    13-doc-sweep.md                14-close-preflight.md       15-update-drift.md
```

All Phase-1 files are `*.md` → the PR is **doc-only** (skips body ceremony; still needs a valid
Conventional-Commits title + `agent/claude/109-shakedown-harness` branch). Verification per task is
`npm test` staying green (no code touched) plus a markdown sanity read.

---

## Phase 0: Prerequisites & source-of-truth gathering

### Task 0.1: Confirm tooling

- [ ] **Step 1: Verify prerequisites**

Run (PowerShell):
```powershell
gh auth status; node --version; (Get-Command gitleaks -ErrorAction SilentlyContinue); (Get-Command actionlint -ErrorAction SilentlyContinue)
```
Expected: `gh` logged in; Node ≥ 20. If `gitleaks` is absent, note it — doc-sweep *apply* (#13) will
fail closed; either install gitleaks before Phase-2 #13 or scope #13 to report-mode.

### Task 0.2: Capture the canonical anomaly entry format

The `.archon/anomalies-thispr.md` field format lives in the reusable workflow body, not the caller
snapshot (spec §3.4). It is needed verbatim for issues #11/#12.

- [ ] **Step 1: Pull the reusable body's documented format**

Run:
```bash
gh api repos/ArchonVII/github-workflows/contents/.github/workflows/anomaly-triage.yml --jq .content | base64 -d | sed -n '1,40p'
```
Expected: the workflow header comment documenting the entry schema (the `### <title>` + fields that
mark an entry related vs unrelated). Record the exact field name/values into a scratch note for #11/#12.

- [ ] **Step 2: Cross-check the repo-template AGENTS contract**

Run:
```bash
grep -n -A12 -i "anomal" src/snapshots/repo-template/AGENTS.md
```
Expected: the AGENTS section telling agents how to write anomalies. Use whichever (reusable body vs
AGENTS) is authoritative; if they disagree, prefer the reusable body and note the discrepancy as a
follow-up anomaly.

---

## Phase 1: Author the harness (doc-only PR on branch agent/claude/109-shakedown-harness)

> The spec is already committed on this branch (`81a5ff0`). Each task below creates files then commits.

### Task 1.1: Results-matrix template

**Files:** Create `docs/testing/shakedown/results-template.md`

- [ ] **Step 1: Create the file with this exact content**

```markdown
# Shakedown Run — Results

- **Run date:** <fill>
- **archon-setup commit:** <sha>
- **Operator / agent:** <fill>
- **Lab repos:** ArchonVII/archon-setup-lab-{fresh,lived-in,pr-contract}

| # | Capability | Repo | Expected signal | Observed | Pass/Fail | Evidence (cmd / run URL / check) | Cleanup | Follow-ups |
|---|-----------|------|-----------------|----------|-----------|----------------------------------|---------|-----------|
| 0 | Fresh repo created by onboard | fresh | repo exists + manifest | | | | | |
| 1 | Fresh install baseline | fresh | files+labels+protection; gate appears | | | | | |
| 2 | Existing audit | lived-in | present/missing/drifted; no writes | | | | | |
| 3 | Existing apply/reconcile | lived-in | facts kept, stale replaced | | | | | |
| 4 | pre-commit guard | pr-contract | primary feature commit blocked | | | | | |
| 5 | Lifecycle scripts | pr-contract | start/status/prune correct | | | | | |
| 6 | branch-naming | pr-contract | bad→red, fixed→green | | | | | |
| 7 | semantic-pr-title | pr-contract | bad→red, fixed→green | | | | | |
| 8 | pr-policy body | pr-contract | missing→red, fixed→green | | | | | |
| 9 | autoinject | pr-contract | empty body at open→injected | | | | | |
| 10 | required-gate routing | pr-contract | docs/code/workflow route correctly | | | | | |
| 11 | anomaly (related) | pr-contract | sticky PR comment, idempotent | | | | | |
| 12 | anomaly (unrelated) | pr-contract | new issue, no dupes | | | | | |
| 13 | doc-sweep | pr-contract | safe docs swept, unsafe left | | | | | |
| 14 | close-preflight | pr-contract | malformed blocked, fixed→ready | | | | | |
| 15 | update drift | pr-contract | check flags, upgrade repairs | | | | | |

**Definition of done:** every row Pass with evidence, and publish still deferred.
```

- [ ] **Step 2: Commit**

```bash
git add docs/testing/shakedown/results-template.md
git commit -m "docs(testing): add shakedown results-matrix template"
```

### Task 1.2: Prompt pack (5 files)

**Files:** Create `docs/testing/shakedown/prompts/{general,negative-control,reconciliation,off-task-anomaly,closeout}.md`

- [ ] **Step 1: Create `general.md`**

```markdown
You are operating a shakedown test, not doing product work. Your goal is to make the named ArchonVII
process visibly fire. Prefer tiny, reversible changes. Do not chase unrelated bugs. If you notice
off-task problems, record them as anomalies or follow-up issues. Preserve exact command output and
workflow/check names. End with: observed behavior, expected behavior, pass/fail, evidence, cleanup
performed, follow-ups opened.
```

- [ ] **Step 2: Create `negative-control.md`**

```markdown
This is a negative-control test. You must intentionally create the invalid condition described in the
issue, confirm the expected guard fails, then repair only the invalid condition and confirm the guard
passes. Do not bypass hooks, checks, wrappers, or branch protection (no --no-verify, no ALLOW_* env
overrides, no raw `gh pr ready`). Do not merge until the repaired state is green.
```

- [ ] **Step 3: Create `reconciliation.md`**

```markdown
Treat existing files as evidence, not authority. Preserve project-specific facts that are still true:
purpose, stack, commands, ports, generated files, release surfaces, and local runbooks. Replace stale
shared policy, duplicate agent instructions, and machine-specific paths. In the PR body, include a
reconciliation table with columns: file, signal found, decision (keep/replace/carry-forward/skip/
needs-review), reason.
```

- [ ] **Step 4: Create `off-task-anomaly.md`**

```markdown
While working, if you find a bug or stale process outside this issue's scope, do not fix it in this
PR. Add a structured entry to `.archon/anomalies-thispr.md` when anomaly triage is the behavior under
test; otherwise open or recommend a follow-up issue. Keep the active PR scoped to the issue acceptance
criteria.
```

- [ ] **Step 5: Create `closeout.md`**

```markdown
Before marking ready, run the repo's required verification commands, update the PR body with exact
evidence, update `docs/repo-update-log.md` when required, confirm the issue link exists, run
`npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>`, and only then run
`npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>`. Never run `gh pr ready` directly.
```

- [ ] **Step 6: Commit**

```bash
git add docs/testing/shakedown/prompts/
git commit -m "docs(testing): add shakedown agent prompt pack"
```

### Task 1.3: Issue body — canonical template

All 15 issue files use this skeleton (adapt per issue). Title goes in an H1 comment line for the
filer; body is everything under it.

```markdown
<!-- title: <conventional-commits title> -->
<!-- repo: ArchonVII/archon-setup-lab-<fresh|lived-in|pr-contract> -->
<!-- labels: type:test, status:shakedown, area:<area> -->
<!-- prompt: prompts/<which>.md -->

## Context
<one paragraph: what process this exercises and why>

## Acceptance Criteria
- [ ] <criterion with the exact command/observable>
...

## Verification
Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
```

- [ ] **Step 1: Create `docs/testing/shakedown/issues/00-template.md` with the skeleton above. Commit.**

```bash
git add docs/testing/shakedown/issues/00-template.md
git commit -m "docs(testing): add shakedown issue-body template"
```

### Task 1.4: Author issues #1–#3 (fresh install + existing-repo audit/apply)

Source content = proposal Issues 1–3, adopted verbatim into the template. Pair: #1→general, #2→general,
#3→reconciliation. Key ACs are the spec §4 matrix rows 1–3. No §3 corrections apply to these three.

- [ ] **Step 1: Create `issues/01-fresh-install.md`** — title `test: fresh repo onboarding creates complete Archon baseline`, repo `lab-fresh`, area `onboarding`, prompt `general`. ACs: headless `--dry-run --json` plan correct; real write produces baseline files; `.github/archon-setup.json` records features + deferred post-checks; `.githooks/` present and `core.hooksPath` set; AGENTS/CLAUDE/GEMINI/`.agent/check-map.yml`/`docs/repo-update-log.md` exist; PR-contract workflows installed; labels applied; baseline branch protection applied; first PR makes `repo-required-gate / decision` appear; `tighten-required-gate` succeeds after first gate run.
- [ ] **Step 2: Create `issues/02-existing-audit.md`** — title `test: existing repo audit classifies present missing and drifted baseline files`, repo `lab-lived-in`, area `onboarding`, prompt `general`. ACs: audit writes nothing; matching→`present`, absent→`missing`, modified-managed→`drifted`; origin detected; audit output saved into the issue/PR. Out of scope: applying changes.
- [ ] **Step 3: Create `issues/03-existing-apply.md`** — title `test: existing repo onboarding preserves useful facts and replaces stale process`, repo `lab-lived-in`, area `onboarding`, prompt `reconciliation`. ACs: useful facts (README/runbook/package scripts) preserved; stale duplicated policy replaced; machine-local paths + sibling-repo refs dropped; existing workflows preserved/replaced/needs-review with rationale; `.agent/check-map.yml` reflects real scripts; `docs/repo-update-log.md` records onboarding; PR body has reconciliation table.
- [ ] **Step 4: Commit**

```bash
git add docs/testing/shakedown/issues/01-fresh-install.md docs/testing/shakedown/issues/02-existing-audit.md docs/testing/shakedown/issues/03-existing-apply.md
git commit -m "docs(testing): add shakedown issues 1-3 (install + existing-repo)"
```

### Task 1.5: Author issues #4–#5 (hooks + lifecycle) — apply §3 corrections

- [ ] **Step 1: Create `issues/04-precommit-guard.md`** — title `test: pre-commit blocks feature commits from the primary checkout`, repo `lab-pr-contract`, area `hooks`, prompt `negative-control`. ACs (spec §3.2): install hooks first (`.githooks/scripts/install-githooks.sh`); from the **primary checkout** on a feature branch, a commit is **blocked** with a message pointing to worktrees; an add-only Owner-Maintenance docs commit on the default branch is **allowed**; no `--no-verify` / `ALLOW_*` bypass used; restore clean state after.
- [ ] **Step 2: Create `issues/05-lifecycle.md`** — title `test: agent lifecycle scripts create status and prune worktrees safely`, repo `lab-pr-contract`, area `agent-contract`, prompt `general`. ACs (spec §3.1): pre-create an **open** issue; `npm run agent:start-task -- <issue> --agent claude --slug lifecycle-smoke` makes worktree `../<repo>-<issue>-lifecycle-smoke` and branch `agent/claude/<issue>-lifecycle-smoke`; `.agent/current-task.json` exists and is gitignored; `npm run agent:status` reports branch/issue/PR/dirty/next-action; `npm run agent:prune` removes only merged-clean agent worktrees; a dirty/unmerged worktree is **not** pruned.
- [ ] **Step 3: Commit**

```bash
git add docs/testing/shakedown/issues/04-precommit-guard.md docs/testing/shakedown/issues/05-lifecycle.md
git commit -m "docs(testing): add shakedown issues 4-5 (hooks + lifecycle)"
```

### Task 1.6: Author issues #6–#10 (PR-contract negatives + autoinject + required-gate)

- [ ] **Step 1: Create `issues/06-branch-naming.md`** — title `test: branch-naming workflow rejects nonconforming PR branches`, repo `lab-pr-contract`, area `workflow`, prompt `negative-control`. ACs: PR from a bad branch → branch-naming check **red**; recreate branch as `agent/claude/<issue>-<slug>` → check **green** (re-checks on `edited`/`synchronize`).
- [ ] **Step 2: Create `issues/07-semantic-title.md`** — title `test: semantic-pr-title workflow rejects malformed titles`, repo `lab-pr-contract`, area `workflow`, prompt `negative-control`. ACs: title `update stuff` → check **red**; retitle `test(pr-contract): exercise semantic title gate` → **green**.
- [ ] **Step 3: Create `issues/08-pr-policy-body.md`** — title `test: pr-policy rejects missing verification and issue link`, repo `lab-pr-contract`, area `workflow`, prompt `negative-control`. ACs: non-doc PR with incomplete body → pr-policy **red**; add `## Summary`/`## Verification`/`### Verification Notes`/`## Docs / Changelog` in order + ≥1 checked box with concrete evidence + `Closes #<issue>` → **green**.
- [ ] **Step 4: Create `issues/09-autoinject.md`** (§3.5 correction) — title `test: pr-body-autoinject fills an empty PR body at open`, repo `lab-pr-contract`, area `workflow`, prompt `general`. ACs: open a PR with an **empty body** → autoinject (fires on `opened` only) inserts the template/stub. NOTE in body: do not test synchronize re-runs — the workflow does not trigger on synchronize.
- [ ] **Step 5: Create `issues/10-required-gate-routing.md`** — title `test: repo-required-gate maps changed paths to expected checks`, repo `lab-pr-contract`, area `workflow`, prompt `general`. ACs (spec §3.6): docs-only change → low-cost (`requires: []`); code/test change → `language-ci`; workflow/`.githooks` change → `workflow-validation`; `repo-required-gate / decision` reports stably; observed routing agrees with `.agent/check-map.yml`. Log mismatches separately; don't edit the check-map unless a real mismatch is found.
- [ ] **Step 6: Commit**

```bash
git add docs/testing/shakedown/issues/06-branch-naming.md docs/testing/shakedown/issues/07-semantic-title.md docs/testing/shakedown/issues/08-pr-policy-body.md docs/testing/shakedown/issues/09-autoinject.md docs/testing/shakedown/issues/10-required-gate-routing.md
git commit -m "docs(testing): add shakedown issues 6-10 (PR gates + required-gate)"
```

### Task 1.7: Author issues #11–#15 (anomaly + doc-sweep + close-preflight + update-drift)

- [ ] **Step 1: Create `issues/11-anomaly-related.md`** (§3.4) — title `test: anomaly triage posts a related PR comment`, repo `lab-pr-contract`, area `triage`, prompt `off-task-anomaly`. ACs: add `.archon/anomalies-thispr.md` with a **related** entry (use the exact format captured in Task 0.2) touching a file in the PR diff; workflow posts/updates a **sticky PR comment**; second commit editing only the anomaly wording updates the same comment (no duplicate).
- [ ] **Step 2: Create `issues/12-anomaly-unrelated.md`** (§3.4) — title `test: anomaly triage opens an issue for an unrelated finding`, repo `lab-pr-contract`, area `triage`, prompt `off-task-anomaly`. ACs: add an **unrelated** entry (exact format from Task 0.2); workflow opens a **new issue** with a back-link + expected labels; re-run does not duplicate.
- [ ] **Step 3: Create `issues/13-doc-sweep.md`** (§3.3) — title `test: doc-sweep recovers safe stranded docs and leaves unsafe files alone`, repo `lab-pr-contract`, area `docs`, prompt `general`. ACs: ensure **gitleaks installed** (else apply fails closed); seed safe add-only docs under allowed paths + unsafe/ambiguous files; run report `node scripts/doc-sweep/sweep.mjs --repo <p>` → buckets correct; run apply in a worktree with an open PR (or primary with `--owner`) → commits only allow-listed safe docs; unsafe/code/CI/hooks/AGENTS/README/package/tool dirs left untouched (verify via `isSweepable` exclusions).
- [ ] **Step 4: Create `issues/14-close-preflight.md`** — title `test: close-preflight blocks a malformed PR before ready-for-review`, repo `lab-pr-contract`, area `agent-contract`, prompt `negative-control`. ACs: draft PR with incomplete verification → `npm run agent:close-preflight -- --repo OWNER/REPO --pr <n>` **fails**; no raw `gh pr ready`; after fixing title/body/verification/update-log, preflight passes and `npm run agent:pr-ready -- ...` marks ready.
- [ ] **Step 5: Create `issues/15-update-drift.md`** — title `test: update --check reports managed workflow drift and --upgrade repairs it`, repo `lab-fresh` (or a clone of it), area `workflow`, prompt `general`. ACs: from an onboarded repo, edit one managed caller; `archon-setup update --check --target <repo>` reports drift + exits non-zero; plain `update --target` preserves allowed custom inputs; `update --upgrade --target` fully replaces drifted callers; `--dry-run` writes nothing.
- [ ] **Step 6: Commit**

```bash
git add docs/testing/shakedown/issues/11-anomaly-related.md docs/testing/shakedown/issues/12-anomaly-unrelated.md docs/testing/shakedown/issues/13-doc-sweep.md docs/testing/shakedown/issues/14-close-preflight.md docs/testing/shakedown/issues/15-update-drift.md
git commit -m "docs(testing): add shakedown issues 11-15 (anomaly + sweep + preflight + drift)"
```

### Task 1.8: README + verify + open/merge the doc-only PR

**Files:** Create `docs/testing/shakedown/README.md`

- [ ] **Step 1: Create the README** — sections: purpose (link the spec), the 3 lab repos + how each is created, prerequisites (gh, gitleaks, actionlint, node≥20), the labels to create (`type:test`,`status:shakedown`,`area:*`), the execution order (spec §8), how to file issues from `issues/*.md`, how to record results from `results-template.md`, and the cleanup procedure (spec §12).

- [ ] **Step 2: Verify the suite still passes (no code touched)**

Run: `npm test`
Expected: `tests 218 ... pass 218 ... fail 0`.

- [ ] **Step 3: Push and open the doc-only PR**

```bash
git push -u origin agent/claude/109-shakedown-harness
gh pr create --repo ArchonVII/archon-setup --base main --head agent/claude/109-shakedown-harness \
  --title "docs(testing): add release shakedown harness (spec + issues + prompts)" \
  --body "Adds the pre-publish shakedown harness under docs/testing/shakedown/ plus the design spec. Doc-only. Closes #109." \
  --draft
```
Expected: PR created. (Doc-only → body ceremony skipped; title + branch valid.)

- [ ] **Step 4: Preflight, ready, merge after CI green**

```bash
npm run agent:close-preflight -- --repo ArchonVII/archon-setup --pr <n>
npm run agent:pr-ready -- --repo ArchonVII/archon-setup --pr <n>
gh pr checks <n> --repo ArchonVII/archon-setup --watch
gh pr merge <n> --repo ArchonVII/archon-setup --squash --subject "docs(testing): add release shakedown harness (#<n>)" --body "Closes #109."
```
Expected: CI green, squash-merged, #109 closed. Then prune the worktree (see project cleanup discipline).

---

## Phase 2: Operational execution (runbook — NOT an archon-setup PR)

> Real GitHub side effects. Each test writes its result row into a copy of `results-template.md`.
> Follow spec §8 execution order. Default agent driving = fresh Claude Code sessions seeded with the
> matching `prompts/*.md` + the `issues/NN-*.md` body.

### Task 2.1: Create the three lab repos + labels

- [ ] **Step 1: Local-only fresh dry-run + write (spec §8 steps 1–2)** — `node bin/onboard.mjs <scratch> --dry-run --json` then a real local write (no remote); confirm files/hooks/manifest. Record row 0/1 (local portion).
- [ ] **Step 2: Create `lab-fresh` on a real remote** via the full feature set (spec §2.1). This is Test #0. Then create `lab-pr-contract` (tiny Node repo, onboarded) and hand-seed `lab-lived-in` (spec §2.2 cruft) and onboard nothing yet.
- [ ] **Step 3: Create labels** in each lab repo: `type:test`, `status:shakedown`, `area:agent-contract|workflow|hooks|onboarding|docs|triage` (`gh label create`).

### Task 2.2: Run the happy-path spine (spec §8 steps 3–5)

- [ ] **Step 1:** File issue #1 in `lab-fresh`; run it (prompt `general`); first trivial PR to make `repo-required-gate / decision` appear; run `tighten-required-gate`. Record rows 0,1.

### Task 2.3: Run PR-contract negatives + autoinject + routing (issues #4, #6–#10, #14)

- [ ] **Step 1:** In `lab-pr-contract`, file and run each as a fresh agent session with the issue body + paired prompt. Create the deliberate PR set (spec §5). Record rows 4,6,7,8,9,10,14.

### Task 2.4: Existing-repo audit + apply (issues #2, #3) and update-drift (#15)

- [ ] **Step 1:** Run #2 (audit-only) then #3 (apply/reconcile) against `lab-lived-in`. Run #15 against `lab-fresh`. Record rows 2,3,15.

### Task 2.5: doc-sweep + anomaly + lifecycle (issues #13, #11, #12, #5)

- [ ] **Step 1:** Ensure gitleaks installed. Run #13 (sweep), #11/#12 (anomaly related/unrelated), #5 (lifecycle) in `lab-pr-contract`. Record rows 5,11,12,13.

### Task 2.6: Publish-readiness dry-run (spec §8 step 11)

- [ ] **Step 1:** Run `npm test` and `node scripts/prepublish-check.mjs` in archon-setup. **Do not publish.** Confirm the DoD (spec §13) rows are all Pass with evidence.

---

## Phase 3: Cleanup & re-cut gate

### Task 3.1: Tear down lab repos

- [ ] **Step 1:** Archive then delete the three lab repos (`gh repo delete` with `delete_repo` scope). Add a `lab-*` glob to `scripts/cleanup-smoketest-repos.mjs` (separate small PR) so they're covered by the existing cleanup helper.

### Task 3.2: Record outcomes & decide on re-cut

- [ ] **Step 1:** Save the completed results matrix (attach to #109 or a new tracking issue). Update `.claude/HANDOFF.md` + the `project_deploy_readiness_sweep` memory with the shakedown verdict.
- [ ] **Step 2:** If all DoD rows pass → the publish is unblocked: re-cut 0.1.0 (bump + freshly-dated changelog fold + README status refresh) and resume the owner publish steps. If any fail → open fix issues; publish stays deferred.

---

## Self-Review

**Spec coverage:** §2 repos → Task 2.1; §3 corrections → folded into issue tasks 1.5–1.7 (#4,#5,#9,#11,#12,#13) + 0.2; §4 matrix → issues 1.4–1.7; §5 PR set → Task 2.3; §6 prompts → Task 1.2; §7 prereqs → Task 0.1; §8 order → Tasks 2.1–2.6; §9 results → Task 1.1 + recorded each Phase-2 task; §10 wizard split → README (Task 1.8); §11 layout → Phase-1 file map; §12 cleanup → Task 3.1; §13 DoD → results template + Task 2.6/3.2; §14 risks → Tasks 0.1/0.2/2.5 caveats. No gaps.

**Placeholder scan:** `<n>`, `<repo>`, `<fill>`, `<sha>` are intentional runtime fill-ins, not unspecified work. Issue ACs give exact commands/observables. Prompt + results content is complete.

**Type/name consistency:** branch `agent/claude/109-shakedown-harness`, repos `archon-setup-lab-{fresh,lived-in,pr-contract}`, `repo-required-gate / decision`, `agent:start-task/status/prune/close-preflight/pr-ready`, `node scripts/doc-sweep/sweep.mjs` — used consistently throughout and matched to spec §3.

**Known dependency:** issues #11/#12 depend on Task 0.2 output (anomaly format). Phase-2 #13 depends on gitleaks (Task 0.1). Both flagged.
