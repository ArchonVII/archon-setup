# Coordinator Handoff

Last updated: 2026-06-09 by Codex.

This document is for the next coordinator/review/close agent taking over
ArchonVII ecosystem work. It is a current handoff, not a substitute for the
repo-local `AGENTS.md` policy.

## Coordinator Role

The coordinator should:

- Keep source-of-truth order intact across the four hub repos.
- Split work into independent agent prompts when files and repo ownership do not
  overlap.
- Review returned work for ordering, verification, and stale status before
  issuing merge or follow-up prompts.
- Keep project-facing status docs current when a rollout changes ecosystem
  state.
- Preserve unrelated local state, especially untracked `.claude/` and other
  agent memory directories.

The coordinator should not:

- Edit protected `main` directly.
- Merge an `archon-setup` snapshot PR before provider PRs have landed.
- Treat local skill files or machine-global memory as ecosystem policy.
- Ask agents to distribute global fixes across repos without explicit user
  confirmation.

## Source-Of-Truth Order

Provider repos must land before `archon-setup` consumes snapshots:

1. `C:\GitHub\github-workflows` - reusable workflow bodies, shared validators,
   and example caller files. If a reusable workflow change must reach consumers,
   move `v1` after merge and verify the tag.
2. `C:\GitHub\repo-template` - generated repo baseline, including `AGENTS.md`,
   hooks, check map, PR template, and repo update log.
3. `C:\GitHub\.github` - organization defaults such as issue templates, PR
   template, starter guidance, and security docs.
4. `C:\GitHub\archon-setup` - integration hub and snapshot consumer. Refresh
   snapshots only after the relevant providers are on merged source-of-truth
   commits.

When in doubt, stop at the provider PR and do not refresh snapshots from an
unmerged branch.

## Ecosystem Fix Queue Workflow

Use `docs/ecosystem-status.md#ecosystem-fix-queue` for low-urgency
source-of-truth fixes that should be batched instead of snapshotted one at a
time.

1. Confirm every queue row has an issue or incident, source-of-truth target,
   intended fix, snapshot impact, consumer action, and batch notes.
2. Keep source-of-truth PRs separate from snapshot refresh PRs. Do not refresh
   snapshots from unmerged provider branches.
3. Before a batch, review all `ready-for-batch` rows together for overlapping
   files, conflicting policy text, stale provider SHAs, and consumer risk.
4. Select compatible rows, mark them `batched`, run one `npm run
   refresh-snapshots` PR from `archon-setup`, and record exact verification.
5. After merge, mark shipped rows `shipped`, close/dedupe resolved issues, and
   leave unrelated proposed/deferred rows for a later batch.

## Current Landed State

The strict PR contract rollout is complete:

- `github-workflows` PR #39 merged at
  `90c0a89fb5836bbf579a2e8f490f59d3faf8e4e3`, and `v1` points to that commit.
- `repo-template` PR #30 merged at
  `a3284619872a2da9711f04fd598b4eabade6fef9`.
- `.github` PR #23 merged at
  `792fc81304402accf1acc59b870815044b80c109`.
- `archon-setup` PR #67 merged at
  `908b8148a46899e5c589799c01ff6bc58e53667b`, refreshing snapshots to those
  provider commits.

The existing-repo headless/tooling epic is complete and split from browser UX:

- PR #52 decoupled workflow, label, and branch-protection installs from repo
  creation.
- PR #55 added read-only headless audit mode.
- PR #56 added managed-block reconciliation for existing `AGENTS.md` and
  `CLAUDE.md`.
- PR #57 added `tighten-required-gate` for the delayed required-check step.
- Issue #34 was closed, and browser surfacing continues in issue #68.

The current `archon-setup` main checkout should be clean except for the known
untracked `.claude/` directory.

## Open Work Queue

As of this handoff, the main open `archon-setup` issues are:

1. #68 - Surface existing-repo onboarding mode in the browser wizard.
   This is the highest-value product lane. It should reuse the merged headless
   audit/planner/executor path and should include manual wizard verification.
2. #65 - Audit branch protection and ruleset state in ecosystem status.
   This can run in parallel with #68. It should report unknown permission states
   honestly instead of inferring compliance.
