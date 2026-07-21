# Ecosystem Status — ArchonVII

_Last updated: 2026-07-01 by Claude (docs reconciliation lane #319)_

The ecosystem **process + history** document: the rollout playbook, the fix queue, the decision log, and the completed-rollout record. Each volatile concern now has exactly one owner doc — do not duplicate their content here (#319):

- **Repo map / roles / change routing** → [`docs/ecosystem-overview.md`](./ecosystem-overview.md) (repo-map table is generated from `config/ecosystem-map.json`; `npm run update-ecosystem-overview`).
- **Current work** — active lanes, blocked-by, held PRs, decision gates → [`docs/CURRENT_WORK.md`](./CURRENT_WORK.md).
- **Machine-readable live state** (ports, dirty worktrees, governance posture) → `ecosystem-state.json` per [`docs/ECOSYSTEM_STATE.md`](./ECOSYSTEM_STATE.md).

## Topology

See the generated repo map and the "Change routing — to change X, edit Y first" table in [`docs/ecosystem-overview.md`](./ecosystem-overview.md). (A hand-maintained copy of that table lived here until 2026-07-01; it had drifted and was removed in #319.)

## Active health registry

`src/server/ecosystem/repoRegistry.json` is the explicit local registry consumed by `npm run snapshot` and the Ecosystem screen before any fallback `C:\GitHub` root scan. Active entries are scanned into `ecosystem-state.json` `repos[]`; inactive entries remain visible in `repoRegistry.repositories[]` so agents know they are deliberately excluded.

Active as of 2026-06-12: `archon`, `archon-setup`, `github-workflows`, `repo-template`, `.github`, `pigafetta`, `jma-history`, `skills-review` (`ArchonVII/jma-skill-review` at `C:\Users\josep\skills`), and `hudson-bend`.

Inactive as of 2026-06-12: `jma-ui`.

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

## Ecosystem Fix Queue

Use this queue for small source-of-truth fixes that should be reviewed together
before the next `archon-setup` snapshot refresh. It is a curated coordinator
view, not a replacement for GitHub issues or provider PRs.

Statuses:

- `proposed` - fix identified; source-of-truth target and owner decision still
  need review.
- `source-pr` - provider or repo-local PR is in progress.
- `ready-for-batch` - source PR has landed and can be included in the next
  snapshot refresh or coordinator batch.
- `batched` - selected for the current batch PR.
- `shipped` - batch PR landed and follow-up issues/status were cleaned up.
- `deferred` - intentionally parked; do not include in the next batch.

Queue rows must name the issue or incident, source-of-truth target, intended
fix, snapshot impact, consumer action, and batch notes. Do not run
`npm run refresh-snapshots` for every small provider/doc change by default;
batch low-urgency source updates here unless the owner asks for an immediate
snapshot refresh or the change unblocks active work.

| ID | Status | Source | Source-of-truth target | Intended fix | Snapshot impact | Consumer action | Batch notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q-2026-06-09-pr-composition | proposed | Page GM `gm-20260609-133354-d0dec701`; archon-setup #149 | `archon-setup` repo-local policy first; possible later `repo-template` propagation | Clarify that atomic commits are not atomic PRs, and companion docs/changelog/status edits for the same issue phase ride in the same PR. | None unless promoted to `repo-template`. | No global AGENTS distribution in the first slice. | Review after #149; decide whether future generated repos need the same rule. |

## Active workstreams and in-flight PRs

Owned by [`docs/CURRENT_WORK.md`](./CURRENT_WORK.md) — the single current-work map. (The tables that lived here were a second copy and had drifted three weeks behind reality by 2026-07-01; removed in #319.)

## F-roadmap

Feature IDs come from the `docs/phase2/findings.md` numbering. Severity reflects the original finding.

Review note, 2026-06-12: no F-number status transition was identified during the #230 status refresh. Current execution focus is the Agent OS roadmap (#229), document-policy epic (#223), and the registry/dashboard epic (#212); update the rows below only when a tracked F-number issue changes state.

| ID  | Title                                          | Status                                                 | Severity | Tracking issue                                         |
| --- | ---------------------------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------ |
| F1  | `repo-ci.*` features in registry               | **Shipped**                                            | —        | archon-setup #19 (`0510307`)                           |
| F2  | `pr-policy` evidence enforcement               | **Shipped (Phase 1 warning/evidence path)**            | high     | github-workflows #10; PR #19/#22                       |
| F3  | actionlint workflow + caller                   | **Shipped**                                            | medium   | repo-template #17, archon-setup #18                    |
| F4  | Format-on-edit authority duplication           | Open                                                   | medium   | `.github` #11                                          |
| F5  | Demote lint-on-edit to advisory                | Open                                                   | medium   | `.github` #12                                          |
| F6  | Close-scan marker semantics                    | Open                                                   | medium   | `.github` #13                                          |
| F7  | Agent role separation / Owner Maintenance Lane | **Partially shipped; `.github` scoped policy remains** | high     | `.github` #14; github-workflows #26; repo-template #21 |
| F8  | Worktree-per-task discipline                   | Open                                                   | medium   | `.github` #15                                          |
| F9  | Extended claim schema baseline                 | Open                                                   | medium   | repo-template #14                                      |
| F10 | Verification evidence format                   | **Shipped (paired with F2 Phase 1)**                   | medium   | github-workflows #12; PR #19/#22                       |
| F11 | Release-Admiral "finish it" merge contract     | Open                                                   | medium   | `.github` #16                                          |
| F13 | `.agent/check-map.yml` + recommender           | Open                                                   | medium   | repo-template #12                                      |
| F14 | Single targeted-ci-gate required check         | **Shipped; `v1` moved 2026-05-29**                     | medium   | github-workflows #8/#23                                |
| F15 | Actions hardening (least-priv, SHA-pin, …)     | Open                                                   | medium   | github-workflows #14                                   |
| F16 | Per-PR durable history records                 | Open                                                   | low      | `.github` #17                                          |
| F18 | `.githooks/` baseline                          | **Shipped**                                            | —        | repo-template #16/#18                                  |
| F19 | Issue-Admiral triage role                      | Open                                                   | low      | `.github` #18                                          |

## Backlog

Owned by [`docs/CURRENT_WORK.md`](./CURRENT_WORK.md) (active lanes + decision gates) and the issue tracker; the 2026-07-01 staleness triage of the long tail is [archon-setup#318](https://github.com/ArchonVII/archon-setup/issues/318). (The numbered backlog that lived here referenced 2026-06-11-era PRs; removed in #319.)

## Recently completed

- **2026-07-21** — Final verified-carry safety fixes landed in repo-template
  [#214](https://github.com/ArchonVII/repo-template/pull/214) at exact merge SHA
  `e1cb10f0f4f0fefc85718d6be0a6230b49341bf4`. Archon Setup issue
  [#393](https://github.com/ArchonVII/archon-setup/issues/393) / PR
  [#394](https://github.com/ArchonVII/archon-setup/pull/394) carries only that
  provider and self-applies it. The next authorized consumer is the existing
  Hudson Bend repair PR #383; the paused #370 feature lane remains untouched.

- **2026-07-20** — Follow-up provider fixes landed in repo-template
  [#203](https://github.com/ArchonVII/repo-template/pull/203) (deletion-only
  carry and cross-boundary rename safety) and
  [#205](https://github.com/ArchonVII/repo-template/pull/205) (deterministic
  cross-platform line endings). Archon Setup PR
  [#390](https://github.com/ArchonVII/archon-setup/pull/390) then repaired the
  two delayed #386 review findings and refreshed their provider baseline.
  Receipt-bound carry cleanup landed separately in repo-template
  [#210](https://github.com/ArchonVII/repo-template/pull/210), followed by
  [#212](https://github.com/ArchonVII/repo-template/pull/212) for verified
  staged directory-mode preservation; Archon Setup issue
  [#391](https://github.com/ArchonVII/archon-setup/issues/391) / PR
  [#392](https://github.com/ArchonVII/archon-setup/pull/392) refreshed only that
  reviewed provider chain to exact merge SHA
  `e413928c0d029b8d6f0d718b64ea939fe5033fbe`; the later #214/#394 correction is
  recorded above.

- **2026-07-19** — The repo-template provider chain landed verified explicit
  task-input carry ([#193](https://github.com/ArchonVII/repo-template/pull/193)),
  advisory rather than hard-blocking charter budgets
  ([#196](https://github.com/ArchonVII/repo-template/pull/196)), and a real
  PowerShell body-file path for npm PR-contract validation
  ([#197](https://github.com/ArchonVII/repo-template/pull/197)), explicit
  documentation command ownership
  ([#199](https://github.com/ArchonVII/repo-template/pull/199)), and the required
  provider-owned documentation runtime in startup readiness
  ([#201](https://github.com/ArchonVII/repo-template/pull/201)). Archon-setup
  [#386](https://github.com/ArchonVII/archon-setup/pull/386) first landed the
  integrator execution-closure behavior. Issue
  [#385](https://github.com/ArchonVII/archon-setup/issues/385) then refreshes the
  single repo-template snapshot through exact SHA
  `318fb1c6612a1bc89c33e1f0661d31e4c6eef74f`, self-applies the managed root
  baseline, and records the five-fix boundary without initiating a
  full-ecosystem distribution.

- **2026-06-30 / 2026-07-01** — Onboarding-hardening arc [#307](https://github.com/ArchonVII/archon-setup/issues/307) Phases A/B/C/E landed: `archon-setup` PRs [#308](https://github.com/ArchonVII/archon-setup/pull/308)–[#312](https://github.com/ArchonVII/archon-setup/pull/312) (managed Delivery-Workflow block, Mode-2 changelog default, coordination path, planner/parity fixes) + snapshot re-vendor [#316](https://github.com/ArchonVII/archon-setup/pull/316) (`repoTemplate @ 4ddf930`, exec-bit `100755`, root self-apply); `repo-template` PRs [#133](https://github.com/ArchonVII/repo-template/pull/133)–[#137](https://github.com/ArchonVII/repo-template/pull/137). Delivered issues closed with evidence 2026-07-01; remaining: Phase D, [#317](https://github.com/ArchonVII/archon-setup/issues/317), Phase F. The 2026-07-01 **ecosystem friction arc** (verification contract, CI fan-out, docs truth — see CURRENT_WORK) started the same day.

- **2026-06-20** — Repo-update-log fragment enforcement shipped through the
  source chain: `github-workflows` issue [#92](https://github.com/ArchonVII/github-workflows/issues/92)
  / PR [#93](https://github.com/ArchonVII/github-workflows/pull/93) added the
  reusable guard and moved `v1` to `db5a917`; `repo-template` issue
  [#111](https://github.com/ArchonVII/repo-template/issues/111) / PR
  [#112](https://github.com/ArchonVII/repo-template/pull/112) added the
  template caller and local close-scan `repo-update-log` check; `archon-setup`
  issue [#270](https://github.com/ArchonVII/archon-setup/issues/270) refreshes
  snapshots to `githubWorkflows@db5a917` and `repoTemplate@98a08fa`, then
  self-applies the new workflow caller into the integrator root baseline and
  registers it as a locked default onboarding feature.
- **2026-06-12** — Agent OS Stage 0/1 repo-template provider batch merged and is being snapshotted by `archon-setup` [#232](https://github.com/ArchonVII/archon-setup/issues/232): anomaly triage caller (`repo-template` PR [#80](https://github.com/ArchonVII/repo-template/pull/80)), doc-orphan detector wiring (PR [#79](https://github.com/ArchonVII/repo-template/pull/79)), default-branch hook repair (PR [#81](https://github.com/ArchonVII/repo-template/pull/81)), local close-scan guard (PR [#82](https://github.com/ArchonVII/repo-template/pull/82)), and friction ledger contract (PR [#83](https://github.com/ArchonVII/repo-template/pull/83)).
- **2026-06-12** — Agent OS Stage 0 `archon-setup` lanes [#230](https://github.com/ArchonVII/archon-setup/issues/230) and [#231](https://github.com/ArchonVII/archon-setup/issues/231) merged via PRs [#236](https://github.com/ArchonVII/archon-setup/pull/236) and [#235](https://github.com/ArchonVII/archon-setup/pull/235).
- **2026-06-12** — Ecosystem registry and maintenance rollout lanes 0-2 shipped in `archon-setup`: spec PR [#213](https://github.com/ArchonVII/archon-setup/pull/213) (`3fe47b0`), registry seed/overlay + port policy + maintenance contract PR [#222](https://github.com/ArchonVII/archon-setup/pull/222) (`4d00804`, closed [#214](https://github.com/ArchonVII/archon-setup/issues/214)), and maintenance status engine + fastStatus + snapshot wiring PR [#228](https://github.com/ArchonVII/archon-setup/pull/228) (`f67a081`, closed [#215](https://github.com/ArchonVII/archon-setup/issues/215)).
- **2026-06-12** — Agent OS roadmap epic [#229](https://github.com/ArchonVII/archon-setup/issues/229) filed Stage 0/1 lanes; the owner-approved roadmap moved into this repo at [`docs/plans/2026-06-12-os-roadmap.md`](./plans/2026-06-12-os-roadmap.md) and the current-work map at [`docs/CURRENT_WORK.md`](./CURRENT_WORK.md).
- **2026-06-12** — `jma-skill-review` PRs [#183](https://github.com/ArchonVII/jma-skill-review/pull/183) and [#184](https://github.com/ArchonVII/jma-skill-review/pull/184) merged; PR [#180](https://github.com/ArchonVII/jma-skill-review/pull/180) remains open.
- **2026-06-10** — Plan/status artifact closeout guidance shipped across
  `jma-history` #289, `jma-skill-review` #139, and `repo-template` #63. This
  lane refreshes the `archon-setup` repo-template snapshot to `292dada` and adds
  global update record `2026-06-10-plan-status-closeout` for existing repo
  distribution.
- **2026-06-09** — Granular distributor PR1 merged (#146: region engine, adapters, marker lint/manifest); canonical ecosystem overview (#148), fix queue process (#150), CRLF-robust sync gate (#152). Filed the e2e ecosystem-management roadmap (umbrella #154, milestones #155–#165) and recorded the auto-merge distribution-lane decision (below).
- **2026-06-09** — Released the `github-workflows` Go lane: moved `v1` to `c1ad03e` (#140), refreshed `archon-setup` snapshots across #139/#141/#142 (`githubWorkflows@c1ad03e`, `repoTemplate@de95850`, `orgDefaults@1962f27`), and added the active repo health registry (#144). Began the granular marker-based distributor (#145).
- **2026-06-09** — Moved `github-workflows` `v1` to `dc64da5` (#58) and refreshed `archon-setup` snapshots (#168) so generated required-gate callers no longer rerun on arbitrary PR label changes.
- **2026-06-09** — Moved `github-workflows` `v1` to `62d3f86` (#60) and refreshed `archon-setup` snapshots (#170) so generated required-gate callers preserve the `ci:full` label escape hatch without letting other label changes invoke or cancel the gate.
- **2026-06-09** — Moved `github-workflows` `v1` to `af0ac6e` (#62) and refreshed `archon-setup` snapshots (#172) so skipped non-`ci:full` label-only workflow runs use a separate `label-skip-*` concurrency group and cannot replace pending real gate runs.
- **2026-06-05** — `repo-template` PR #47 expanded the Owner Maintenance Lane safe docs set to add-only `docs/**` by default while preserving explicit unsafe docs paths.
- **2026-06-02** — Distribution/lifecycle rollout landed in `archon-setup`: no-remote smoke-test policy + leaked-repo cleanup (#81), npm publication prep (#83), workflow drift detection + upgrade (#87), `.archon/events.jsonl` stream + ecosystem "Recent events" view (#89), thin Windows `npx` bootstrap `install.ps1` (#91), staged-disabled Copilot/secrets (#93), and the agent-lifecycle baseline (#64). Owner-gated remainder: delete the five leaked smoke-test repos, `npm publish`, and real secret values.
- **2026-05-31** — `archon-setup` issue #59 completed through merged PR #60; snapshot manifest now records `github-workflows@v1` `00fbaab`, `repo-template` `7aa1e91`, and `.github` `0717902`.
- **2026-05-31** — Strict PR contract provider rollout landed across `github-workflows` #39, `repo-template` #30, and `.github` #23; `archon-setup` #67 refreshed snapshots to `github-workflows@90c0a89`, `repo-template@a328461`, and `.github@792fc81`.
- **2026-05-29** — Moved `github-workflows` `v1` to `007ad49` after the F14/F7 workflow merges and shipped `archon-setup` #29 to refresh snapshots for #28.
- **2026-05-28** — `github-workflows` role-separation PR #27 and `repo-template` Owner Maintenance Lane PR #22 merged.
- **2026-05-21** — `github-workflows` F14 targeted-gate lanes PR #23 merged.
- **2026-05-20** — `github-workflows` F2/F10 Phase 1 evidence parser work entered review.
- **2026-05-19** — Required-gate baseline landed in `repo-template` (PR #15) and `archon-setup` (`9efb514`).
- **2026-05-19** — `.githooks/` baseline (commit-msg + main guard) merged in `repo-template` (#16/#18). F18 shipped.
- **2026-05-19** — F3 actionlint workflow-syntax check merged in `repo-template` (#17) + archon-setup snapshot caller (#18).
- **2026-05-19** — F1 `repo-ci.*` features added to archon-setup registry (#19).
- **2026-05-14** — ArchonVII workflow baseline adopted by `comfyui-companion` (PR #41) and `pigafetta-gravity` (PR #35). First downstream consumers beyond the four ecosystem repos.
- **2026-05-13** — v0.1.1 anomaly-triage capability shipped across three coordinated PRs (`github-workflows#2 → 7fc2dea`, `repo-template#2 → bfc226d`, `archon-setup#2 → 29ba240`). Exemplar three-repo rollout.
- **2026-05-13** — `archon-setup` v0.1.0 scaffold shipped.

## Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-09 | **Auto-merge distribution lane (#154/#159).** Owner-initiated mechanical distribution PRs — decision-doc-backed refresh runs executed by `archon-setup` — may enable auto-merge once required checks pass, behind a machine-enforced eligibility gate: explicit confirmation phrase, all decision items resolved (no conflict auto-resolved), category + changed-path allowlists (initially `agents` / `AGENTS.md` + `.archon/region-ownership.json`), `automated-distribution` label, PR body links the decision doc + issue, post-apply audit clean. Each new category expands the allowlist in its own reviewed PR. Agent code PRs keep the F7 no-self-merge rule. No pre-change safety commit: writes happen only in a disposable worktree on a branch cut from `origin/main`, so the recorded base SHA is the fallback and rollback is a revert PR through the same gate. | "Update Repo" must land end-to-end without a human merge step; a narrow, auditable, machine-enforced gate is safer than widening the F7 owner lane or trusting agent memory. |
| 2026-06-02 | **No-remote smoke-test policy (#43).** Smoke tests must not create persistent GitHub repos. The fresh-repo remote path is exercised hermetically against a local bare repo via a `gh` mock; any live-GitHub smoke test is opt-in, uses exactly one repo, and must stop if it cannot delete. The five repos leaked by PR #41 are one-time manual cleanup via `scripts/cleanup-smoketest-repos.mjs`. | Removes the leaked-repo failure mode at the root instead of adding cleanup machinery, avoids granting broad `delete_repo` authority to agent sessions, and keeps CI reproducible without GitHub API/auth flakiness. |
| 2026-06-05 | **Owner Maintenance Lane docs safe paths.** Add-only `docs/**` files are owner-maintenance safe by default, while explicit unsafe docs paths such as `docs/process/**` and `docs/architecture/**` still require normal PR lanes. | Lets low-risk docs that agents strand or prepare locally land quickly without weakening policy docs, architecture docs, code, config, or non-additive changes. |
| 2026-05-31 | Strict PR readiness is enforced as executable policy, not agent memory: one shared validator, blessed ready wrapper, and expensive CI behind the cheap contract.                                                                                                                                                                                                                                   | Malformed ready-for-review transitions cost paid CI and have recurred; invalid PR metadata must be unrepresentable through the blessed path.                                                                        |
| 2026-05-31 | Move `github-workflows` `v1` to `00fbaab` after node-ci cache manager auto-detection PR #33.                                                                                                                                                                                                                                                                                                       | Keeps generated `@v1` callers aligned with the current reusable Node CI behavior without changing caller files.                                                                                                     |
| 2026-05-29 | Move `github-workflows` `v1` to `007ad49` after F14 and F7 because the changes are additive/default-warning-only and current snapshot callers depend on new reusable-workflow inputs and helper scripts.                                                                                                                                                                                           | Keeps `@v1` callers and helper-script checkout refs version-aligned; avoids generating callers that pass inputs unsupported by the old tag.                                                                         |
| 2026-05-20 | This `ecosystem-status.md` is the canonical "what's the ecosystem doing" doc. Lives in `archon-setup/docs/` because that repo is the integration hub.                                                                                                                                                                                                                                              | Resolves where ecosystem-wide coordination state belongs. No fifth "master" repo.                                                                                                                                   |
| 2026-05-17 | **Owner Maintenance Lane (F7).** Solo-dev policy of three lanes (Owner / Agent-managed / Default), enforced by path scope, not author identity. Owner lane allows direct `main` commits for add-only safe docs/images; agent-managed code PRs hard-block self-merge.                                                                                                                               | A universal self-merge block would prevent legitimate GitHub Desktop maintenance and can't distinguish agent from human commits under the same identity.                                                            |
| 2026-05-14 | Phase 2 review findings tracked as `phase2`-labeled issues, F-numbered from `docs/phase2/findings.md`.                                                                                                                                                                                                                                                                                             | Single numbering scheme across `.github` + `github-workflows` + `repo-template`.                                                                                                                                    |
| 2026-05-13 | Tool-agnostic capabilities ship as **reusable workflow + AGENTS.md contract** — never as a per-CLI skill.                                                                                                                                                                                                                                                                                          | A capability shipped as "a Claude skill on the user's machine" excludes Codex, Gemini, and future agents. Workflows + contracts are read by every agent.                                                            |
| 2026-05-13 | `archon-setup` is the only consumer of the other three; the others are providers. SHA-pinned snapshots under `src/snapshots/`.                                                                                                                                                                                                                                                                     | Deterministic archon-setup builds without coupling provider release cadence.                                                                                                                                        |

## Parking lot

Ideas discussed but not yet planned:

- **Native Windows installer** for `archon-setup` (winget/scoop or Inno Setup `.iss`). The thin `npx` bootstrap (`install.ps1`, #91) shipped; native installers stay deferred (design-only stubs in `docs/installer/`).
- **Status board UI** — a minimal "Recent events" section now renders in the ecosystem snapshot (#89); a richer interactive board remains deferred to v0.2 once real events accumulate.
- **`rollout-playbooks/` subdirectory** — split out per-capability playbooks if more than one accumulates. Single inline playbook above is sufficient for now.
- **Re-enable `react/no-unescaped-entities`** in `comfyui-companion` after fixing the apostrophes in `web/src/{FilesBrowser,Groups}.tsx`.

## Updating this doc

This file owns process + history (playbook, fix queue, decision log, completed rollouts) — it is only as fresh as the last person who touched it. Update on:

- **Step 4 of every rollout** (mandatory): add a Recently-completed entry.
- After any cross-repo decision (add a row to the Decision log).
- When any phase2 issue's status changes (Open → In flight → Shipped — row moves).

Do **not** re-grow duplicated sections here: current work belongs in [`docs/CURRENT_WORK.md`](./CURRENT_WORK.md); the repo map and change routing belong in [`docs/ecosystem-overview.md`](./ecosystem-overview.md) (generated block + `npm run update-ecosystem-overview`); live machine state belongs in `ecosystem-state.json` ([`docs/ECOSYSTEM_STATE.md`](./ECOSYSTEM_STATE.md)). When a new repo joins or leaves the ecosystem, edit `config/ecosystem-map.json` / `src/server/ecosystem/repoRegistry.json` and regenerate — not prose here.

Keep entries terse. Detail belongs in the relevant repo's `repo-update-log.md`, in the PR description, or in agent memory.
