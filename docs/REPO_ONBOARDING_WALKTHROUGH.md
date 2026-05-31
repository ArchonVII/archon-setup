# Plain-English Repo Onboarding Walkthrough

This guide explains what happens when we onboard a repository into the ArchonVII
ecosystem. It is not a command checklist. It is the human-readable version of
what we are checking, confirming, adding, replacing, and leaving for review.

## The Goal

Onboarding makes a repository behave like an ArchonVII repo:

- agents know which instructions to follow
- humans can see what was installed and why
- pull requests use the same evidence and verification rules
- branch protection, CI, hooks, and repo policy point at the same contract
- future updates have a manifest and update log instead of guesswork

For lived-in forks or rushed repos, existing setup is treated as evidence, not
authority. We inspect it for useful repo-specific decisions, then fold those
decisions into the full ArchonVII baseline. Weak, stale, or contradictory setup
can be replaced.

## First We Look, Without Writing

Before changing files, we inspect the repo and its environment.

### Repo Identity

We check:

- the repo path and Git top-level
- the current branch and default branch
- the `origin` remote and intended `owner/repo`
- whether the repo is a new project, a fork, or an existing GitHub repo
- open worktrees, dirty files, stashes, and active branches
- whether there is already an issue or PR for the onboarding work

This prevents us from onboarding the wrong checkout or overwriting another
agent's lane.

### Existing Instructions And Decisions

We read the files that explain how the repo is supposed to work:

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `.github/copilot-instructions.md`
- issue and PR templates
- `CODEOWNERS`
- changelog or release-note docs
- project plans, architecture notes, and repo-local runbooks

We are not looking for permission to keep bad scaffolding. We are looking for
repo-specific facts worth carrying forward: project purpose, stack, commands,
ports, branch rules, verification steps, generated-file warnings, release
surfaces, and tool-specific notes.

### Build And Test Shape

We check the actual project shape:

- package manager and lockfiles
- Node, Go, Python, or other language versions
- important package scripts and task runners
- docs-site commands
- generated files and codegen commands
- test commands that are fast enough for normal PRs
- heavier checks that should run only for full CI or release paths

This drives `.agent/check-map.yml` and the required-gate configuration.

### Existing Automation

We inspect automation before replacing or adding to it:

- `.github/workflows/**`
- Dependabot config
- CodeQL or security scans
- release and publish workflows
- local scripts used by workflows
- existing branch protection and required checks
- labels used by CI or triage

The goal is to keep real repo behavior while making it fit the ArchonVII
contract.

### Hooks, Local Agent State, And Coordination

We check:

- `.githooks/**`
- `git config core.hooksPath`
- `.agent/**`
- `.archon/**`
- `.claude`, `.codex`, `.gemini`, `.kilocode`, and similar local tool folders
- repo-specific skills or memory files

Local memory and skills are useful context, but they should not become the only
place where shared repo policy lives. Shared rules belong in tracked repo files.

## Then We Confirm The Plan

Before applying changes, the onboarding plan should answer:

- Which repo and branch are we changing?
- Which issue, branch, worktree, and PR will carry the setup?
- Is this a fresh repo, an existing GitHub repo, or a fork?
- Which existing instructions are useful and should be folded into the baseline?
- Which existing files are stale enough to replace?
- Which GitHub remote actions are in scope, such as labels or branch protection?
- Which checks are deferred until GitHub has seen them run once?

For repos the user asks us to onboard, the default assumption is that existing
setup is incomplete until proven otherwise. We still inspect it carefully, but
we do not let old placeholder files block the full baseline.

## What We Add Or Replace

The exact feature selection can vary, but a full ArchonVII onboarding usually
adds or replaces these surfaces.

### Agent Authority

