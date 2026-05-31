# Onboarding an Existing Repo

> **Status:** Interim runbook. The new-repo path is the wizard (`README` → "Canonical
> New-Repo Setup"). Bringing an **existing** repo onto the baseline is the README's
> "First End Goal" but is **not yet a guided wizard flow** — until [#34] closes, follow
> the steps below. Each step notes where the tool helps vs. where you do it by hand.

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
  lands the full baseline. Existing-repo audit/plan/apply reporting remains tracked by
  [#34].

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

- ⚠️ Don't drive these through the executor's planner on an existing repo: selecting
  `workflow.*` transitively pulls in `remote.github` → `gh repo create`. Until [#34] adds a
  no-create path, copy the caller YAMLs from `src/snapshots/github-workflows/<name>.yml`
  (each must reference `@v1`); take `actionlint.yml` from repo-template.

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
  once (GitHub's 7-day rule), so mark it required **after the first PR's gate runs**.

### 7. Close through the PR

- Issue → branch → PR (the contract you just installed applies to this PR too).
- The PR body must have `## Verification` **and** `### Verification Notes` headings, a
  checked box, and `Closes #N` — or the `pr-contract` gate fails.
- Get the gate green, squash-merge, fast-forward the default branch **only if** it has no
  conflicting tracked changes, remove the setup worktree, and **leave other agents'
  worktrees/branches untouched**.

## Known gaps

Fresh-repo gaps addressed by the wizard: `foundation.hooks` and manifest created/skipped
file accuracy. Still tracked in [#34]: existing-repo audit/plan/apply mode,
AGENTS/CLAUDE reconcile, workflows-without-repo-create, managed replacement
planning, and a branch-protection two-step helper. When those land, this runbook
collapses into "run the wizard."

[#34]: https://github.com/ArchonVII/archon-setup/issues/34
