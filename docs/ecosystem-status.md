# Ecosystem Status — ArchonVII

_Last updated: 2026-05-20 by Manager_

The canonical "what is the ecosystem doing right now?" document for the four ArchonVII sibling repos. Update this file as part of every ecosystem-wide rollout (step 4 of the playbook below).

## Topology

Four sibling repos under [@ArchonVII](https://github.com/ArchonVII), hub-and-spoke by data flow — no master repo, but `archon-setup` is the integration hub.

- [`ArchonVII/.github`](https://github.com/ArchonVII/.github) — org-level community-health defaults
- [`ArchonVII/github-workflows`](https://github.com/ArchonVII/github-workflows) — reusable workflows pinned at `@v1`
- [`ArchonVII/repo-template`](https://github.com/ArchonVII/repo-template) — passive baseline; `AGENTS.md` is the canonical cross-tool contract
- [`ArchonVII/archon-setup`](https://github.com/ArchonVII/archon-setup) — integration hub. Consumes the other three as read-only snapshots under `src/snapshots/`. Hosts this file.

`archon-setup` is the only consumer; the other three are providers.

## Rollout playbook

Every ecosystem-wide change follows this order. Skip steps that don't apply, but never reorder them.

1. **Provider repo PRs.** Land changes upstream first — in `.github`, `github-workflows`, and/or `repo-template`. Capture each squash-merge SHA.
2. **Version/tag update if needed.** When a `github-workflows` change must reach consumers, force-move the `v1` tag to the merge SHA:
   ```
   gh api -X PATCH repos/ArchonVII/github-workflows/git/refs/tags/v1 \
     -f sha=<merge-sha> -F force=true
   ```
   Verify with `gh api repos/ArchonVII/github-workflows/git/refs/tags/v1`. Anything depending on `@v1` now sees the new workflow.
3. **`archon-setup` snapshot refresh.** Pull provider `main` branches locally, then in `archon-setup`:
   ```
   git -C ../github-workflows pull
   git -C ../repo-template pull
   git -C ../.github pull
   npm run refresh-snapshots
   node --test 'test/*.mjs'
   ```
   Commit as `chore(snapshots): refresh after <upstream PRs>`. Open + merge the archon-setup PR.
4. **Update `ecosystem-status.md`.** This file. Move shipped items into Recently Completed, refresh in-flight PR state, record any decisions made.
5. **Issue cleanup / dedupe.** Close issues that the rollout resolved, dedup any stragglers, label what remains.

Notes:

- `scripts/refresh-snapshots.mjs` writes only `source`/`ref`/`sha`/`capturedAt`/`path` in `manifest.json`. Hand-added fields (e.g. `contents`) are dropped on refresh.
- For agent-managed code PRs in providers, do not self-merge (see [Owner Maintenance Lane decision](#decision-log)).
- The exemplar three-repo rollout is the v0.1.1 anomaly-triage capability (2026-05-13): `github-workflows#2 → 7fc2dea`, `repo-template#2 → bfc226d`, `archon-setup#2 → 29ba240`.

## Active workstreams

| Repo               | Status                                | Detail                                                                                                                    |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `github-workflows` | **PR #19 draft, CI green, mergeable** | F2/F10 evidence parser + warning-only pr-policy wiring. One checkbox flip away from ready-for-review.                     |
| `archon-setup`     | Clean on `main`                       | Recent burst: required-gate scaffold, F1 repo-ci.\* features, F3 actionlint snapshot caller, managed-repo update command. |
| `repo-template`    | Clean on `main`                       | Recent: `.githooks/` baseline (F18), F3 actionlint workflow-syntax check, required-gate baseline.                         |
| `.github`          | Clean on `main`                       | Untouched since 2026-05-09.                                                                                               |

## In-flight PRs

| Repo               | PR                                                           | Title                                                  | Branch                                | State                      |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------- | -------------------------- |
| `github-workflows` | [#19](https://github.com/ArchonVII/github-workflows/pull/19) | F2/F10 evidence parser + warning-only pr-policy wiring | `agent/claude/f2-f10-evidence-parser` | Draft, CI green, mergeable |

## F-roadmap

Feature IDs come from the `docs/phase2/findings.md` numbering. Severity reflects the original finding.

| ID  | Title                                          | Status                                         | Severity | Tracking issue                      |
| --- | ---------------------------------------------- | ---------------------------------------------- | -------- | ----------------------------------- |
| F1  | `repo-ci.*` features in registry               | **Shipped**                                    | —        | archon-setup #19 (`0510307`)        |
| F2  | `pr-policy` evidence enforcement               | **In flight (Phase 1)**                        | high     | github-workflows #10; PR #19        |
| F3  | actionlint workflow + caller                   | **Shipped**                                    | medium   | repo-template #17, archon-setup #18 |
| F4  | Format-on-edit authority duplication           | Open                                           | medium   | `.github` #11                       |
| F5  | Demote lint-on-edit to advisory                | Open                                           | medium   | `.github` #12                       |
| F6  | Close-scan marker semantics                    | Open                                           | medium   | `.github` #13                       |
| F7  | Agent role separation / Owner Maintenance Lane | **Decided 2026-05-17, implementation pending** | high     | `.github` #14                       |
| F8  | Worktree-per-task discipline                   | Open                                           | medium   | `.github` #15                       |
| F9  | Extended claim schema baseline                 | Open                                           | medium   | repo-template #14                   |
| F10 | Verification evidence format                   | **In flight (paired with F2)**                 | medium   | github-workflows #12; PR #19        |
| F11 | Release-Admiral "finish it" merge contract     | Open                                           | medium   | `.github` #16                       |
| F13 | `.agent/check-map.yml` + recommender           | Open                                           | medium   | repo-template #12                   |
| F14 | Single targeted-ci-gate required check         | Open                                           | medium   | github-workflows #8                 |
| F15 | Actions hardening (least-priv, SHA-pin, …)     | Open                                           | medium   | github-workflows #14                |
| F16 | Per-PR durable history records                 | Open                                           | low      | `.github` #17                       |
| F18 | `.githooks/` baseline                          | **Shipped**                                    | —        | repo-template #16/#18               |
| F19 | Issue-Admiral triage role                      | Open                                           | low      | `.github` #18                       |

## Backlog (prioritized)

1. **Ship PR #19** → force-move `v1` → refresh snapshots. Unblocks Phase 2 (flipping `enforce-evidence: true`).
2. **Template walkthrough** — refresh PR template + issue forms + AGENTS.md against the new F2/F10 evidence shape and F7 owner-lane semantics. Single coordinated three-PR pass.
3. **F7 implementation** — `.github` #14 scoped policy, hook updates in `repo-template` (`commit-msg` accepts `docs(owner):` / `chore(owner):`; `pre-commit` allows add-only safe main commits), AGENTS.md owner-lane section in `repo-template`.
4. **Branch-protection 400 anomaly** — file via the anomaly-triage workflow on next `archon-setup` PR. Reference fix already exists in `archon-setup/src/server/tasks/applyBaselineBranchProtection.mjs`.
5. **Events-stream rollout** — `.archon/events.jsonl` schema in `repo-template` AGENTS.md + `agent-workflow.events-stream` feature in `archon-setup`. Same three-PR pattern as anomaly-triage; renderer (status board UI inside archon-setup's local server) deferred to v0.2.

## Recently completed

- **2026-05-20** — Opened `github-workflows` PR #19 (F2/F10 evidence parser, Phase 1, warning-only).
- **2026-05-19** — Required-gate baseline landed in `repo-template` (PR #15) and `archon-setup` (`9efb514`).
- **2026-05-19** — `.githooks/` baseline (commit-msg + main guard) merged in `repo-template` (#16/#18). F18 shipped.
- **2026-05-19** — F3 actionlint workflow-syntax check merged in `repo-template` (#17) + archon-setup snapshot caller (#18).
- **2026-05-19** — F1 `repo-ci.*` features added to archon-setup registry (#19).
- **2026-05-14** — ArchonVII workflow baseline adopted by `comfyui-companion` (PR #41) and `pigafetta-gravity` (PR #35). First downstream consumers beyond the four ecosystem repos.
- **2026-05-13** — v0.1.1 anomaly-triage capability shipped across three coordinated PRs (`github-workflows#2 → 7fc2dea`, `repo-template#2 → bfc226d`, `archon-setup#2 → 29ba240`). Exemplar three-repo rollout.
- **2026-05-13** — `archon-setup` v0.1.0 scaffold shipped.

## Decision log

| Date       | Decision                                                                                                                                                                                                                                                             | Why                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-20 | This `ecosystem-status.md` is the canonical "what's the ecosystem doing" doc. Lives in `archon-setup/docs/` because that repo is the integration hub.                                                                                                                | Resolves where ecosystem-wide coordination state belongs. No fifth "master" repo.                                                                        |
| 2026-05-17 | **Owner Maintenance Lane (F7).** Solo-dev policy of three lanes (Owner / Agent-managed / Default), enforced by path scope, not author identity. Owner lane allows direct `main` commits for add-only safe docs/images; agent-managed code PRs hard-block self-merge. | A universal self-merge block would prevent legitimate GitHub Desktop maintenance and can't distinguish agent from human commits under the same identity. |
| 2026-05-14 | Phase 2 review findings tracked as `phase2`-labeled issues, F-numbered from `docs/phase2/findings.md`.                                                                                                                                                               | Single numbering scheme across `.github` + `github-workflows` + `repo-template`.                                                                         |
| 2026-05-13 | Tool-agnostic capabilities ship as **reusable workflow + AGENTS.md contract** — never as a per-CLI skill.                                                                                                                                                            | A capability shipped as "a Claude skill on the user's machine" excludes Codex, Gemini, and future agents. Workflows + contracts are read by every agent. |
| 2026-05-13 | `archon-setup` is the only consumer of the other three; the others are providers. SHA-pinned snapshots under `src/snapshots/`.                                                                                                                                       | Deterministic archon-setup builds without coupling provider release cadence.                                                                             |

## Parking lot

Ideas discussed but not yet planned:

- **Windows installer** for `archon-setup` (Inno Setup `.iss` + release-build workflow + Start Menu shortcut). Workstream B of v0.1.1; not started.
- **Status board UI** inside archon-setup's existing local server, rendering `.archon/events.jsonl`. Deferred to v0.2 once real events accumulate.
- **`rollout-playbooks/` subdirectory** — split out per-capability playbooks if more than one accumulates. Single inline playbook above is sufficient for now.
- **Re-enable `react/no-unescaped-entities`** in `comfyui-companion` after fixing the apostrophes in `web/src/{FilesBrowser,Groups}.tsx`.

## Updating this doc

This file is the canonical ecosystem status — but it's only as fresh as the last person who touched it. Update on:

- **Step 4 of every rollout** (mandatory).
- After any cross-repo decision (add a row to the Decision log).
- When any phase2 issue's status changes (Open → In flight → Shipped — row moves).
- When a new repo joins or leaves the ecosystem (update Topology, start/stop tracking).

Keep entries terse. Detail belongs in the relevant repo's `repo-update-log.md`, in the PR description, or in agent memory.
