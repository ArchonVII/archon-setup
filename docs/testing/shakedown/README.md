# Shakedown Harness

## Purpose

This harness produces behavioral evidence that every hook, skill, and process archon-setup scaffolds
actually fires in real generated repos. Unit tests prove the planner/executor logic; this harness
proves the _product_ works end-to-end against real GitHub — local git hooks, GitHub Actions gates,
agent lifecycle scripts, repo governance, the doc/update lifecycle, and the human-readable audit
path. It is intended to run as a repeatable pre-publish release gate: run it before every publish
attempt, capture evidence in a dated copy of `results-template.md`, and keep publish deferred until
every row passes.

Full design rationale, the test matrix, the deliberate PR set, and the definition of done live in
the [design spec](../../superpowers/specs/2026-06-05-archon-setup-shakedown-design.md).

---

## The three lab repos (and how each is created)

### `ArchonVII/archon-setup-lab-fresh` — golden happy-path

Created **by dogfooding archon-setup's own onboard** with the full shakedown feature set. Repo
creation is itself **Test #0**; the repo must come into existence via the wizard, not by hand. Keep
it pristine — no manually added files — so it proves default install behavior from a clean slate.

Feature flags to select:

```
foundation.*            remote.github           remote.labels
remote.branch-protection
agent-workflow.check-map  agent-workflow.coordination-board  agent-workflow.anomaly-triage
workflow.pr-policy  workflow.semantic-pr-title  workflow.pr-body-autoinject  workflow.branch-naming
workflow.required-gate  workflow.node-ci
agent-lifecycle.baseline  agent-workflow.doc-sweep  agent-workflow.doc-orphan-detector
```

(`workflow.node-ci` is included so the required-gate `language-ci` route has a real check to run.)

### `ArchonVII/archon-setup-lab-lived-in` — deliberately messy existing repo

Hand-seeded with realistic cruft, then run through the **existing-repo audit → apply** path. Tests
that onboarding inspects existing instructions, automation, hooks, and local tool state — and folds
useful facts forward rather than blind-overwriting them. Pre-seed before onboarding:

| Path                               | What it represents                  |
| ---------------------------------- | ----------------------------------- |
| `README.md`                        | real project facts worth preserving |
| `CLAUDE.md` / `AGENTS.md`          | duplicate/stale partial process     |
| `.github/workflows/ci.yml`         | bespoke old CI                      |
| `.github/PULL_REQUEST_TEMPLATE.md` | incomplete PR body                  |
| `.github/CODEOWNERS`               | nonstandard owner                   |
| `.githooks/pre-commit`             | stale/repo-specific hook            |
| `.agent/check-map.yml`             | drifted check map                   |
| `.claude/` , `.codex/`             | local tool notes                    |
| `docs/runbook.md`                  | useful repo-specific commands       |
| `docs/process/old-agent-flow.md`   | stale process                       |
| `package.json`                     | actual scripts                      |

### `ArchonVII/archon-setup-lab-pr-contract` — tiny onboarded Node repo

Minimal real Node repo (`package.json`, `src/math.js`, `test/math.test.mjs`, `docs/usage.md`,
`README.md`) used only for intentionally good and bad PRs that exercise the workflow gates. Reset,
archive, and delete after the PR-contract sweep.

---

## Prerequisites

