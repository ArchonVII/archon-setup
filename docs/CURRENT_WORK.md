# Current Work - ArchonVII Agent OS

Updated: 2026-06-21 — **Stage 1 friction telemetry running** (clock started 2026-06-15T20:14:07Z; ~day 6 of the two-week window, decision point ~2026-06-29). #238 applied + verified + closed. This pass cleared two debt items: the AI-discovered backlog was triaged + closed/dispatched, and the worktree prune debt was closed (see Hygiene). Base rebuild: archon-setup#242 (supersedes [PR #243](https://github.com/ArchonVII/archon-setup/pull/243)).

Update rule: update this file in the same PR whenever a lane merges, a lane issue is filed, or a decision gate changes. Keep it as the single current-work map; detailed history belongs in the linked issue, PR, roadmap, or `docs/ecosystem-status.md`.

Roadmap source: [`docs/plans/2026-06-12-os-roadmap.md`](./plans/2026-06-12-os-roadmap.md).

## Orientation (60-second map)

The Agent OS is **five meta repos** — `.github` (org defaults), `github-workflows` (reusable workflows `@v1`), `repo-template` (template + AGENTS contract), `archon-setup` (the hub: feature registry + ecosystem registry + maintenance engine + onboarding wizard), and `jma-skill-review` / `jma-skills-data` (skills tooling + content) — plus their consumers. `archon` (the flagship AI-native terminal) is the **heaviest consumer and a first-party fleet candidate, not OS-core** (see Stage 1 / [#258](https://github.com/ArchonVII/archon-setup/issues/258)).

North star: an OS that survives model/tooling change and is *visually inspectable* — a live workflow graph generated from real config (epic [#212](https://github.com/ArchonVII/archon-setup/issues/212) → roadmap Stage 3).

## Epic #229 - Agent OS Roadmap

| Stage | Status |
| --- | --- |
| Stage 0 - stabilize & decide | **COMPLETE** (all provider lanes merged 2026-06-12) |
| Stage 1 - friction telemetry | **LIVE** — clock started 2026-06-15T20:14:07Z (window ~2026-06-29); see below |
| Stages 2-4 - process layer / graph / edit-in-place | **NOT FILED** (by design; file after ~2 weeks of friction data) |

**Stage 1 detail — telemetry is LIVE. Clock started 2026-06-15T20:14:07Z (UTC); two-week window ends ~2026-06-29.**
- Contract merged: friction ledger on repo-template main ([repo-template#83](https://github.com/ArchonVII/repo-template/pull/83)). Collector [#233](https://github.com/ArchonVII/archon-setup/issues/233) + new-repo wiring [#234](https://github.com/ArchonVII/archon-setup/issues/234) MERGED.
- **OS-core rollout APPLIED + VERIFIED** ([#238](https://github.com/ArchonVII/archon-setup/issues/238) CLOSED): `github-workflows` ([#79](https://github.com/ArchonVII/github-workflows/pull/79)) + `archon-setup` self-apply ([#264](https://github.com/ArchonVII/archon-setup/pull/264)) carry the ledger + hook allowlist + gitignore exception. Direct-main ledger append verified (gw `1ec289a`, archon-setup `ffa84fd`); non-ledger `.claude/` change still blocked. `repo-template` = source (verify-only).
- **Coverage (honest):** NOT covered this pass — `.github` (no AGENTS.md/hooks; separate governance decision), `jma-skill-review` (own governance; revisit after [#200](https://github.com/ArchonVII/jma-skill-review/issues/200)), wider fleet incl. `archon` (separate lane [#258](https://github.com/ArchonVII/archon-setup/issues/258)).
- First-party fleet rollout (`archon` first) = [#258](https://github.com/ArchonVII/archon-setup/issues/258) — proposed, gated on taxonomy ratification.
- Weekly `page-gm` friction digest now active; first ranked recurring list due ~2026-06-29.

Stages 2-4 unblock after the two-week window ranks what process to encode first.

## Epic #212 - Registry, Maintenance, Dashboard

Lanes 0-2 shipped 2026-06-12 (PRs #213, #222, #228). Remaining:

| Lane | Issue | Status |
| --- | --- | --- |
| 3 - registry CRUD RPC + repo.audit | [#216](https://github.com/ArchonVII/archon-setup/issues/216) | Open; unblocked |
| 4 - React+Vite shell scaffold | [#217](https://github.com/ArchonVII/archon-setup/issues/217) | Open; parallelizable |
| 5 - Dashboard tab v1 | [#218](https://github.com/ArchonVII/archon-setup/issues/218) | Open; blocked by 3, 4 |
| 6 - 10 Commandments + session reporting + port discipline | [repo-template#70](https://github.com/ArchonVII/repo-template/issues/70) | Open; parallelizable |
| 7a - docs/milestones/ convention | [repo-template#71](https://github.com/ArchonVII/repo-template/issues/71) | Open; parallelizable |
| 7b - milestones feature-registry entry | [#221](https://github.com/ArchonVII/archon-setup/issues/221) | Open |
| 8 - snapshot refresh + distributor + owner-confirmed distribution | [#219](https://github.com/ArchonVII/archon-setup/issues/219) | Open; owner-gated apply |
| 9 - React parity, retire vanilla UI | [#220](https://github.com/ArchonVII/archon-setup/issues/220) | Open; last |

Lanes 3 + 4 are the unblocked, parallelizable path toward the north-star process-graph view.

## Epic #223 - Document Policy - SPINE COMPLETE, tail PARKED

Spec PR [#224](https://github.com/ArchonVII/archon-setup/pull/224) **MERGED** 2026-06-12. **Spine landed ~2026-06-15/16:** 1a charter index ([.github#30](https://github.com/ArchonVII/.github/pull/30)), 1b charters ([repo-template#96](https://github.com/ArchonVII/repo-template/pull/96)), 1d freshness invariants ([repo-template#98](https://github.com/ArchonVII/repo-template/pull/98)), 1c snapshot + foundation.agents wiring ([#266](https://github.com/ArchonVII/archon-setup/pull/266)), 2a vision layer ([repo-template#99](https://github.com/ArchonVII/repo-template/pull/99)), 3a doc-health checker ([repo-template#100](https://github.com/ArchonVII/repo-template/pull/100)), 4 doc-policy lint ([github-workflows#76](https://github.com/ArchonVII/github-workflows/pull/76)), plus §8 authority/freshness amendment ([#262](https://github.com/ArchonVII/archon-setup/pull/262)).

**Remaining tail — PARKED behind the Stage 1 telemetry decision** (do not dispatch without owner go): 2b foundation.vision feature ([#226](https://github.com/ArchonVII/archon-setup/issues/226)), 2c skills ([jma-skill-review#178](https://github.com/ArchonVII/jma-skill-review/issues/178)), 3b doc-health signal in maintenance engine ([#227](https://github.com/ArchonVII/archon-setup/issues/227) — has live WIP), 3c monthly doc-health audit cron ([github-workflows#69](https://github.com/ArchonVII/github-workflows/issues/69)).

## Epic #245 - Project Capsules

Spec PR [#246](https://github.com/ArchonVII/archon-setup/pull/246) **MERGED**. Convention lane [repo-template#87](https://github.com/ArchonVII/repo-template/issues/87) **MERGED** 2026-06-14 (the snapshot carries it; installer wiring for generated repos is a follow-up — see #263). Engine / `foundation.projects` / doc-health deferred to a gated v2 (council red-team outcome).

## Epic #244 - Fable-derived practices

Discussion only ([#244](https://github.com/ArchonVII/archon-setup/issues/244)). Lanes: [jma-skill-review#189](https://github.com/ArchonVII/jma-skill-review/issues/189) (skills Tier 1-2 + dispatching rewrite), [github-workflows#71](https://github.com/ArchonVII/github-workflows/issues/71) (CI test-count canary). Tier 3 (contract/policy: AGENTS.md + CLAUDE.md) deferred to its own owner-gated lane. All proposed; owner authorizes per item.

## Wiki rollout (Librarian) - workstream since 2026-06-15

- repo-template **full Librarian wiki** MERGED ([repo-template#95](https://github.com/ArchonVII/repo-template/pull/95)).
- **OKF integration** MERGED 2026-06-17: Librarian schema 1.1 (version/type/source — [repo-template#108](https://github.com/ArchonVII/repo-template/pull/108)) + `wiki:graph` visualization ([repo-template#109](https://github.com/ArchonVII/repo-template/pull/109)). Epic closed.
- Front-door re-sync rule MERGED to [hudson-bend#209](https://github.com/ArchonVII/hudson-bend/pull/209) + [jma-history#329](https://github.com/ArchonVII/jma-history/pull/329).
- **Leg 1 (onboarding wiring):** wiki front-door paths added to `repoTemplate.copyFiles` in [PR #256](https://github.com/ArchonVII/archon-setup/pull/256) (**MERGED** 2026-06-15, Option A — **contract only; NOT yet activated in the snapshot**; the copy loop now tolerates not-yet-present entries). Activation is BLOCKED on [#257](https://github.com/ArchonVII/archon-setup/issues/257) (complete repo-template#90 startup-baseline wiring, then a post-#95 `--only repo-template` refresh). A naive pin bump breaks 5 fixtures, so it is a deliberate follow-up.
- **Legs 2-3** (archon-setup's own wiki; github-workflows' own wiki): planned; do github-workflows first (lowest collision risk).

## Skills - Epic #200 (three-layer governance) - NEW

[jma-skill-review#200](https://github.com/ArchonVII/jma-skill-review/issues/200): separate runtime / source / repo governance for skills. Postdates the 2026-06-12 roadmap and likely reshapes Stage 2's "publish `skills-manifest.json`" assumption. **Reconcile #200 with roadmap Stage 2 before encoding the skills layer.**

## Held For Owner / Decision Gates

| Item | State | Gate |
| --- | --- | --- |
| [#238](https://github.com/ArchonVII/archon-setup/issues/238) Stage 1 OS-core rollout | **DONE** — applied + verified, CLOSED; clock started 2026-06-15T20:14:07Z | — |
| [#258](https://github.com/ArchonVII/archon-setup/issues/258) archon first-party fleet rollout | Proposed | Owner ratifies fleet taxonomy + authorizes #238 first |
| Wiki Leg 1 activation | #256 merged (contract only); [#257](https://github.com/ArchonVII/archon-setup/issues/257) is the activation lane | Land #257 (#90 wiring + post-#95 refresh) |
| Document Policy [#223](https://github.com/ArchonVII/archon-setup/issues/223) | Spine merged ~06-15/16; tail lanes 2b/2c/3b/3c parked | Dispatch tail now vs keep parked behind friction data |

**No longer held (corrected from prior maps):** `github-workflows@v1` retag DONE 2026-06-12 (v1 -> `ae00ba3`, owner-approved). Spec PR #224 MERGED. jma-skill-review #180/#183/#184 merged.

## Open PRs (OS layer)

- **Triage-fix dispatch (in flight 2026-06-21):** draft PRs for the 5 confirmed-real fixes from the AI-discovered sweep — archon-setup #253 (close-scan gitignore), #252 (install own `pr-contract.mjs`), #153 (offline license/gitignore fetch seam); [github-workflows#89](https://github.com/ArchonVII/github-workflows/issues/89) (`*.mjs eol=lf`); [repo-template#104](https://github.com/ArchonVII/repo-template/issues/104) (cygpath bash-path). Dossier: `docs/../_analysis/ai-discovered-triage-2026-06-21.md` (workbench).
- [archon-setup#267](https://github.com/ArchonVII/archon-setup/pull/267) — remove root MIT LICENSE (owner patch).
- [github-workflows#68](https://github.com/ArchonVII/github-workflows/pull/68) — Dependabot actions bump (verify CI before merge); [#80](https://github.com/ArchonVII/github-workflows/pull/80) vite; [#86](https://github.com/ArchonVII/github-workflows/pull/86) (draft) script-integration review.
- **Merged since 2026-06-15:** repo-update-log fragment enforcement ([repo-template#112](https://github.com/ArchonVII/repo-template/pull/112) / [github-workflows#93](https://github.com/ArchonVII/github-workflows/pull/93) / [archon-setup#271](https://github.com/ArchonVII/archon-setup/pull/271)); [repo-template#88](https://github.com/ArchonVII/repo-template/pull/88) close-scan once-per-HEAD; [#106](https://github.com/ArchonVII/repo-template/pull/106) message protocol; [#114](https://github.com/ArchonVII/repo-template/pull/114) stale-snapshot hook; github-workflows [#82](https://github.com/ArchonVII/github-workflows/pull/82)/[#84](https://github.com/ArchonVII/github-workflows/pull/84)/[#88](https://github.com/ArchonVII/github-workflows/pull/88)/[#91](https://github.com/ArchonVII/github-workflows/pull/91)/[#95](https://github.com/ArchonVII/github-workflows/pull/95) pr-contract + labels + dependabot-exempt; document-policy spine (see above).
- [archon-setup#243](https://github.com/ArchonVII/archon-setup/pull/243) — **CLOSED** (superseded by the CURRENT_WORK rebuild #260).

## Hygiene / debt

- **AI-discovered backlog: CLEARED 2026-06-21.** Triage sweep (ultracode `wf_6f8d80cf-01c`) verified all 13 open `ai-discovered` issues across OS-core against current main: **9 closed** (already-fixed / duplicate / misfiled — archon-setup #248/#268/#269/#251/#123/#250/#249/#254 + repo-template#110) and **5 confirmed-real fixes dispatched** as draft PRs (#253 / #252 / #153 + github-workflows#89 + repo-template#104). Still open as real (non-anomaly) tasks: distributor propagation [#247](https://github.com/ArchonVII/archon-setup/issues/247), Silent-Failure search [#198](https://github.com/ArchonVII/archon-setup/issues/198).
- **Pre-launch gates** [#114](https://github.com/ArchonVII/archon-setup/issues/114)-[#121](https://github.com/ArchonVII/archon-setup/issues/121): parked (npm publish on hold).
- **Worktree prune debt: CLEARED 2026-06-21.** `npm run agent:prune` + manual husk cleanup removed all merged-lane worktrees/branches across the five meta repos (archon-setup #270; repo-template #111; github-workflows #92; archon #210/#145/#167; .github #28; + dangling merged branches). Remaining checkouts are live work only (open PRs / active WIP).
- **repo-update-log fragments: enforcement MERGED** across OS-core (repo-template#112 / github-workflows#93 / archon-setup#271). Wiki Leg-1 front-door activation still tracked by [#257](https://github.com/ArchonVII/archon-setup/issues/257) (#90 startup-baseline wiring + post-#95 `--only repo-template` refresh).
- **#256 review follow-ups** → [#263](https://github.com/ArchonVII/archon-setup/issues/263) (scoped-refresh false-success, empty `--only`, project-capsules installer wiring).
