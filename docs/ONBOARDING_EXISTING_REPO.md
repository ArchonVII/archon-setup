# Onboarding an Existing Repo

> **Status:** Browser-assisted runbook. The wizard now exposes an **Existing repo**
> mode that accepts populated git repos, detects GitHub `origin`, runs the shared
> read-only audit, disables repo creation, and requires explicit confirmation
> before write-capable steps. Keep using this runbook for reconcile judgment,
> worktree isolation, and PR closeout.

This is for a repo that **already exists** (has history, a remote, and likely its own
`AGENTS.md`/`CLAUDE.md` and code) and needs to adopt the ArchonVII baseline: foundations,
the repo-local coordination standard, the workflow contract, GitHub Actions, hooks, and
branch protection.

For a plain-English explanation of the whole process, read
[`REPO_ONBOARDING_WALKTHROUGH.md`](./REPO_ONBOARDING_WALKTHROUGH.md).

## Principles

- **Audit first.** Know what's already present before writing anything.
- **Harvest before replacing.** Existing setup is evidence, not authority. Keep useful
  repo-specific decisions such as stack, commands, ports, generated-file warnings, release
  surfaces, and real workflow needs, then fold them into the ArchonVII baseline.
- **Executor no-clobber is a tool limitation, not the policy.** The executor's
  `safeWriteFile` never overwrites an existing file. If a placeholder or stale file blocks
  the baseline, reconcile or replace it by hand in the setup PR.
- **Repo-agnostic output.** Nothing installed may name another repo or a machine path. The
  coordination contract is repo-local; scrub any repo-template-internal references from
  copied hooks.
- **Isolate from concurrent work.** If other agents/humans have uncommitted work on the
  default branch, do the setup in a **worktree** so you never touch their tree.

## Steps

### 0. Audit (read-only)

- Browser path: run `npm start`, choose **Existing repo** on Location, select the
  target repo, then review the present/missing/drifted audit results before
  confirming any write-capable step.
- Run `npm run onboard -- <repo> --audit` to report planned baseline files as
  `present`, `missing`, or `drifted` without writing.
- `git -C <repo> rev-parse --abbrev-ref HEAD`, `git remote get-url origin`, `git status --porcelain`.
- Which foundations exist? (`README`, `LICENSE`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`,
  `GEMINI.md`, `.agent/check-map.yml`, `.agent/coordination/README.md`.)
- Does the existing `AGENTS.md`/`CLAUDE.md` carry stale cross-repo or machine-global
  references (a shared board, sibling repos, `~/.claude/...`)? Those get removed.
- Is there a remote already? Then **skip** the new-repo bits (`git init`, `gh repo create`).
- Is there concurrent untracked work on the default branch?

### 1. Isolate in a worktree

```bash
git -C <repo> worktree add -b <type>/repo-setup <repo>-setup-wt <default-branch>
```

A fresh worktree off the default branch has **no** untracked WIP, so the diff you build is
exactly the setup. Never run setup on a checkout another agent is using.

### 2. Foundations (executor; no-clobber)

Run the archon-setup executor against the worktree with the foundation + coordination +
check-map selection (and the opt-in `coordination-board` for multi-agent repos). It writes
only missing files; existing ones report `already-exists` and are left intact by the
executor.

- New files typically: `LICENSE`, `GEMINI.md`, `.agent/check-map.yml`,
  `docs/repo-update-log.md`, `.agent/coordination/{README,board}.md`, a setup manifest.
- The fresh-repo path records generated files honestly: existing files stay out of
  `createdFiles`, and intentionally skipped files are listed in `skippedFiles`.
  After that, replace or reconcile stale existing files by hand so the setup PR still
  lands the full baseline.

### 3. Reconcile AGENTS.md / CLAUDE.md (by hand)

The executor skips these if they exist, so the standard never lands automatically.

- **AGENTS.md:** fold in the standard workflow contract (issue→branch→PR, owner-maintenance
  lane, anomaly triage, `## Coordination` pointing at `.agent/coordination/`, verification,
  commit hygiene) while **keeping** the repo's own purpose/stack/repo-map/project rules.
- **CLAUDE.md:** make it a thin pointer to `AGENTS.md` (workflow content lives there; keep
  only tool-specific notes).
- Align the anomaly path: the `anomaly-triage` workflow reads `.archon/anomalies-thispr.md`
  — make AGENTS.md say the same, and gitignore `.archon/*` except that file.
- Remove any machine-global-board / sibling-repo references found in step 0.

### 4. GitHub Actions (`@v1` callers)

Install the caller workflows into `.github/workflows/`: `repo-required-gate` + `actionlint`
(the single gate), the PR-contract set (`pr-policy`, `semantic-pr-title`,
`pr-body-autoinject`, `branch-naming`), and `anomaly-triage`.

- The browser wizard and headless planner now support this without repo creation:
  select workflow features, labels, and branch protection while leaving
  `remote.github` disabled. The detected or explicitly entered owner/repo becomes
  the remote target.

### 5. Hooks (by hand for existing repos, see [#34])

The fresh-repo wizard now has `foundation.hooks`, writes the scrubbed repo-template
`.githooks/` baseline, and activates `core.hooksPath=.githooks` when it is safe to do so.
For existing repos, copy repo-template `.githooks/` (`pre-commit` main-guard +
owner-maintenance, `commit-msg`, `scripts/install-githooks.sh`,
`owner-maintenance.sh`) by hand until [#34] adds the managed audit/apply flow.
Activation is per-clone: `bash .githooks/scripts/install-githooks.sh` sets
`core.hooksPath`. In a shared/worktree setup with a concurrent agent, commit the hooks
but let each clone activate (don't flip the shared `core.hooksPath` out from under them).

### 6. Branch protection (two-step)

- Apply **baseline** now (require PR, no force-push, linear history, conversation
  resolution, 0 required approvals for solo). Use a full PUT body via `gh api --input` —
  the partial-body form returns HTTP 400.
- The named check `repo-required-gate / decision` can only be **required** after it has run
  once (GitHub's 7-day rule), so mark it required **after the first PR's gate runs**:

  ```bash
  node bin/archon-setup.mjs tighten-required-gate --target <repo>
  ```

  It is safe to run early: if GitHub rejects the required-check update because the gate has
  not run yet, the command prints a pending message and exits successfully. Re-running after
  the gate exists is idempotent and marks the setup manifest's post-check complete.

### 7. Close through the PR

- Issue → branch → PR (the contract you just installed applies to this PR too).
- The PR title/body/branch must pass the shared strict contract before
  ready-for-review: Conventional Commit title, canonical `## Summary` / `## Verification`
  / `### Verification Notes` / `## Docs / Changelog` body order, concrete checked
  verification evidence, and `Closes #N` / `Fixes #N` / `Refs #N`.
- Get the gate green, squash-merge, fast-forward the default branch **only if** it has no
  conflicting tracked changes, remove the setup worktree, and **leave other agents'
  worktrees/branches untouched**.

## Known gaps

The wizard now covers existing-repo selection, read-only audit surfacing,
no-create workflow/label/protection targeting, explicit write confirmation, and
handoff commands for AGENTS/CLAUDE reconcile plus `tighten-required-gate`.
Remaining work is deeper managed replacement planning for repo-specific files:
the user still needs to review AGENTS/CLAUDE diffs and carry forward real
repo-specific decisions in the setup PR.

[#34]: https://github.com/ArchonVII/archon-setup/issues/34
