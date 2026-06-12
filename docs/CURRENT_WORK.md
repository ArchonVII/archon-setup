# Current Work - ArchonVII Agent OS

Updated: 2026-06-12 by ArchonVII/archon-setup#230.

Update rule: update this file in the same PR whenever a lane merges, a lane issue is filed, or a decision gate changes. Keep it as the single current-work map; detailed history belongs in the linked issue, PR, roadmap, or `docs/ecosystem-status.md`.

Roadmap source: [`docs/plans/2026-06-12-os-roadmap.md`](./plans/2026-06-12-os-roadmap.md).

## Snapshot

- ArchonVII/archon-setup#212 lanes 0-2 shipped on 2026-06-12: spec PR ArchonVII/archon-setup#213, registry/port policy PR ArchonVII/archon-setup#222, maintenance status PR ArchonVII/archon-setup#228.
- ArchonVII/archon-setup#223 is gated by draft spec PR ArchonVII/archon-setup#224. Start its implementation lanes only after that spec merges.
- ArchonVII/archon-setup#229 Stage 0 and Stage 1 lanes are filed. Stage 0 has several independent repo-template fixes plus this status-doc lane.
- `docs/ecosystem-overview.md` is generated and intentionally out of scope for this lane.

## Epic #212 - Registry, Maintenance, Dashboard