3. #64 - Add agent-lifecycle feature and updater audit support.
   Hold this until upstream lifecycle command surfaces exist in provider repos.
   `github-workflows` PR #35 is the current accounting/documentation lane for
   those gaps.
4. #43 - Delete leftover smoke-test repos and decide the safe repo-deletion
   path for agents.
   This is operational cleanup and may require `delete_repo` scope or a
   lower-blast-radius cleanup credential decision.
5. #71 - This coordinator handoff doc lane.

There are no open `archon-setup` PRs at the time this handoff was written.

## Known Active Worktrees

Before assigning work, run:

```powershell
git -C C:\GitHub\archon-setup worktree list
gh pr list -R ArchonVII/archon-setup --state open
gh issue list -R ArchonVII/archon-setup --state open --limit 50
```

Recent worktrees observed during this handoff included lanes for #65 and #68
under `C:\GitHub\_worktrees\`. Treat them as possibly active until you confirm
with branch status, PR state, and the user.

## Recommended Next Assignments

Run #68 and #65 in parallel if their worktrees are not already active.

Prompt for #68:

```text
You are in C:\GitHub\archon-setup.

Implement issue #68: surface existing-repo onboarding mode in the browser
wizard. Use a separate issue branch/worktree. Reuse the merged headless
audit/planner/executor path. Add explicit existing-repo confirmation before any
write-capable step. Surface present, missing, drifted, applied, skipped, and
failed outcomes. Ensure workflow, label, and branch-protection install can
target an existing repo without repo creation. Hand off clearly to the
AGENTS/CLAUDE reconcile path and `tighten-required-gate` when those are the
right next actions. Run `npm test`, launch `npm run dev`, manually exercise the
wizard, and open a PR with verification notes.
```

Prompt for #65:

```text
You are in C:\GitHub\archon-setup.

Implement issue #65: make branch protection and repository ruleset state
visible in audit/status output. Use a separate issue branch/worktree. Query the
GitHub API where available. Distinguish classic branch protection from
repository rulesets. Report missing permissions or unavailable data as
unknown/unavailable, not compliant. Surface PR-required, direct-push,
force-push, deletion, and required-gate posture for the four hub repos. Add
tests with mocked command/API responses and run `npm test`. Open a PR with
verification notes.
```

Hold #64 until provider lifecycle work exists:

```text
Do not implement archon-setup issue #64 yet unless provider lifecycle command
surfaces have landed in repo-template and any supporting github-workflows work
has merged. First review github-workflows PR #35 and the related provider
issues, then update #64 with the actual provider source-of-truth state.
```

## Close And Review Checklist

For every lane:

1. Confirm issue, branch, and worktree identity.
2. Confirm the PR body uses the current strict PR contract.
3. Confirm verification boxes are checked only for commands that passed.
4. Run or verify the repo-owned checks. For `archon-setup`, default to
   `npm test` and `git diff --check`.
5. For workflow files, run scoped `actionlint` when available:
   `C:\Tools\actionlint\actionlint.exe <workflow-file>`.
6. If provider snapshots changed, verify provider SHAs and that snapshots match
   provider files. Never hand-edit files under `src/snapshots/`.
7. Merge only through GitHub PR gates and only when explicitly authorized for
   close/ship.
8. After merge, fast-forward local `main` only and preserve unrelated worktrees,
   local branches, and untracked agent memory.

## Status Docs To Keep Current

- `docs/ecosystem-status.md` is the canonical ecosystem state file. Update it
  after any cross-repo rollout, source-of-truth decision, provider SHA move, or
  issue-status transition in the F-roadmap.
- `ROADMAP.md` is the `archon-setup` product roadmap. Update it when product
  capabilities move between built, in-progress, planned, or deferred.
- This handoff doc should be updated when the coordinator queue, provider
  ordering, or next recommended prompts materially change.

## Verification Commands For This Handoff Lane

For docs-only changes in this lane, run:

```powershell
git diff --check
npm test
```

If no code changes are made, `npm test` is still useful because this repo has a
small fast test suite and docs often describe behavior tested by the planner,
updater, and onboarding paths.
