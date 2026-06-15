# Current Work - ArchonVII Agent OS

Updated: 2026-06-15 — **Stage 1 friction telemetry is LIVE** (clock started 2026-06-15T20:14:07Z; #238 applied + verified + closed). Base rebuild: archon-setup#242 (supersedes [PR #243](https://github.com/ArchonVII/archon-setup/pull/243)).

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

## Epic #223 - Document Policy - PARKED (not dormant-by-neglect)

Spec PR [#224](https://github.com/ArchonVII/archon-setup/pull/224) **MERGED** 2026-06-12. All implementation lanes are OPEN and unbuilt: [.github#27](https://github.com/ArchonVII/.github/issues/27) (1a), [repo-template#72](https://github.com/ArchonVII/repo-template/issues/72) (1b), [#225](https://github.com/ArchonVII/archon-setup/issues/225) (1c), [repo-template#73](https://github.com/ArchonVII/repo-template/issues/73) (2a), [#226](https://github.com/ArchonVII/archon-setup/issues/226) (2b), [jma-skill-review#178](https://github.com/ArchonVII/jma-skill-review/issues/178) (2c), [repo-template#74](https://github.com/ArchonVII/repo-template/issues/74) (3a), [#227](https://github.com/ArchonVII/archon-setup/issues/227) (3b), [github-workflows#69](https://github.com/ArchonVII/github-workflows/issues/69) (3c), [github-workflows#70](https://github.com/ArchonVII/github-workflows/issues/70) (4).

**Status: unblocked (spec merged) but PARKED** pending the Stage 1 telemetry decision / explicit owner reprioritization. The roadmap frames friction data as the signal that should rank future process work, so the lanes wait rather than dispatch now.

## Epic #245 - Project Capsules

Spec PR [#246](https://github.com/ArchonVII/archon-setup/pull/246) **MERGED**. Convention lane [repo-template#87](https://github.com/ArchonVII/repo-template/issues/87) **MERGED** 2026-06-14 (the snapshot carries it; installer wiring for generated repos is a follow-up — see #263). Engine / `foundation.projects` / doc-health deferred to a gated v2 (council red-team outcome).

## Epic #244 - Fable-derived practices

Discussion only ([#244](https://github.com/ArchonVII/archon-setup/issues/244)). Lanes: [jma-skill-review#189](https://github.com/ArchonVII/jma-skill-review/issues/189) (skills Tier 1-2 + dispatching rewrite), [github-workflows#71](https://github.com/ArchonVII/github-workflows/issues/71) (CI test-count canary). Tier 3 (contract/policy: AGENTS.md + CLAUDE.md) deferred to its own owner-gated lane. All proposed; owner authorizes per item.

## Wiki rollout (Librarian) - NEW workstream 2026-06-15

- repo-template **full Librarian wiki** MERGED ([repo-template#95](https://github.com/ArchonVII/repo-template/pull/95)).
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
| Document Policy [#223](https://github.com/ArchonVII/archon-setup/issues/223) | Spec merged, lanes unbuilt (agents active on lanes) | Dispatch now vs keep parked behind friction data |

**No longer held (corrected from prior maps):** `github-workflows@v1` retag DONE 2026-06-12 (v1 -> `ae00ba3`, owner-approved). Spec PR #224 MERGED. jma-skill-review #180/#183/#184 merged.

## Open PRs (OS layer)

- [archon-setup#256](https://github.com/ArchonVII/archon-setup/pull/256) — provider-scoped refresh + wiki copyFiles — **MERGED 2026-06-15**.
- [archon-setup#259](https://github.com/ArchonVII/archon-setup/pull/259) — Stage 1 decision packet — **MERGED 2026-06-15**.
- [archon-setup#264](https://github.com/ArchonVII/archon-setup/pull/264) + [github-workflows#79](https://github.com/ArchonVII/github-workflows/pull/79) — Stage 1 friction wiring — **MERGED 2026-06-15** (#238 apply).
- [archon-setup#243](https://github.com/ArchonVII/archon-setup/pull/243) — **CLOSED** (superseded by the CURRENT_WORK rebuild #260).
- [repo-template#88](https://github.com/ArchonVII/repo-template/pull/88) — close-scan run-once-per-HEAD (ready).
- [github-workflows#68](https://github.com/ArchonVII/github-workflows/pull/68) — Dependabot actions bump (vitest was failing; fix before merge).
- [jma-skill-review#197](https://github.com/ArchonVII/jma-skill-review/pull/197) (status refresh), [#187](https://github.com/ArchonVII/jma-skill-review/pull/187) (Dependabot).

## Hygiene / debt

- **AI-discovered backlog untriaged:** archon-setup [#247](https://github.com/ArchonVII/archon-setup/issues/247)-[#254](https://github.com/ArchonVII/archon-setup/issues/254) (8) + #198 / #153 / #123. The anomaly system produces signal; the triage loop is not clearing it.
- **Pre-launch gates** [#114](https://github.com/ArchonVII/archon-setup/issues/114)-[#121](https://github.com/ArchonVII/archon-setup/issues/121): parked (npm publish on hold).
- **Worktree prune debt** (merged lanes): archon-setup #233 / #234; repo-template #28 / #76; github-workflows #65. Run `npm run agent:prune`.
- **#90 repo-update-log snapshot wiring incomplete** → [#257](https://github.com/ArchonVII/archon-setup/issues/257) (blocks clean wiki activation).
- **#256 review follow-ups** → [#263](https://github.com/ArchonVII/archon-setup/issues/263) (scoped-refresh false-success, empty `--only`, project-capsules installer wiring).
