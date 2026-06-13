# Project capsules: per-feature PLAN.md front door & lifecycle engine — design spec

- **Date:** 2026-06-13
- **Author:** Claude (Opus 4.8), via owner brainstorming session (decisions recorded below).
- **Status:** DRAFT — for owner review. This doc is the review gate before the lanes implement it.
- **Tracking issue:** [archon-setup #245](https://github.com/ArchonVII/archon-setup/issues/245) (epic; one sub-issue per lane).
- **Branch / worktree:** `agent/claude/245-project-capsules-spec` at `C:\GitHub\archon-setup-245-project-capsules-spec`.
- **Builds on:** [archon-setup #223](https://github.com/ArchonVII/archon-setup/issues/223) (document-policy: charters, `VISION.md`, decision-log, doc-health), [archon-setup #212](https://github.com/ArchonVII/archon-setup/issues/212) (ecosystem-registry + maintenance engine), `repo-template/docs/agent-process/doc-sweep.md` + the `scripts/doc-sweep/` and `scripts/doc-health/` engine pattern, `pattern-tool-agnostic-capability`, `playbook-ecosystem-capability-rollout`.

---

## 1. Problem

Document-policy (#223) gives each repo a single **repo-level** intent layer — root `VISION.md` (what experience we're building / scope / drift tripwires) plus an append-only `docs/decisions/decision-log.md`. It deliberately stops at the repo level.

There is no **per-feature** orientation layer. An agent assigned a task on, say, the inventory screen still has to reconstruct the feature's context by hunting across four chartered homes — `docs/plans/`, `docs/superpowers/specs/`, `docs/adr/`, `docs/research/` — none of which is a guaranteed, guessable, single entry point. The information needed before safely touching code ("what is this, where is it in its arc, what must not change, what changed from the original idea, what's the next safe action") is scattered or absent.

This spec adds a **per-project capsule**: `projects/<slug>/PLAN.md` as the required, guessable "front door" for one feature/effort, plus a deterministic lifecycle engine that owns capsule state transitions and archival. It mirrors the proven doc-sweep/doc-health shape: deterministic engine in `repo-template`, a short `AGENTS.md` contract, a full policy doc under `docs/agent-process/`, and a thin CLI-agnostic skill front-end.

## 2. Understanding summary

- **What:** a repo-local per-project capsule convention — `projects/<slug>/PLAN.md` as the canonical front door for one feature's why / staged plan / invariants / pivots / current state — plus a lifecycle engine (`scripts/project-plan/`) that validates, transitions, and moves capsules to `projects/_finished/` (shipped) or `projects/_archive/` (abandoned/superseded).
- **Why:** documents are the agents' operating surface; without a per-feature anchor, orientation is reconstructed from scratch each session, and `docs/plans/` (flat, loose) is not a guessable single home.
- **Who:** agents author/update `PLAN.md` and run lifecycle moves; the owner reads it and approves pivots (same split as `VISION.md` + decision-log); doc-health flags stale capsules; a future **Project Atlas** consumes capsules as its data source.
- **Boundary / non-goals:** `PLAN.md` **links out** to specs/ADRs/research/issues — it never replaces their chartered homes ("one home per fact"). No dependency graph, `progress`, `confidence`, or Atlas wiring in this scope (deferred). Not a global mega-file — **one `PLAN.md` per capsule**. No GitHub Projects sync.
- **Key shift:** `projects/**` is not a plain folder — it becomes a **durable, automation-aware surface** that document-policy, doc-health, doc-sweep, startup-baseline, and owner-maintenance safe-paths must all be taught about.

## 3. Owner decisions (2026-06-13)

| # | Decision | Rejected alternatives | Why |
| --- | --- | --- | --- |
| PCD1 | Canonical home = root `projects/<slug>/PLAN.md` | `docs/plans/<feature>/`, `docs/projects/` | "Guessable front door" is the core requirement; `docs/plans/` reads as internal docs. `docs/plans/**` becomes legacy/fallback (PCD9). |
| PCD2 | Lean frontmatter: `id` (bare slug), `title`, `status`, `created`, `updated` (+ optional `issue` only if validated) | Full Atlas-ready frontmatter now (`depends_on`/`blocked_by`/`progress`/`confidence`/`atlas_include`) | Hand-maintained graph fields that nothing reads rot and mislead — the drift doc-health exists to catch. Atlas fields land later under an `atlas:` block. |
| PCD3 | One required `PLAN.md`; `decisions.md`/`research.md` split **only on growth**, as rollups that link to (not replace) ADR/research | Multi-file from day one; ADR substitute | skill.md-style instant orientation; YAGNI; preserves one-home-per-fact. |
| PCD4 | Statuses `intake \| active \| paused \| finished \| archived`; transitions per §5.2; `_finished/`+`_archive/` date-prefixed; "blocked" is a body note | doc-policy 6-state vocab; convention-only manual `mv`; `blocked` as a status | Execution-oriented and finite; reliable across Claude/Codex/Gemini; keeps deferred graph state out of frontmatter. |
| PCD5 | Deterministic engine `repo-template/scripts/project-plan/` (CLI/lib split, `--dry-run`/`--json`, idempotent, writes-only never commits, scoped dirty-tree refusal) | skill-only logic; whole-tree dirty refusal; auto-commit | Fixture-testable, reusable by doc-health, no personal-CLI trap, compatible with hooks/owner-maintenance/PR lanes. |
| PCD6 | Durable policy `repo-template/docs/agent-process/project-capsules.md` + ≤5-line AGENTS contract + Start Map line; separate `shared/project-plan` skill wraps the engine | absorb into `project-intake`; long AGENTS section | Different granularity/cadence from repo-level VISION intake; contract+detail-doc pattern; above-the-fold pointers. |
| PCD7 | `foundation.projects` registry feature = **default-on, unlocked**; feature owns its entire surface; opt-out leaves no dangling expectations | locked like `foundation.agents`; folded into `foundation.agents` | Matches `foundation.vision`/OD5 (providers can opt out); avoids false adoption in repos that decline. |
| PCD8 | `projects/**` wired into document-policy charter, doc-health, doc-sweep eligibility, startup-baseline, owner-maintenance safe-paths; owner-safe = markdown + images only | treat as plain folder; allow code/config | Else the first user hits hook/sweep friction; prevents `projects/` becoming a code/config loophole. |
| PCD9 | `projects/README.md` regenerated from frontmatter into a **managed block**; migration conservative (no bulk move) | hand-maintained index; bulk-migrate `docs/plans/**` | Link hygiene on moves; avoids churn over stale historical plans. |

Cadence default (tunable in lane PRs without re-review): a `status: active` capsule whose `updated` is older than **30 days** is flagged stale by doc-health (mirrors document-policy's active-plan cadence).

## 4. Design

### 4.1 Capsule shape

```text
projects/
  README.md                      # generated index (managed block) + optional human prose
  <slug>/                        # active / intake / paused capsules
    PLAN.md                      # REQUIRED front door
    decisions.md                 # OPTIONAL — only once Decisions/Pivots outgrows PLAN.md
    research.md                  # OPTIONAL — only once research outgrows PLAN.md
    assets/                      # OPTIONAL — images/diagrams only
  _finished/
    2026-06-13-vendor-register/  # shipped, date-prefixed
      PLAN.md
  _archive/
    2026-06-13-old-sync-proto/   # abandoned/superseded, date-prefixed
      PLAN.md
```

- **Slug** = bare, human, guessable (`inventory-screen`), **not** typed (`FEAT-inventory-screen`). Active slugs are unique within `projects/`; collisions take a short qualifier (`inventory-screen-v2`), not a numeric counter. `_finished/`/`_archive/` may hold date-prefixed historical copies of a slug.
- **Split files are rollups, not substitutes:** `decisions.md` records project-level owner/product decisions and links to `docs/adr/**` for technical decisions; `research.md` summarizes findings and links to canonical `docs/research/**`. After a split, `PLAN.md` retains a summary + pointer.

### 4.2 `PLAN.md` template

Lean frontmatter (PCD2); the human-readable dependency/blocker/arc tables live in the **body**, not machine frontmatter, until the Atlas exists.

```markdown
---
id: inventory-screen
title: Inventory Screen
status: intake          # intake | active | paused | finished | archived
created: 2026-06-13
updated: 2026-06-13
issue: 234              # optional; include only if the engine validates it
---

# Inventory Screen — PLAN

## Agent Quickload
- **Current state:** <one line>
- **Next safe action:** <one line>
- **Main blocker (if any):** <one line, or "none">
- **Do not change:** <invariants in one line>
- **Read first:** <links to the deep specs/ADRs/code below>

## Why / what was asked for
<the experience requested and why this exists>

## End-to-end plan (staged)
<stages; later stages may be outlined-but-unplanned>

## Scope
- **In:** …
- **Out:** …
- **Later:** …

## Invariants (do not break without updating this PLAN + the decision log)
- …

## Dependencies & blockers   <!-- human-readable; machine graph deferred to Atlas -->
| Depends on | Why | Status |
| Blocks | Why |
| Blocker | Needed to unblock | Owner | Link |

## Decisions & pivots (added vs removed)
| Date | Decision | Reason | Link |

## Source links (one home per fact — summarize + point, never duplicate)
- Specs: `docs/superpowers/specs/…`
- ADRs: `docs/adr/…`
- Research: `docs/research/…`
- Issues/PRs: #…

## Agent handoff
Before working here: read this PLAN, check blockers, check linked issues, preserve invariants.
After meaningful changes: update Current state + Decisions/pivots + `updated:` (run `npm run project-plan -- touch <slug>` or the lifecycle command).
```

### 4.3 Lifecycle engine — `repo-template/scripts/project-plan/`

Layout (mirrors `scripts/doc-health/`):

```text
scripts/project-plan/
  index.mjs       # CLI parser/dispatch only
  lib.mjs         # PURE: transition legality, frontmatter parse/validate, slug rules, index render
  fs.mjs          # filesystem/move helpers (no git)
  lib.test.mjs    # fixtures: clean → zero findings; seeded violations → exact findings
```

`package.json` wrappers (so agents never type `node scripts/...`):

```json
{
  "scripts": {
    "project-plan": "node scripts/project-plan/index.mjs",
    "project-plan:validate": "node scripts/project-plan/index.mjs validate",
    "project-plan:index": "node scripts/project-plan/index.mjs index"
  }
}
```

**Subcommands × transitions × writes:**

| Command | Legal from → to | Writes |
| --- | --- | --- |
| `new <slug> --title <t> [--issue N]` | — → `intake` | creates `projects/<slug>/PLAN.md`; regenerates index. Refuses slug collision. |
| `activate <slug>` | `intake` → `active` | `status`, `updated` |
| `pause <slug>` | `active` → `paused` | `status`, `updated` (no move) |
| `resume <slug>` | `paused` → `active` | `status`, `updated` |
| `finish <slug>` | `active` → `finished` | `status`, `updated`; move → `_finished/YYYY-MM-DD-<slug>/`; regenerate index |
| `archive <slug>` | `intake\|active\|paused` → `archived` | `status`, `updated`; move → `_archive/YYYY-MM-DD-<slug>/`; regenerate index |
| `reopen <archive-path> [--as <slug>]` | `archived` → `active` | move out of `_archive/`; `status`, `updated`; regenerate index. **Explicit path required**; `--as` required on active-slug collision |
| `touch <slug>` | (any) | bumps `updated:` only |
| `index` | — | rewrites `projects/README.md` managed block from frontmatter (deterministic) |
| `validate [--json]` | — | read-only; the validator doc-health imports |

`finished → archived` is a correction-only path (explicit `archive` on a finished capsule). Cross-cutting rules:

- **Flags:** every mutator supports `--dry-run` and `--json`.
- **Idempotent:** re-running a command already in its target state is a clean no-op (e.g. `finish` on a capsule already under `_finished/...` with `status: finished`). Fixture-tested.
- **Writes files only — never `git add`/`git commit`.** Staging/commit belongs to the branch/PR or owner-maintenance lane.
- **Scoped dirty-tree refusal (R3):** the command refuses only on conflicting uncommitted changes in (a) the target capsule folder, (b) `projects/README.md` outside the managed-block regeneration, or (c) any destination folder it would move into/overwrite. **Unrelated dirty files elsewhere are reported as warnings, not blockers** — so an agent mid-feature with `src/**` edits can still `finish`/`archive` a capsule.

### 4.4 `projects/README.md` — generated index

Regenerated from each capsule's `PLAN.md` frontmatter into a managed block; human prose outside the markers is preserved.

```markdown
# Projects

<!-- BEGIN MANAGED PROJECT INDEX -->
## Active
| Project | Status | Updated | Issue |
| --- | --- | --- | --- |
| [Inventory Screen](inventory-screen/PLAN.md) | active | 2026-06-13 | #234 |

## Finished
| Project | Finished | Link |

## Archived
| Project | Archived | Link |
<!-- END MANAGED PROJECT INDEX -->
```

No `progress`/`confidence`/dependency columns until the Atlas exists.

### 4.5 Distribution — `foundation.projects` registry feature

**Default-on, unlocked** (PCD7 — matches `foundation.vision`/OD5). The feature **owns its entire surface** so a deselected repo has no dangling expectations:

```jsonc
{
  "id": "foundation.projects",
  "label": "Project capsules",
  "group": "foundations",
  "default": true,
  "locked": false,
  "creates": [
    "projects/README.md",
    "docs/agent-process/project-capsules.md",
    "scripts/project-plan/index.mjs",
    "scripts/project-plan/lib.mjs",
    "scripts/project-plan/fs.mjs"
  ],
  "tasks": [
    "writeProjectPlanScripts",       // engine + package.json wrapper entries
    "writeProjectCapsulesPolicy",    // docs/agent-process/project-capsules.md
    "writeProjectsReadmeSeed",       // projects/README.md with empty managed block
    "wireProjectCapsulesAgents",     // AGENTS.md managed block + Start Map line
    "wireProjectCapsulesBaseline"    // .agent/startup-baseline.json entries
  ]
}
```

`foundation.agents` must **not** reference `projects/` unconditionally — the Start Map line, startup-baseline entries, and AGENTS managed block are all owned by `foundation.projects` and only emitted when it is selected.

### 4.6 Automation integration (PCD8)

| Surface | Required wiring |
| --- | --- |
| document-policy charter (`repo-template/docs/agent-process/document-policy.md`) | add a `projects/` charter row (owner: agents; budget: PLAN.md lean; above-the-fold = Agent Quickload); redefine `docs/plans/**` as **legacy/fallback** |
| AGENTS Start Map | `Projects / active: projects/`; `Legacy plans: docs/plans/` |
| `.agent/startup-baseline.json` | expect `projects/README.md`, `docs/agent-process/project-capsules.md`, `scripts/project-plan/*` (only when `foundation.projects` selected) |
| doc-sweep eligibility | include add-only `projects/**/*.md` and owner-safe images; carry the hard exclusions below |
| owner-maintenance safe-paths | allow **only** `*.md` + images (`png/jpg/jpeg/gif/webp/svg`, `drawio`) under `projects/**`; **never** code/config/scripts/workflows/manifests/locks/binaries/env/secrets |
| doc-health | import `scripts/project-plan/lib.mjs` validators; checks = invalid/missing required frontmatter, illegal status value, `status: active` past 30-day cadence, capsule whose location disagrees with status (e.g. `finished` still in `projects/<slug>/`), `projects/README.md` managed block out of sync with the filesystem, slug collision |
| archon-setup audit / maintenance engine (#212) | detect adoption (PCD-adoption signal) and stale/missing capsule baseline per `lifecycle: active` repo |
| `project-plan` skill | call the engine via `npm run project-plan -- …`; never reimplement rules |

**Adoption signal:** a repo has adopted project capsules when `projects/README.md` exists **and** the AGENTS Start Map points active work to `projects/`.

### 4.7 Migration behaviour (PCD9)

Conservative — no bulk move:

- Existing `docs/plans/**` files are historical/fallback and remain valid until explicitly migrated.
- Do **not** create new `docs/plans/**` files once a repo has adopted `projects/`.
- `migrate <docs/plans/path> --as <slug>` migrates one active or actively-referenced plan at a time; stale historical plans are left in place.
- Inbound links are preserved by updating `projects/README.md`, not by creating redirect stubs (add stubs only if link rot becomes painful). **Migration is deferrable to v1.1** if v1 is already large.

## 5. Lane decomposition

| Lane | Title | Repo | Deps |
| --- | --- | --- | --- |
| L0 | `spec(design)`: project-capsules rollout design — **this lane** | archon-setup | — |
| L1 | `feat(engine)`: `project-plan` engine + `project-capsules.md` policy + AGENTS contract + Start Map line + `projects/README.md` seed + npm wrappers | repo-template | document-policy lane 1b (charter), L0 |
| L2 | `feat(registry)`: `foundation.projects` (default-on, unlocked, owns full surface) + snapshot refresh + audit/startup-baseline | archon-setup | L1 |
| L3 | `feat(skill)`: `shared/project-plan` skill (scaffold + lifecycle wrapper) | jma-skill-review | L1, L2 |
| L4 | `feat(doc-health)`: capsule checks via imported `lib.mjs` validators (+ optional monthly cron) | repo-template / github-workflows | L1, document-policy lane 3a |
| L5 | `feat(migrate)`: `docs/plans/**` one-at-a-time migration command | repo-template | L1 (v1.1, deferrable) |

**Order:** L0 → L1 → L2 → L3; L4 after L1 (coordinate with document-policy lane 3a in #223); L5 last / optional.

**Risks:** L1 amends the document-policy charter + AGENTS Start Map — a distributed managed surface; land the charter-row edit as its own commit and coordinate with document-policy lane 1b before branching. The 30-day staleness cadence may need tuning (it is a flag, not a block).

## 6. Verification (per lane; recorded in each PR)

- **L1:** `lib.test.mjs` fixtures — clean tree → zero findings; each seeded violation → exact finding; every transition (legal + illegal) covered; idempotent re-runs are no-ops; `--dry-run` writes nothing; `--json` shape stable; engine never invokes git; `project-capsules.md` renders and the AGENTS contract stays ≤5 lines; `npm test` green in repo-template.
- **L2:** `npm run refresh-snapshots` + `snapshots:verify` green; `foundation.projects` plan/apply idempotent (re-run = no duplicate state); registry tests assert default-on + unlocked + the full `creates`/`tasks` surface; a repo that deselects the feature ends with **no** `projects/` Start Map line, baseline entry, or AGENTS block.
- **L3:** skill walkthrough scaffolds a valid capsule in a scratch repo and runs `finish`/`archive`/`reopen` via the engine (no rule reimplementation).
- **L4:** doc-health fixtures for each capsule check; report-only (no writes outside the report path); scoped `actionlint` + integration test on any cron workflow (permissions block, tag-ref alignment, integration-test presence).
- **L5:** `migrate` moves one plan, updates the index, leaves stale plans untouched; no bulk move.

## 7. Out of scope / deferred

The **Project Atlas** — the roadmap compiler that reads capsules (+ GitHub Issues/Projects) and generates Mermaid Gantt / dependency graph / release map / `AGENT_CONTEXT` — is the deferred follow-on. This spec only makes `projects/<slug>/PLAN.md` a real, automation-aware surface and ships its lifecycle engine. When the Atlas is built, the graph/progress/confidence fields land under a reserved `atlas:` frontmatter block (clean migration; no rework of the lean fields).

## 8. Decision log (preserved from the brainstorming session)

DL1 root `projects/<slug>/PLAN.md` · DL2 one PLAN.md, split-on-growth rollups · DL3 PLAN.md indexes/links out · DL4 statuses + command-owned validated moves · DL5 lean frontmatter, Atlas deferred · DL6 `docs/plans/**` legacy/fallback · DL7 `projects/**` durable surface · DL8 `projects/README.md` index updated with moves · DL9 legal transitions (§4.3) · DL10 adoption signal · DL11 owner-safe allowlist · DL12 conservative migration · DL13 spec transient in archon-setup, durable policy in repo-template · DL14 capsule trigger (>1 session/PR or owner-facing scope/invariants) · DL15 `id` = bare slug · DL16 separate `project-plan` skill · DL17 slug uniqueness · DL18 explicit `foundation.projects` (default-on, **unlocked**, owns full surface) · DL19 npm wrappers · DL20 `--dry-run`/`--json` · DL21 CLI/lib split, doc-health imports lib · DL22 writes-only, scoped dirty-tree refusal · DL23 idempotent subcommands · DL24 explicit reopen path + `--as` on collision · DL25 managed-block index regeneration · DL26 conservative one-at-a-time migration · DL27 engine ("Project Capsules Engine") + finalized subcommand set + rollout order.
