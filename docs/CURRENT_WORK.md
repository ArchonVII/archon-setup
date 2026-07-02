# Current Work - ArchonVII Agent OS

Updated: 2026-07-01 — **Live arc: ecosystem friction arc** (new section below; owner-approved this session). Landed since the 2026-06-26 map: onboarding-baseline arc **COMPLETE** (#284 merged, civ-sim onboarded via [civ-sim#73](https://github.com/ArchonVII/civ-sim/pull/73), lifeloot onboarded); **onboarding-hardening arc [#307](https://github.com/ArchonVII/archon-setup/issues/307) Phases A/B/C/E landed 2026-06-30** (PRs [#308](https://github.com/ArchonVII/archon-setup/pull/308)–[#312](https://github.com/ArchonVII/archon-setup/pull/312) + snapshot re-vendor [#316](https://github.com/ArchonVII/archon-setup/pull/316); repo-template [#133](https://github.com/ArchonVII/repo-template/pull/133)–[#137](https://github.com/ArchonVII/repo-template/pull/137); delivered issues closed with evidence 2026-07-01). **Stage 1 friction-telemetry window CLOSED ~2026-06-29 — the Stages 2-4 go/no-go decision is now due.** Open PRs across all four OS repos: **0** (verified 2026-07-01).

Update rule: update this file in the same PR whenever a lane merges, a lane issue is filed, or a decision gate changes. Keep it as the single current-work map; detailed history belongs in the linked issue, PR, roadmap, or `docs/ecosystem-status.md`.

Roadmap source: [`docs/plans/2026-06-12-os-roadmap.md`](./plans/2026-06-12-os-roadmap.md).

## Orientation (60-second map)

The Agent OS is **five meta repos** — `.github` (org defaults), `github-workflows` (reusable workflows `@v1`), `repo-template` (template + AGENTS contract), `archon-setup` (the hub: feature registry + ecosystem registry + maintenance engine + onboarding wizard), and `jma-skill-review` / `jma-skills-data` (skills tooling + content) — plus their consumers. `archon` (the flagship AI-native terminal) is the **heaviest consumer and a first-party fleet candidate, not OS-core** (see Stage 1 / [#258](https://github.com/ArchonVII/archon-setup/issues/258)).

North star: an OS that survives model/tooling change and is *visually inspectable* — a live workflow graph generated from real config (epic [#212](https://github.com/ArchonVII/archon-setup/issues/212) → roadmap Stage 3).

## Epic #229 - Agent OS Roadmap

| Stage | Status |
| --- | --- |
| Stage 0 - stabilize & decide | **COMPLETE** (all provider lanes merged 2026-06-12) |
| Stage 1 - friction telemetry | **WINDOW CLOSED ~2026-06-29** (clock started 2026-06-15T20:14:07Z) — ranked digest review + Stages 2-4 go/no-go is an **owner decision now due** |
| Stages 2-4 - process layer / graph / edit-in-place | **NOT FILED** (by design; file after the Stage-1 decision) |

**Stage 1 detail — two-week window ended ~2026-06-29; decision pending.**
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

**Remaining tail — PARKED behind the Stage 1 telemetry decision** (do not dispatch without owner go): 2b foundation.vision feature ([#226](https://github.com/ArchonVII/archon-setup/issues/226)), 2c skills ([jma-skill-review#178](https://github.com/ArchonVII/jma-skill-review/issues/178)), 3c monthly doc-health audit cron ([github-workflows#69](https://github.com/ArchonVII/github-workflows/issues/69)). 3b doc-health signal ([#227](https://github.com/ArchonVII/archon-setup/issues/227)) **MERGED** 2026-06-27 ([PR #305](https://github.com/ArchonVII/archon-setup/pull/305)). Note: the doc-*system* successor design (one diff-scoped doc engine, fragment retirement) is [repo-template#124](https://github.com/ArchonVII/repo-template/issues/124), which supersedes parts of this epic — reconcile before dispatching the tail.

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

## Onboarding-baseline self-consistency — COMPLETE (2026-06-23 → 2026-06-26)

Existing-repo onboarding now produces a baseline that passes its **own** required gate.

- **PR [#284](https://github.com/ArchonVII/archon-setup/pull/284) MERGED** 2026-06-26 (fixed [#278](https://github.com/ArchonVII/archon-setup/issues/278), [#280](https://github.com/ArchonVII/archon-setup/issues/280), [#281](https://github.com/ArchonVII/archon-setup/issues/281), [#282](https://github.com/ArchonVII/archon-setup/issues/282)); PRs [#279](https://github.com/ArchonVII/archon-setup/pull/279) + [#273](https://github.com/ArchonVII/archon-setup/pull/273) merged alongside.
- **First real consumers onboarded:** civ-sim ([civ-sim#73](https://github.com/ArchonVII/civ-sim/pull/73), squash `1a6b0d4` 2026-06-26, branch protection set) and lifeloot (2026-06-26). The defects those onboardings surfaced became the onboarding-hardening arc [#307](https://github.com/ArchonVII/archon-setup/issues/307).
- Spun-off issues [#286](https://github.com/ArchonVII/archon-setup/issues/286) (fixed via repo-template [#137](https://github.com/ArchonVII/repo-template/pull/137) + [#316](https://github.com/ArchonVII/archon-setup/pull/316)) — closed 2026-07-01; [#283](https://github.com/ArchonVII/archon-setup/issues/283) (preflight origin-detection hermeticity) still open.

## Onboarding-hardening arc #307 — A/B/C/E LANDED; D + F remain

Plan: [`docs/plans/2026-06-29-onboarding-hardening-arc.md`](./plans/2026-06-29-onboarding-hardening-arc.md) (status table now carries merge SHAs). Landed 2026-06-30, issues closed with evidence 2026-07-01. **Remaining:** Phase D ([#293](https://github.com/ArchonVII/archon-setup/issues/293), [#301](https://github.com/ArchonVII/archon-setup/issues/301) → [#302](https://github.com/ArchonVII/archon-setup/issues/302) owner-gated), [#317](https://github.com/ArchonVII/archon-setup/issues/317) (committed exec-bit), Phase F backfill (owner-gated; folded into the friction arc W6).

## Ecosystem friction arc — LIVE (since 2026-07-01)

Owner-approved plan (session 2026-07-01): kill the CI-budget fan-out, the brittle PR-verification loop, and the docs-truth drift. Plan file: `C:\Users\josep\.claude\plans\please-review-what-is-fluttering-lobster.md`.

- **W1 hygiene** — delivered-issue closeout + epic #307 reconciliation DONE; stale-issue triage sign-off list filed as [#318](https://github.com/ArchonVII/archon-setup/issues/318); this docs PR ([#319](https://github.com/ArchonVII/archon-setup/issues/319)).
- **W2 verification contract (substance-only)** — relax `pr-contract.mjs` in github-workflows (any substantive Verification item counts; evidence/heading-order demoted to warnings; placeholder/generic-claim rejection kept), unify the three PR templates, owner-gated `@v1` retag; re-vendor into repo-template with a parity test; snapshot refresh here. Root cause being fixed: repo-template's vendored validator is **stale vs @v1** (local preflight ≠ CI).
- **W3 CI cost** — concurrency/cancel + dedupe across hub callers and consumers (June baseline: hudson-bend 1,809 runs; civ-sim 605; archon-setup 540; repo-template 328; lifeloot 285; each consumer PR push fans out to 6–7 billed workflows).
- **W4** = Phase D + #317 (above). **W5** = start [repo-template#124](https://github.com/ArchonVII/repo-template/issues/124) docs-system (S1 worktree takeover). **W6** = combined owner-gated consumer backfill.

## Open PRs (OS layer)

**None.** 0 open PRs across archon-setup / repo-template / github-workflows / .github (verified 2026-07-01). The 2026-06-21 triage-fix dispatch fully landed (#273/#276/#274 merged; gw#68/#80 dependabot bumps merged 2026-06-27; gw#86 draft closed unmerged — its topic remains open as [github-workflows#85](https://github.com/ArchonVII/github-workflows/issues/85)); [#267](https://github.com/ArchonVII/archon-setup/pull/267) owner LICENSE patch merged 2026-06-27.

## Hygiene / debt

- **AI-discovered backlog: CLEARED 2026-06-21.** Triage sweep (ultracode `wf_6f8d80cf-01c`) verified all 13 open `ai-discovered` issues across OS-core against current main: **9 closed** (already-fixed / duplicate / misfiled — archon-setup #248/#268/#269/#251/#123/#250/#249/#254 + repo-template#110) and **5 confirmed-real fixes dispatched** as draft PRs (#253 / #252 / #153 + github-workflows#89 + repo-template#104). Still open as real (non-anomaly) tasks: distributor propagation [#247](https://github.com/ArchonVII/archon-setup/issues/247), Silent-Failure search [#198](https://github.com/ArchonVII/archon-setup/issues/198).
- **Pre-launch gates** [#114](https://github.com/ArchonVII/archon-setup/issues/114)-[#121](https://github.com/ArchonVII/archon-setup/issues/121): parked (npm publish on hold); staleness triage for these + other old lanes awaiting owner sign-off in [#318](https://github.com/ArchonVII/archon-setup/issues/318).
- **Worktree prune debt: CLEARED 2026-06-21.** `npm run agent:prune` + manual husk cleanup removed all merged-lane worktrees/branches across the five meta repos (archon-setup #270; repo-template #111; github-workflows #92; archon #210/#145/#167; .github #28; + dangling merged branches). Remaining checkouts are live work only (open PRs / active WIP).
- **repo-update-log fragments: enforcement MERGED** across OS-core (repo-template#112 / github-workflows#93 / archon-setup#271). Wiki Leg-1 front-door activation still tracked by [#257](https://github.com/ArchonVII/archon-setup/issues/257) (#90 startup-baseline wiring + post-#95 `--only repo-template` refresh).
- **#256 review follow-ups** → [#263](https://github.com/ArchonVII/archon-setup/issues/263) (scoped-refresh false-success, empty `--only`, project-capsules installer wiring).
