# Onboarding-Hardening Arc

**Created:** 2026-06-29 · **Owner:** Manager (coordination) · **Repo:** `ArchonVII/archon-setup`
**Tracking epic:** _(linked once filed)_

Consolidates 13 open issues — the managed Delivery-Workflow block, the
onboarding-defect cluster surfaced by the civ-sim PR #73 / lifeloot reviews, and
the required-gate / close-guard infra gaps — into six sequenced phases.

Two adjacent Codex-P2 fixes are folded in where they belong: **#303** with the
planner cluster (Phase A), **#286** with the gate/close cluster (Phase E).

## Issues by where the fix lands

The key planning constraint is the **target repo**. Five fixes are sourced in
`ArchonVII/repo-template` and *vendored* into
`archon-setup/src/snapshots/repo-template/`; they must land upstream **and** be
re-snapshotted here, or onboarded repos never see them (`update` is
workflow-only — it does not backfill existing repos; that is the owner-gated
step, Phase F).

| Phase | Issues | Target repo | Owner-gate |
|---|---|---|---|
| A — Quick parity | #303, #304 | archon-setup | no |
| B — AGENTS.md emission | #291, #306, #290 (archon part) | archon-setup | no (backfill in F) |
| C — Flow integrity | #289, #299 | archon-setup | no |
| D — Gate contract | #293, #301, #302 | archon-setup + GitHub config | **#302 yes** |
| E — repo-template quality | #294, #292, #295, #286, #290 (template part) | repo-template → re-vendor snapshot | no |
| F — Backfill | (#306 item 3) | lifeloot, civ-sim, hudson-bend | **yes** |

## Dependency graph

```
Phase A  (quick parity, no file conflicts)      Phase E  (repo-template, cross-repo)
  #303 planner remote.github                       #294 hooks +x bit
  #304 agent-lifecycle .gitignore creates          #292 start-task npm ci
        |  (independent — ship first)              #295 baseline-script robustness
        v                                          #286 close-scan malformed pkg
Phase B  (AGENTS.md emission — SERIALIZE)          #290(scripts/Librarian/capsule)
  #291 changelog -> Mode 2  --+                          |  land in repo-template
  #306 managed Delivery block +- same emitter            v  then re-vendor snapshot
  #290(archon: Start Map line)+  + AGENTS.md snap    snapshots:verify --+
        |                                                               |
Phase C  (flow integrity, parallel w/ B)                                |
  #289 provenance task-order + gitignore                                |
  #299 active coordination board/claims                                 |
        |                                                               |
Phase D  (gate contract)                                                |
  #293 check-map stack:node --+                                         |
  #301 tighten-required-gate  +--> #302 archon-setup self-gate          |
        (tool fix first)      |        OWNER-GATED (branch protection)  |
                             v                                          v
                    Phase F — BACKFILL existing onboarded repos  OWNER-GATED
                    (lifeloot, civ-sim, hudson-bend) — after B + E land
```

## Phase briefs

### Phase A — Quick parity wins · archon-setup · ship first
Two isolated Codex-P2 fixes that restore dry-run / plan parity. No shared files
with any other lane.

- **#304** — `src/server/tasks/writeAgentLifecycle.mjs:133` writes `.gitignore`
  but the feature's `creates` omits it, so `--dry-run` hides the mutation. Add
  `.gitignore` to the agent-lifecycle `creates` metadata (or require the
  foundation gitignore feature).
- **#303** — `src/server/planner/buildPlan.mjs:125` raises a blocking
  `remote.github` error on *any* `remoteRequirement`. Gate it on non-empty
  `remoteMutations` so workflow-only local onboards are not blocked.
- **Verify:** unit tests for both planners + a `--dry-run` parity assertion.

### Phase B — AGENTS.md emission correctness · archon-setup · serialize within lane
All three touch `writeAgentsMd.mjs` and/or the emitted `AGENTS.md` snapshot — do
them as one ordered lane to avoid managed-block churn.

- **#291** (high) — default `changelogMode` to **Mode 2** to match the shipped
  `.changelog/` + close guard (`scripts/close/lib.mjs evaluateChangelogDecision`);
  remove the literal "pick one and delete the other" placeholder.
- **#306** (centerpiece) — emit a **managed** Delivery Workflow block
  (`BEGIN/END ARCHONVII MANAGED BLOCK`, same mechanism as `agents-start-map`);
  make `onboard --audit` flag its absence.
- **#290** (high, archon portion) — remove/condition the managed Start Map
  `Projects:` line and gate the Librarian/capsule "Read First" refs behind the
  features that install them.
- **Verify:** snapshot tests on emitted `AGENTS.md`; `onboard --audit` red->green
  on a repo missing the block.

### Phase C — Onboarding flow integrity · archon-setup · parallel with B
Distinct files from B (flow/order + coordination task).

- **#289** (med) — reorder `headlessOnboard.mjs` so `writeSetupManifest` lands
  the manifest/CODEOWNERS *in* the bootstrap commit (or commit provenance as a
  sanctioned final step); add `.archon/events.jsonl` + `.agent/bypass.log` to the
  onboarded `.gitignore`. Removes the "every fresh repo ends dirty + needs
  hook-bypass" trap.
- **#299** — make active coordination an explicit onboarding path: install
  `.agent/coordination/board.md` + a `claims/` location that `agent:status`
  reports; tests for claims-dir detection.
- **Verify:** fresh-onboard e2e ends with a clean tree; `agent:status` reports
  coordination installed.

### Phase D — Required-gate contract · archon-setup + GitHub config · #302 owner-gated
- **#293** (med) — `writeCheckMap.mjs` default `stack: node` to match the
  `repo-required-gate.yml` caller (stop the `minimal` vs `node` drift).
- **#301** — fix `src/server/branchProtection/tightenRequiredGate.mjs` to handle
  baseline `required_status_checks: null` via the full branch-protection PUT
  path; distinguish "no branch protection" from "required checks not enabled";
  add the HTTP-404 subresource regression test. **Must land before #302.**
- **#302** — **owner-gated:** install/reconcile `repo-required-gate.yml` for
  archon-setup itself and set `main` required checks to
  `repo-required-gate / decision`, so `close:ci:guard` works on this repo.
  Execute only after #301 and with owner approval (it mutates protection on this
  repo's `main`).

### Phase E — repo-template baseline quality · repo-template -> re-vendor snapshot · cross-repo
Land upstream in `ArchonVII/repo-template`, then re-snapshot into
`archon-setup/src/snapshots/repo-template/` (and the vendored
`archon-setup/scripts/close/scan-complete.mjs` for #286).

- **#294** (med) — track `.githooks/*` with the executable bit (confirmed
  `100644` in *both* repo-template and archon-setup's snapshot index); or chmod
  +x on apply.
- **#292** (med) — `start-task.mjs`: add lockfile-gated, non-fatal `npm ci` after
  `git worktree add`.
- **#295** (low) — robustness pass on `start-task.mjs` (detect retired/merged
  heads), `doc-sweep/git.mjs` (preserve staged add-only docs on hook-reject;
  reject placeholders), `agent-pr-ready.mjs` (gate promotion on close `ci:guard`).
- **#286** (low) — `scan-complete.mjs hasNpmScript`: distinguish `package.json`
  *absent* (skip green) from *present-but-unparseable* (run test so the parse
  error surfaces) — apply in lockstep across repo-template source +
  archon-setup vendored + snapshot copies.
- **#290** (template portion) — gate/ship the Librarian-wiki + project-capsule
  docs the AGENTS.md references.
- **Verify:** `npm run snapshots:verify` clean; hooks executable on a Unix
  checkout.

### Phase F — Backfill · owner-gated · after B + E land
Per #306 acceptance + `AGENTS.md` ecosystem-dissemination clause (owner
sign-off). Backfill **lifeloot** (reconcile the interim hand-section from
lifeloot#48/#49 against the new managed block), **civ-sim**, **hudson-bend**.
Confirm the `.github/ISSUE_TEMPLATE/Task` form baseline exists where the Start
Map references it.

## Parallelization

**A, B, C, and E-upstream** are conflict-free (distinct files / distinct repos) —
up to four concurrent lanes. **D** serializes (#293/#301 -> #302). **#302 and all
of F are owner-gated** and run last. Critical path: B (serial, 3 issues) and E
(upstream -> snapshot -> verify).

## Status

| Phase | State | PR(s) | Notes |
|---|---|---|---|
| A | dispatched | — | quick-parity lane |
| B | dispatched | — | AGENTS.md emission lane |
| C | dispatched | — | flow-integrity lane |
| D | queued | — | after #301; #302 owner-gated |
| E | dispatched | — | repo-template + snapshot |
| F | held | — | owner-gated backfill |

_Update PR links and state as lanes land._
