# Decisioned Onboarding Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make existing-repository onboarding a decision-gated repair lane that produces auditable draft PRs and verifies completion on the merged default branch.

**Architecture:** Keep the onboarding feature registry, planner, executor, and audit as the source of truth. Add onboarding-specific decision/intake, repair-run, and merged-verification modules; reuse generic run records and command seams only where their contracts fit.

**Tech Stack:** Node.js ESM, Node test runner, `git`, GitHub CLI, existing onboarding planner/executor and audit modules.

**Plan Status:** Completed 2026-07-10; retained as delivery evidence for #348.

---

> **Status:** archived
> **Owner:** agent
> **Scope:** repo-local
> **Source of truth:** yes
> **Last reviewed:** 2026-07-10
> **Supersedes:** none
> **Superseded by:** none

**Source issue:** #348

## Decisions

- The new flow is onboarding-specific, not a premature generic migration framework.
- `apply-central` is the only decision that enters automated apply; `keep-local`, `merge-manual`, `defer`, and `blocked` are preserved and reported.
- A post-merge verification command is the only face allowed to report `fully_onboarded`.

## Tasks

### Task 1: Onboarding decision document and intake

**Files:** `src/server/onboard/`, `src/contracts/schemas/`, `test/`

1. Write failing tests for decision generation, invalid/missing resolutions, stale default-branch state, and the apply-only selection.
2. Add the minimal versioned schema and onboarding decision/intake module.
3. Run the focused tests red then green.

### Task 2: Local repair lane

**Files:** `src/server/onboard/`, `bin/onboard.mjs`, `test/`

1. Write failing tests for issue/worktree preflight, filtered application, local audit, and draft-PR request construction using injected command runners.
2. Add the repair runner using the existing `runOnboard()`/`auditPlan()` path; refuse writes before complete intake.
3. Add CLI parsing and machine-readable output without changing ordinary onboarding.
4. Run focused tests red then green.

### Task 3: Merged default-branch verifier

**Files:** `src/server/onboard/`, `bin/onboard.mjs`, `test/`

1. Write failing local-bare-origin fixture tests for a clean merged profile, incomplete default branch, and unreadable remote evidence.
2. Add the detached-worktree verifier that reports `fully_onboarded`, `partial_onboarding`, or `blocked`.
3. Run focused tests red then green.

### Task 4: Delivery artifacts and verification

**Files:** `docs/agent-process/deterministic-onboarding.md`, `docs/ONBOARDING_EXISTING_REPO.md`, `README.md`, `.changelog/unreleased/`, `docs/repo-update-log/`

1. Document the command contract and retained human approvals.
2. Add the changelog fragment and update log.
3. Run scoped tests, `npm test`, syntax checks, snapshot verification when applicable, and `git diff --check`.
4. Mark this plan and the execution ledger complete before PR readiness.

## Plan Closeout

Completed 2026-07-10. The repair decision/intake, issue transport, isolated
draft-PR runner, and fetched-default-branch verifier were implemented with
focused red/green tests. Full verification: `npm test` (682 tests, 680 pass,
0 fail, 2 skipped), `npm run snapshots:verify`, syntax checks for the new CLI
and modules, and `git diff --check` all passed. No remaining scoped work.