- **`gh`** authenticated with `repo-create` scope and (for cleanup) `delete_repo` scope.
- **`gitleaks`** installed on whatever machine runs the doc-sweep apply step (Test #13) — apply
  fails closed and produces no commit if gitleaks is absent.
- **`actionlint`** on `PATH` (or `C:\Tools\actionlint` on Windows) for any workflow file edits.
- **Node ≥ 20** on the local machine.
- Each lab repo must have `.githooks` installed before the hook tests:
  ```sh
  bash .githooks/scripts/install-githooks.sh
  ```
  This sets `core.hooksPath` to `.githooks`.

---

## Labels to create in each lab repo

Create these labels in all three lab repos before filing issues:

```sh
gh label create "type:test"             --repo ArchonVII/<lab-repo> --color 0075ca
gh label create "status:shakedown"      --repo ArchonVII/<lab-repo> --color e4e669
gh label create "area:agent-contract"   --repo ArchonVII/<lab-repo> --color d93f0b
gh label create "area:workflow"         --repo ArchonVII/<lab-repo> --color 0e8a16
gh label create "area:hooks"            --repo ArchonVII/<lab-repo> --color 1d76db
gh label create "area:onboarding"       --repo ArchonVII/<lab-repo> --color 5319e7
gh label create "area:docs"             --repo ArchonVII/<lab-repo> --color f9d0c4
gh label create "area:triage"           --repo ArchonVII/<lab-repo> --color c2e0c6
```

Required labels per issue: `type:test`, `status:shakedown`, plus the one `area:*` listed in that
issue's metadata comment (see "How to file the issues" below).

---

## Execution order (from spec §8)

Run the 15 tests in this order to respect dependencies (branch protection appears only after the
first PR runs the gate; tighten-required-gate requires the gate to have run at least once):

1. Headless fresh dry-run against a scratch dir (no remote).
2. Headless fresh real write (no remote) — confirm files, hooks, and manifest.
3. Create `lab-fresh` real remote with the full feature set (Test #1).
4. First trivial PR → make `repo-required-gate / decision` appear.
5. `tighten-required-gate` after the gate exists.
6. PR-contract negatives (Tests #4, #6–#10, #14) in `lab-pr-contract`.
7. Existing-repo audit-only (Test #2), then apply/reconcile (Test #3) in `lab-lived-in`.
8. Managed update drift (Test #15).
9. doc-sweep (Test #13) and anomaly triage (Tests #11/#12).
10. Lifecycle scripts (Test #5).
11. Publish-readiness dry run (`npm test`, `prepublishOnly`) — **do not publish**.

---

## How to file the issues

Each file in `issues/NN-*.md` carries its target repo, label set, and paired prompt in four leading
HTML-comment metadata lines:

```
<!-- title: <conventional-commits title> -->
<!-- repo: ArchonVII/archon-setup-lab-<fresh|lived-in|pr-contract> -->
<!-- labels: type:test, status:shakedown, area:<area> -->
<!-- prompt: prompts/<which>.md -->
```

To file an issue, read those four lines, then run:

```sh
gh issue create \
  --repo <repo> \
  --title "<title>" \
  --label "type:test" \
  --label "status:shakedown" \
  --label "area:<area>" \
  --body-file issues/NN-*.md
```

The `--body-file` flag passes the full file; GitHub renders only the visible markdown below the
comment lines. Alternatively, strip the four comment lines and pass `--body "<everything below>"`.

Seed the driving agent session with the paired prompt from `prompts/<which>.md` plus the issue
body before starting work. The five prompt files are:

| Prompt file                   | When to use                                        |
| ----------------------------- | -------------------------------------------------- |
| `prompts/general.md`          | standard happy-path tests                          |
| `prompts/negative-control.md` | intentionally invalid conditions (#4, #6–#8, #14)  |
| `prompts/reconciliation.md`   | existing-repo audit/apply (#2, #3)                 |
| `prompts/off-task-anomaly.md` | anomaly recording (#11, #12)                       |
| `prompts/closeout.md`         | final close-preflight → pr-ready step for any test |

---

## How to record results

1. Copy `results-template.md` to a dated run file, for example
   `results-2026-06-10.md`, in this same directory.
2. As each test runs, fill the row's columns:
   - **Observed** — what actually happened (command output, check name, URL).
   - **Pass/Fail** — `Pass` only when observed behavior matches the expected signal in the spec with
     captured evidence. Generic "CI green" is not evidence; name the exact check (e.g.
     `repo-required-gate / decision`) and link the workflow run URL.
   - **Evidence** — exact commands run, workflow run URLs, check names and conclusions.
   - **Cleanup** — what was torn down (worktrees, test branches, temp files).
   - **Follow-ups** — issues opened for off-task findings (use the anomaly or off-task prompt).

A row passes only when all acceptance criteria in the corresponding `issues/NN-*.md` are met with
captured evidence.

---

## Cleanup (spec §12)

Lab repos are throwaway. After the sweep:

1. Archive each lab repo via `gh repo archive ArchonVII/<lab-repo>`.
2. Delete each via `gh repo delete ArchonVII/<lab-repo> --yes` (requires `delete_repo` scope).
3. Add a `lab-*` glob to `scripts/cleanup-smoketest-repos.mjs` so these repos are covered by the
   existing smoketest-cleanup helper and cannot accumulate across runs:

   ```js
   // in the repo-name patterns array — add alongside the existing *-smoketest-* glob
   'archon-setup-lab-*',
   ```

This prevents the same leak that affected earlier smoketest repos.