- `AGENTS.md`: the cross-tool contract for every agent
- `CLAUDE.md`: a thin Claude-specific pointer to `AGENTS.md`
- `GEMINI.md`: the same pointer pattern for Gemini
- `.agent/check-map.yml`: the map from changed paths to expected verification
- `.agent/coordination/README.md`: where coordination belongs if needed
- `.agent/coordination/board.md`: optional local board for multi-agent work

`AGENTS.md` is customized for the repo. It should include the repo purpose,
stack, repo map, generated-file rules, verification commands, and any
repo-specific development guidance we found during the audit.

### GitHub Workflow Contract

- `.github/workflows/repo-required-gate.yml`
- `.github/workflows/actionlint.yml`
- `.github/workflows/pr-policy.yml`
- `.github/workflows/semantic-pr-title.yml`
- `.github/workflows/branch-naming.yml`
- `.github/workflows/pr-body-autoinject.yml`
- `.github/workflows/anomaly-triage.yml`

These workflows make PR evidence, title shape, branch naming, workflow syntax,
and path-based verification visible to both humans and agents.

### Repository Metadata

- `.github/archon-setup.json`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`, when selected
- `docs/repo-update-log.md`
- `CHANGELOG.md` or `.changelog/unreleased/**`, depending on repo policy
- `.gitignore` entries for Archon agent artifacts

The manifest records what was installed, from which snapshots, and which remote
actions were applied. The update log records future repo-policy changes that are
not user-facing release notes.

### Local Guardrails

- `.githooks/pre-commit`
- `.githooks/commit-msg`
- `.githooks/scripts/**`
- local `core.hooksPath = .githooks` activation for each clone or worktree

Hooks keep the primary checkout and feature worktrees in their intended roles
and catch bad commit messages before CI has to.

### GitHub Remote Settings

When selected and permitted, onboarding may also apply:

- standard labels
- baseline branch protection
- required PR review and conversation settings
- the deferred `repo-required-gate / decision` required check after it has run

GitHub requires a check to have run recently before it can be marked required,
so named required checks are often a two-step process.

## What We Edit And Reconcile

Some files should not be copied blindly. They need repo-specific reconciliation.

We commonly edit:

- `README.md`, to link the repo's real docs and setup guidance
- `AGENTS.md`, to carry forward project-specific instructions
- `CLAUDE.md`, to remove duplicate shared policy and keep only Claude-specific notes
- `.gitignore`, to include Archon artifacts without losing existing ignores
- `.agent/check-map.yml`, to match the repo's real paths and CI commands
- workflow caller inputs, to match Node versions, scripts, package managers, or CI tiers
- `docs/repo-update-log.md`, to record the onboarding and later repo-policy changes

If an existing instruction file contains useful facts, we migrate those facts
into the new baseline. If it contains stale process, duplicated policy, or
machine-specific paths, we remove or replace that part.

## What We Do Not Decide Silently

Even with overwrite-first onboarding, some decisions need to be explicit:

- deleting product documentation instead of migrating useful facts
- changing app behavior or runtime code
- changing repository ownership, visibility, or remote URL
- creating or storing secrets
- removing a bespoke workflow without understanding what it protects
- requiring a named GitHub check before that check has run
- changing the release or changelog model when the repo already has a deliberate one

When a repo-specific choice is real but conflicts with the baseline, we surface
the tradeoff in the PR rather than hiding it in a silent replacement.

## How The Change Lands

Onboarding itself uses the policy it installs:

1. Create or select a GitHub issue.
2. Create an `agent/<tool>/<issue>-<slug>` branch in a separate worktree.
3. Make the onboarding changes there.
4. Verify markdown, YAML, hooks, and any affected tests.
5. Open a PR with verification notes and `Closes #<issue>`.
6. Let the required gate run.
7. Merge through GitHub, then fast-forward the primary checkout.
8. Leave unrelated branches, worktrees, stashes, and local artifacts alone.

The final state should be boring: a new agent entering the repo can read
`AGENTS.md`, see the manifest and check map, run the expected verification, and
understand how to open a compliant PR without guessing.
