# Deterministic Onboarding Contract

> **Status:** active
> **Owner:** ecosystem
> **Scope:** onboarding
> **Source of truth:** yes
> **Last reviewed:** 2026-07-09
> **Supersedes:** none
> **Superseded by:** none

This document answers one question: when is an ArchonVII repo actually
onboarded?

Onboarding is a product operation. It must be repeatable, auditable, and tied to
the current default branch. It is not an agent-crafted migration where the agent
manually chooses which baseline files to add, tightens checks opportunistically,
and records success from a side branch.

## Binding Rules

1. **Default branch or it did not happen.** A repo is fully onboarded only when
   `origin/<default>` contains the selected baseline and a post-merge audit of
   that default-branch commit is clean.
2. **Side branches are evidence, not completion.** A setup worktree, PR branch,
   archived branch, local manifest, or successful PR check can show progress,
   but cannot prove the current repo is onboarded.
3. **Automation owns repeatable work.** Baseline file inventory, file writes,
   managed-block rendering, manifest updates, PR creation, audit, and remote
   state checks must be tool-owned wherever the inputs are knowable.
4. **Required checks are never speculative.** Do not require
   `repo-required-gate / decision` unless `.github/workflows/repo-required-gate.yml`
   exists on the default branch and GitHub has produced that check for the repo.
5. **Manual decisions must be explicit.** Humans or supervising agents may decide
   how to resolve repo-specific conflicts, but every such decision must be
   recorded in the onboarding issue or PR body before apply.
6. **Admin bypass means partial workflow health.** If a PR needs admin merge
   because the required gate cannot run, the onboarding lane must record that as
   an incomplete remote-governance state, not as normal success.
7. **Agents supervise; they do not invent the baseline.** An agent may run the
   tool, inspect diffs, explain conflicts, and file follow-up issues. If the tool
   cannot perform a repeatable step, the agent records the tooling gap instead of
   hand-assembling a bespoke onboarding.

## Fully Onboarded

All of these must be true before using "fully onboarded":

| Area | Required evidence |
| --- | --- |
| Default branch | A fresh fetch shows `origin/<default>` contains the selected baseline files. |
| Local lane | For existing-repo repair, the onboarding PR merged and the primary checkout can fast-forward to the merged commit without overwriting unrelated work. For direct fresh bootstrap, the initial onboarding commit is already on the default branch and the working tree is clean. |
| Audit | The selected onboarding profile reports no missing baseline files and no unmanaged drift that the lane claimed to fix. |
| Manifest | `.github/archon-setup.json` exists on the default branch and records the selected features, created/skipped files, source snapshot SHAs, remote actions, and post-check status. |
| Workflows | Every required or documented workflow caller exists on the default branch. |
| Required gate | Branch protection does not require `repo-required-gate / decision` unless the default branch has the caller and GitHub has seen the check run. |
| PR process | For PR-based onboarding, the onboarding PR body records exact verification, known skips, deferred decisions, and linked issue closure. |
| Follow-ups | Any skipped or manual-only item has an issue, a queue entry, or an explicit owner decision. |

If any row is false, the repo is partially onboarded.

## What We Can Automate

These are deterministic and should be tool-owned:

| Work | Automation target |
| --- | --- |
| Repo identity | Resolve git root, default branch, origin URL, owner/repo, protected branch, and worktree state. |
| Existing-repo audit | Report selected baseline items as present, missing, drifted, skipped, or blocked without writing. |
| Basic completion verdict | `onboard --audit` must emit `audit.onboardingCompletion`; it is incomplete if required anchors, manifest provenance for the selected feature set, startup readiness, or any selected baseline item is missing or drifted. |
| Feature closure | Expand selected features through the registry so the UI, CLI, audit, and apply paths use the same plan. |
| Baseline file writes | Render managed files and managed blocks from one source path, with no ad hoc agent copies. |
| Manifest writes | Record source snapshots, selected features, created/skipped files, remote actions, and deferred post-checks. |
| Disposable lane setup | Create an issue-backed branch and worktree from fresh `origin/<default>`. |
| Workflow caller install | Add selected `.github/workflows/*.yml` callers from snapshots or provider refs. |
| Local syntax checks | Run markdown/link checks where available, `actionlint` for workflows, and `node --check` or test commands for installed scripts. |
| Required-check preflight | Read branch protection and workflow files before tightening named required checks. |
| Post-merge audit | Fetch the merged default-branch commit and re-run the selected onboarding audit against that exact tree. |
| Rollback metadata | Keep enough run state to open a revert or repair PR if post-merge audit fails. |
| Reporting | Produce an auditable result: applied, unchanged, skipped, blocked, or failed with a concrete reason. |

## What We Cannot Fully Automate

These still need human or explicit supervising-agent decisions:

| Decision | Why it is not fully automatable | Required handling |
| --- | --- | --- |
| Product truth | Existing docs and scripts can contain real project facts or stale process. | Extract candidates, then require an explicit keep/replace decision. |
| Unrelated histories | A repo may have a remote prototype history and a local curated history. | Require an owner-approved history strategy before any apply or force-risking action. |
| Deleting bespoke workflows | A workflow may protect a release, deployment, secret, or external system the tool cannot infer. | Classify and document the workflow before removal or replacement. |
| Secrets and billing | Tokens, secret values, Copilot billing, org seats, and external accounts are outside safe local automation. | Provide exact manual commands or checklists; never store secrets. |
| Admin bypass | Admin merge can be necessary during repair, but it bypasses the very checks onboarding is supposed to establish. | Treat as an exception with a recorded reason and follow-up repair. |
| Broad ecosystem distribution | Updating every repo is operationally risky and can overwrite project-specific policy. | Require owner confirmation and per-repo applied/unchanged/skipped/failed results. |
| Ambiguous repo-specific policy | Existing `AGENTS.md`, `CLAUDE.md`, release docs, or hooks may conflict with the baseline. | Preserve useful local facts outside managed blocks and record unresolved conflicts. |

## Basic Hardening Plan

### P0: Document The Contract

Current lane. Add this contract, link it from onboarding surfaces, and make
`onboard --audit` emit a machine-readable `audit.onboardingCompletion` verdict.
The verdict requires at least `AGENTS.md`, a valid `.github/archon-setup.json`
that records every selected feature being audited, and clean startup readiness
before the local audit can report completion. It also blocks completion when any
selected audit item is missing or drifted, except for repo-local files that
startup readiness validates semantically.

### P1: Default-Branch Completion Gate — Implemented

Extend the local completion verdict into a default-branch gate that can only
pass after the onboarding PR merges:

- fetch `origin/<default>`
- inspect the merged tree, not the stale worktree
- run the selected `onboard --audit` profile against a clean default-branch
  checkout or detached worktree
- verify `audit.onboardingCompletion.status` is `complete`
- verify every required workflow caller exists on that commit
- fail if branch protection requires a check whose caller is absent

`node bin/onboard.mjs verify-merged <repo> --record <path>` now performs this
gate in a detached worktree at fetched `origin/<default>` and emits
`fully_onboarded`, `partial_onboarding`, or `blocked`. It also blocks a merged
verification when branch protection requires the stable gate but its workflow
caller is absent from that default-branch commit.

### P2: Harden `tighten-required-gate`

Before adding `repo-required-gate / decision` to branch protection, the command
should prove:

- the target repo and default branch are resolved
- `.github/workflows/repo-required-gate.yml` exists on the default branch
- GitHub has a recent `repo-required-gate / decision` check from the expected app
- the manifest post-check belongs to the same repo/default branch being tightened

If any proof is missing, the command should leave branch protection unchanged
and report a pending or blocked status.

### P3: Make Manual Decisions Structured — Implemented

For existing repos, generate a decision record before apply. Each non-automatic
item gets one of:

- `apply-central`
- `keep-local`
- `merge-manual`
- `defer`
- `blocked`

`onboard repair <repo>` emits a versioned decision document (optionally saved
as a GitHub issue). Intake re-audits the target and refuses unresolved, stale,
or altered evidence. The apply path only accepts `apply-central`; all other
states stay out of the automated apply set and appear in the PR body.

### P4: Make Existing-Repo Repair A Tool Path — Implemented

Replace "agent manually patches the repo" with a repair command that:

- starts from fresh `origin/<default>`
- applies only selected missing baseline items
- preserves repo-specific managed-block content
- produces a PR body from the repo template
- runs a post-apply audit before commit
- marks incomplete remote-governance items as follow-ups

`onboard repair --intake` now creates the isolated branch/worktree, runs the
existing planner/executor, post-apply audit, conventional commit, push, and
draft PR flow. It preserves the human boundary: agents can monitor, explain,
and file follow-ups, but cannot invent decisions or auto-merge the repair.

### P5: Repair Affected Consumers Through The Contract

Consumer repos with partial onboarding, including the `sales` incident below,
should be repaired through the deterministic path once P1/P2 exist. Until then,
repair PRs must explicitly record any missing gate workflow, required-check
mismatch, or admin-bypass merge.

## Incident Evidence: `ArchonVII/sales`

On 2026-07-09, `ArchonVII/sales` showed the exact failure this contract forbids:

- `origin/archonvii-baseline` contained a complete ArchonVII onboarding manifest
  and baseline files.
- current `origin/main` did not contain `.github/`, `.agent/`, `AGENTS.md`,
  lifecycle scripts, close guards, doc-sweep scripts, or the setup manifest.
- branch protection still required `repo-required-gate / decision`.
- GitHub's current workflow list for the default branch had no required-gate
  caller, so normal PRs needed admin bypass.

That state is not "fully onboarded." It is a partial onboarding plus remote
governance drift.

## Agent Checklist

Before claiming an onboarding is complete, an agent must report:

- target path and resolved `owner/repo`
- default branch and merge commit checked
- selected feature profile
- audit result against the default-branch commit
- workflow caller presence on the default branch
- branch protection required checks
- manifest post-check state
- unresolved manual decisions or follow-ups

If any item is unavailable, say the repo is partially onboarded and name the
blocking evidence.