| Lane | Issue / PR | Status | Blocked by |
| --- | --- | --- | --- |
| 3 - registry CRUD RPC + repo.audit | [ArchonVII/archon-setup#216](https://github.com/ArchonVII/archon-setup/issues/216) | Open; unblocked | Lanes 1 and 2 are merged |
| 4 - React shell scaffold | [ArchonVII/archon-setup#217](https://github.com/ArchonVII/archon-setup/issues/217) | Open; parallelizable | None |
| 5 - Dashboard tab v1 | [ArchonVII/archon-setup#218](https://github.com/ArchonVII/archon-setup/issues/218) | Open | [ArchonVII/archon-setup#216](https://github.com/ArchonVII/archon-setup/issues/216), [ArchonVII/archon-setup#217](https://github.com/ArchonVII/archon-setup/issues/217) |
| 6 - 10 Commandments + session reporting + port discipline | [ArchonVII/repo-template#70](https://github.com/ArchonVII/repo-template/issues/70) | Open; parallelizable | None |
| 7a - docs/milestones/ convention | [ArchonVII/repo-template#71](https://github.com/ArchonVII/repo-template/issues/71) | Open; parallelizable | None |
| 7b - milestones feature-registry entry | [ArchonVII/archon-setup#221](https://github.com/ArchonVII/archon-setup/issues/221) | Open | [ArchonVII/repo-template#71](https://github.com/ArchonVII/repo-template/issues/71), snapshot refresh lane [ArchonVII/archon-setup#219](https://github.com/ArchonVII/archon-setup/issues/219) |
| 8 - snapshot refresh + distributor regions + owner-confirmed distribution | [ArchonVII/archon-setup#219](https://github.com/ArchonVII/archon-setup/issues/219) | Open; owner-gated apply | [ArchonVII/repo-template#70](https://github.com/ArchonVII/repo-template/issues/70), [ArchonVII/repo-template#71](https://github.com/ArchonVII/repo-template/issues/71), explicit owner confirmation before fleet apply |
| 9 - React parity, retire vanilla UI | [ArchonVII/archon-setup#220](https://github.com/ArchonVII/archon-setup/issues/220) | Open; last | [ArchonVII/archon-setup#217](https://github.com/ArchonVII/archon-setup/issues/217), [ArchonVII/archon-setup#218](https://github.com/ArchonVII/archon-setup/issues/218) |

## Epic #223 - Document Policy

| Lane | Issue / PR | Status | Blocked by |
| --- | --- | --- | --- |
| 0 - spec review gate | [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) | Draft PR; held for owner review | Owner review |
| 1a - STARTER.md charter index | [ArchonVII/.github#27](https://github.com/ArchonVII/.github/issues/27) | Open | Spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 1b - document-policy.md charters + placement rules | [ArchonVII/repo-template#72](https://github.com/ArchonVII/repo-template/issues/72) | Open | Spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 1c - snapshot refresh + foundation.agents wiring | [ArchonVII/archon-setup#225](https://github.com/ArchonVII/archon-setup/issues/225) | Open | [ArchonVII/.github#27](https://github.com/ArchonVII/.github/issues/27), [ArchonVII/repo-template#72](https://github.com/ArchonVII/repo-template/issues/72), spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 2a - VISION.md + decision-log + drift duties | [ArchonVII/repo-template#73](https://github.com/ArchonVII/repo-template/issues/73) | Open | [ArchonVII/repo-template#72](https://github.com/ArchonVII/repo-template/issues/72), spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 2b - foundation.vision feature | [ArchonVII/archon-setup#226](https://github.com/ArchonVII/archon-setup/issues/226) | Open | [ArchonVII/repo-template#73](https://github.com/ArchonVII/repo-template/issues/73), snapshot refresh, spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 2c - project-intake skill | [ArchonVII/jma-skill-review#178](https://github.com/ArchonVII/jma-skill-review/issues/178) | Open | [ArchonVII/repo-template#73](https://github.com/ArchonVII/repo-template/issues/73), spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 2d - backfill vision interviews | No issue yet; owner-paced | Not started | [ArchonVII/jma-skill-review#178](https://github.com/ArchonVII/jma-skill-review/issues/178) |
| 3a - deterministic doc-health checker | [ArchonVII/repo-template#74](https://github.com/ArchonVII/repo-template/issues/74) | Open | [ArchonVII/repo-template#72](https://github.com/ArchonVII/repo-template/issues/72), spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 3b - doc-health maintenance signal | [ArchonVII/archon-setup#227](https://github.com/ArchonVII/archon-setup/issues/227) | Open | [ArchonVII/repo-template#74](https://github.com/ArchonVII/repo-template/issues/74); [ArchonVII/archon-setup#215](https://github.com/ArchonVII/archon-setup/issues/215) is satisfied |
| 3c - monthly semantic doc-health audit caller | [ArchonVII/github-workflows#69](https://github.com/ArchonVII/github-workflows/issues/69) | Open | [ArchonVII/repo-template#74](https://github.com/ArchonVII/repo-template/issues/74), spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |
| 4 - doc-policy-lint warning-only workflow | [ArchonVII/github-workflows#70](https://github.com/ArchonVII/github-workflows/issues/70) | Open | [ArchonVII/repo-template#72](https://github.com/ArchonVII/repo-template/issues/72), spec PR [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) |

## Epic #229 - Agent OS Roadmap

| Stage / lane | Issue / PR | Status | Blocked by |
| --- | --- | --- | --- |
| Stage 0 - anomaly ledger path + caller | [ArchonVII/repo-template#75](https://github.com/ArchonVII/repo-template/issues/75) | Open; independent now | None |
| Stage 0 - doc-orphan-detector cron caller | [ArchonVII/repo-template#76](https://github.com/ArchonVII/repo-template/issues/76) | Open; independent now | None |
| Stage 0 - hook default-branch + docs/phase2 refs | [ArchonVII/repo-template#77](https://github.com/ArchonVII/repo-template/issues/77) | Open; independent now | None |
| Stage 0 - close-scan local delivery guard | [ArchonVII/repo-template#28](https://github.com/ArchonVII/repo-template/issues/28) | Open; revived | None |
| Stage 0 - current-work map + roadmap doc | [ArchonVII/archon-setup#230](https://github.com/ArchonVII/archon-setup/issues/230) | In progress in this branch | None |
| Stage 0 - skills source in ecosystem map | [ArchonVII/archon-setup#231](https://github.com/ArchonVII/archon-setup/issues/231) | Open; independent now | None |
| Stage 0 - provider snapshot refresh | [ArchonVII/archon-setup#232](https://github.com/ArchonVII/archon-setup/issues/232) | Open | [ArchonVII/repo-template#75](https://github.com/ArchonVII/repo-template/issues/75), [ArchonVII/repo-template#76](https://github.com/ArchonVII/repo-template/issues/76), [ArchonVII/repo-template#77](https://github.com/ArchonVII/repo-template/issues/77), [ArchonVII/repo-template#78](https://github.com/ArchonVII/repo-template/issues/78) |
| Stage 1 - friction ledger contract | [ArchonVII/repo-template#78](https://github.com/ArchonVII/repo-template/issues/78) | Open | [ArchonVII/repo-template#75](https://github.com/ArchonVII/repo-template/issues/75) because both edit AGENTS.md |
| Stage 1 - friction collector | [ArchonVII/archon-setup#233](https://github.com/ArchonVII/archon-setup/issues/233) | Open | [ArchonVII/repo-template#78](https://github.com/ArchonVII/repo-template/issues/78); coordinate with registry RPC lane [ArchonVII/archon-setup#216](https://github.com/ArchonVII/archon-setup/issues/216) |
| Stage 1 - friction-ledger feature entry | [ArchonVII/archon-setup#234](https://github.com/ArchonVII/archon-setup/issues/234) | Open | [ArchonVII/repo-template#78](https://github.com/ArchonVII/repo-template/issues/78); coordinate with snapshot lane [ArchonVII/archon-setup#232](https://github.com/ArchonVII/archon-setup/issues/232) |
| Stage 1 - weekly page-gm digest | No code issue | Ritual after collection starts | Friction data from Stage 1 lanes |

Stages 2-4 from the roadmap are not filed yet; file those after Stage 1 friction data ranks what process data to encode first.

## Held For Owner / Decision Gates

| Item | Current state | Gate |
| --- | --- | --- |
| [ArchonVII/archon-setup#224](https://github.com/ArchonVII/archon-setup/pull/224) | Draft document-policy spec PR | Owner review; gates all ArchonVII/archon-setup#223 implementation lanes |
| `github-workflows@v1` retag | Held since the PR-template drift-guard rollout | Owner go before moving the public major tag |
| [ArchonVII/github-workflows#66](https://github.com/ArchonVII/github-workflows/pull/66) | Open README refresh PR | Owner/review path |
| [ArchonVII/github-workflows#68](https://github.com/ArchonVII/github-workflows/pull/68) | Open Dependabot PR; `vitest` failed on 2026-06-11 | Fix or review the failing check before merge |
| [ArchonVII/.github#29](https://github.com/ArchonVII/.github/pull/29) | Draft profile refresh PR | Owner feedback |
| [ArchonVII/jma-skill-review#180](https://github.com/ArchonVII/jma-skill-review/pull/180) | Open description lint gate PR | Review/merge path |

No longer held as of this update: [ArchonVII/jma-skill-review#183](https://github.com/ArchonVII/jma-skill-review/pull/183) and [ArchonVII/jma-skill-review#184](https://github.com/ArchonVII/jma-skill-review/pull/184) merged on 2026-06-12.
