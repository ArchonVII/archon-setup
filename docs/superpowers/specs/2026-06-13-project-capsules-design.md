# Project capsules: per-feature PLAN.md front door (convention-first) — design spec

- **Date:** 2026-06-13
- **Author:** Claude (Opus 4.8), via owner brainstorming + a 4-persona council red-team (decisions recorded below).
- **Status:** DRAFT — for owner review. This doc is the review gate before the lanes implement it.
- **Revision:** **rev 2** — re-scoped to **convention-first** after a council red-team found the original (engine-first, 6-lane) plan assumed document-policy infrastructure that is **specified but not yet built**. See §0.
- **Tracking issue:** [archon-setup #245](https://github.com/ArchonVII/archon-setup/issues/245) (epic; one sub-issue per lane).
- **PR:** [archon-setup #246](https://github.com/ArchonVII/archon-setup/pull/246) (draft, spec-only).
- **Branch / worktree:** `agent/claude/245-project-capsules-spec` at `C:\GitHub\archon-setup-245-project-capsules-spec`.
- **Builds toward (NOT yet shipped — see §0):** [archon-setup #223](https://github.com/ArchonVII/archon-setup/issues/223) document-policy (charters, `VISION.md`, decision-log, doc-health), [archon-setup #212](https://github.com/ArchonVII/archon-setup/issues/212) ecosystem-registry + maintenance engine. **Builds on (shipped):** `repo-template/docs/agent-process/doc-sweep.md` + `scripts/doc-sweep/` (the engine shape), `repo-template/AGENTS.md` Start Map, `pattern-tool-agnostic-capability`, `playbook-ecosystem-capability-rollout`.

---

## 0. Dependency reality (read first)

A council red-team verified the following against the live repos on 2026-06-13 — and it changes the rollout:

- **document-policy merged as a *spec only*.** PR #224 landed `docs/superpowers/specs/2026-06-12-document-policy-design.md` "before the lanes implement it." Its implementation lanes are **open / unbuilt**: there is **no** `repo-template/docs/agent-process/document-policy.md` (lane 1b), **no** `repo-template/scripts/doc-health/` (lane 3a), **no** `VISION.md` template (lane 2a), and **no** `foundation.vision` in `archon-setup`'s feature registry (lane 2b). Verified: `repo-template/scripts/` contains only `doc-sweep/`, `agent/`, `close/`; `repo-template/docs/agent-process/` contains only `doc-sweep.md`; `archon-setup/src` has zero `foundation.vision` / `doc-health` / `document-policy` references.
- **`repo-template/AGENTS.md` still points agents at `docs/plans/`** (`AGENTS.md:18` — `- Plans: \`docs/plans/\``), not `projects/`.
- **`AGENTS.md` has a single managed Start Map region** owned by `foundation.agents` (`archon-setup/src/server/tasks/writeAgentsMd.mjs` reconciles exactly one block near the top). A second feature that also writes the Start Map would collide with no defined protocol.

**Consequence:** the original plan — import `doc-health`'s validator lib, amend a document-policy charter row, follow the `foundation.vision` precedent — referenced a floor that does not exist. This rev re-scopes to a **convention-first v1** that ships standalone, assumes no unbuilt infrastructure, and reuses the single existing AGENTS.md writer. The lifecycle engine, the `foundation.projects` registry feature, and all doc-health / doc-sweep / startup-baseline / maintenance-engine wiring move to a **gated v2** (§5).

## 1. Problem

Document-policy (when built) gives each repo a single **repo-level** intent layer — root `VISION.md` + an append-only `docs/decisions/decision-log.md`. There is no **per-feature** orientation layer. An agent assigned a task still reconstructs context by hunting across `docs/plans/`, `docs/superpowers/specs/`, `docs/adr/`, `docs/research/` — none a guaranteed, guessable, single entry point.

This spec adds a **per-project capsule**: `projects/<slug>/PLAN.md` as the required, guessable front door for one feature/effort — its why, staged plan, invariants, pivots, and current state. **v1 is the convention itself** (the file, the policy doc, the Start Map pointer). The deterministic lifecycle engine that would automate state transitions and archival is a **deferred v2** that must earn its existence through proven pain.

## 2. Understanding summary

- **What (v1):** a repo-local convention — `projects/<slug>/PLAN.md` as the canonical front door for one feature — plus a short policy/contract doc and an AGENTS Start Map pointer. Lifecycle in v1 is manual (`git mv` + a frontmatter `status` edit), documented in the policy.
- **What (v2, deferred):** a deterministic engine (`scripts/project-plan/`) that validates/transitions/moves capsules and regenerates an index; a `foundation.projects` registry feature; doc-health capsule checks; migration tooling.
- **Why:** documents are the agents' operating surface; without a per-feature anchor, orientation is rebuilt every session, and `docs/plans/` (flat, loose) is not a guessable single home.
- **Who:** agents author/update `PLAN.md`; the owner reads it and approves pivots (same split as `VISION.md` + decision-log).
- **Boundary / non-goals:** `PLAN.md` **links out** to specs/ADRs/research/issues — never replaces them ("one home per fact"). No dependency graph / `progress` / `confidence` / Atlas wiring (deferred). One `PLAN.md` per capsule. v1 assumes **no** unbuilt document-policy infrastructure.

## 3. Owner decisions (2026-06-13)

The decisions are unchanged in intent; the **Phase** column records what ships in v1 vs what is deferred to the gated v2.

| # | Decision | Phase | Rejected alternatives / notes |
| --- | --- | --- | --- |
| PCD1 | Canonical home = root `projects/<slug>/PLAN.md`; `docs/plans/**` → legacy/fallback | **v1** | `docs/plans/<feature>/`, `docs/projects/` — "guessable front door" is the core requirement |
| PCD2 | Lean frontmatter: `id` (bare slug), `title`, `status`, `created`, `updated` (+ optional `issue`) | **v1** | Graph/progress/confidence deferred to a future `atlas:` block |
| PCD3 | One required `PLAN.md`; `decisions.md`/`research.md` split **only on growth**, as rollups that link to ADR/research | **v1** | Multi-file day one; ADR substitute |
| PCD4 | Statuses `intake \| active \| paused \| finished \| archived`; `_finished/`+`_archive/` date-prefixed; "blocked" is a body note | **v1** (manual moves) | Transitions are documented and applied by `git mv`+edit in v1; **enforced by the engine in v2** |
| PCD5 | Deterministic lifecycle engine `repo-template/scripts/project-plan/` (CLI/lib split, `--dry-run`/`--json`, idempotent, writes-only, scoped dirty-tree refusal) | **v2 (deferred)** | Must be earned by proven `mv`+index-drift pain (council: Pragmatist, High) |
| PCD6 | Durable policy `repo-template/docs/agent-process/project-capsules.md` + ≤5-line AGENTS contract | **policy/contract = v1** | The separate `project-plan` **skill = v2** (it wraps the v2 engine) |
| PCD7 | A `foundation.projects` registry feature, default-on + unlocked, owning its whole surface | **v2 (deferred, blocked)** | Blocked on the AGENTS.md multi-tenant ownership protocol (§4.5). In v1 the Start Map line is owned by the existing `foundation.agents` writer — no second writer |
| PCD8 | `projects/**` wired into document-policy charter, doc-health, doc-sweep, startup-baseline, owner-maintenance safe-paths | **AGENTS Start Map = v1; rest = v2/blocked** | doc-health/charter floors do not exist yet; `projects/**` stays **out** of doc-sweep auto-commit in v1 (council: Skeptic, High) |
| PCD9 | `projects/README.md` regenerated from frontmatter into a managed block; conservative migration | **README: v1 hand-maintained, v2 generated** | Regeneration needs the engine; migration command is v2 |

## 4. Design

### 4.1 Capsule shape

```text
projects/
  README.md                      # v1: optional, hand-maintained index. v2: engine-generated (managed block)
  <slug>/                        # active / intake / paused capsules
    PLAN.md                      # REQUIRED front door
    decisions.md                 # OPTIONAL — only once Decisions/Pivots outgrows PLAN.md
    research.md                  # OPTIONAL — only once research outgrows PLAN.md
    assets/                      # OPTIONAL — images/diagrams only
  _finished/2026-06-13-<slug>/   # shipped (v1: manual git mv; v2: `finish` command)
  _archive/2026-06-13-<slug>/    # abandoned/superseded (v1: manual git mv; v2: `archive` command)
```

- **Slug** = bare, human, guessable (`inventory-screen`), not typed (`FEAT-…`). Active slugs unique within `projects/`; collisions take a short qualifier (`-v2`).
- **Split files are rollups, not substitutes:** `decisions.md` links to `docs/adr/**`; `research.md` links to `docs/research/**`. After a split, `PLAN.md` keeps a summary + pointer.
- **Adoption signal (revised — council: Skeptic/Advocate):** a repo has adopted capsules when **at least one `projects/<slug>/PLAN.md` actually exists** — *not* merely when a registry feature was selected. An empty `projects/README.md` is not adoption.

### 4.2 `PLAN.md` template (trimmed — council: Advocate)

The template is cut to skill.md weight to avoid empty-section graveyards. **Required** sections are the orientation core; everything else is **optional / on-growth**.

```markdown
---
id: inventory-screen
title: Inventory Screen
status: intake          # intake | active | paused | finished | archived
created: 2026-06-13
updated: 2026-06-13
issue: 234              # optional
---

# Inventory Screen — PLAN

## Agent Quickload            <!-- REQUIRED -->
- **Current state:** <one line>
- **Next safe action:** <one line>
- **Main blocker:** <one line, or "none">
- **Do not change:** <invariants in one line>
- **Read first:** <links to the deep specs/ADRs/code>

## Why / what was asked for   <!-- REQUIRED -->
<the experience requested and why this exists>

## Scope                      <!-- REQUIRED -->
- **In:** … · **Out:** … · **Later:** …

## Invariants                 <!-- REQUIRED — do not break without updating this PLAN -->
- …

## Source links               <!-- REQUIRED — summarize + point; never duplicate -->
- Specs: `docs/superpowers/specs/…` · ADRs: `docs/adr/…` · Research: `docs/research/…` · Issues/PRs: #…

## Agent handoff              <!-- REQUIRED -->
Before working here: read this PLAN, check the blocker, preserve invariants.
After meaningful changes: update Current state + `updated:`.

<!-- OPTIONAL / on-growth (add a section only when it has real content): -->
<!-- ## End-to-end plan (staged)  -->
<!-- ## Dependencies & blockers   (tables) -->
<!-- ## Decisions & pivots        (table) -->
```

### 4.3 Lifecycle — **v1 manual, v2 engine (deferred)**

**v1:** lifecycle is documented in `project-capsules.md`, applied by hand:
- create a capsule by copying the template to `projects/<slug>/PLAN.md` with `status: intake`;
- change state by editing the `status:` field and bumping `updated:`;
- finish/archive by `git mv projects/<slug>/ projects/_finished/<date>-<slug>/` (or `_archive/`) and setting `status`.

**v2 (deferred — PCD5):** a deterministic engine at `repo-template/scripts/project-plan/` (`index.mjs` CLI / `lib.mjs` pure validators / `lib.test.mjs`) provides `new / activate / pause / resume / finish / archive / reopen / touch / index / validate`, each with `--dry-run` + `--json`, idempotent, **writes files only (never `git add`/`commit`)**, with dirty-tree refusal scoped to the target capsule / `projects/README.md` managed area / move destination (unrelated dirt = warning). Legal transitions: `intake→active|archived`; `active→paused|finished|archived`; `paused→active|archived`; `finished→archived` (correction); `archived→active` (explicit `reopen <archive-path> [--as <slug>]`, which must also resolve `_finished/` slug collisions). The engine is built **only after** the convention proves orientation value and manual `mv`/index-drift proves painful.

### 4.4 `projects/README.md`

- **v1:** optional, hand-maintained simple index (or omitted — the AGENTS Start Map + a `projects/` listing suffice while capsule counts are tiny).
- **v2:** regenerated from `PLAN.md` frontmatter into a managed block (`<!-- BEGIN/END MANAGED PROJECT INDEX -->`), human prose preserved outside it. **CRLF discipline:** the regenerator must normalize with `\r?\n` (archon-setup CI gotcha: snapshots are CRLF locally / LF on CI) or it will thrash the index every run.

### 4.5 AGENTS.md Start Map — single-writer protocol (council: Architect)

`foundation.agents`'s `writeAgentsMd.mjs` owns the **one** managed Start Map region. v1 introduces **no second writer**:

- The Start Map line change is made in **`repo-template/AGENTS.md`** (the source `foundation.agents` already snapshots), **replacing** the single `- Plans: \`docs/plans/\`` line (`AGENTS.md:18`) with:
  ```
  - Projects (active feature work): `projects/<slug>/PLAN.md`
  - Plans (legacy / loose): `docs/plans/`
  ```
  This is a content edit inside the existing managed block — not a new managed block, not a competing task.
- **Coordination risk:** document-policy lane 1b (unbuilt) also edits the AGENTS.md Start Map (its "fixed section order"). L1a must land the projects line in a way 1b preserves when it ships; coordinate in #223 before branching (and if 1b lands first, fold the projects line into its skeleton).
- **v2 only:** if `foundation.projects` becomes a separate toggleable feature, it must **first** define a multi-tenant managed-block protocol (one block, multiple contributing features, deterministic order) or remain folded into `foundation.agents`. No competing single-region writers.

### 4.6 Automation integration

| Surface | v1 | v2 / blocked |
| --- | --- | --- |
| AGENTS Start Map | ✅ projects line via `foundation.agents` (§4.5) | — |
| `docs/agent-process/project-capsules.md` policy | ✅ ships standalone (does **not** require the unbuilt document-policy charter) | when document-policy lane 1b lands, its charter table gains a `projects/` row pointing here |
| doc-sweep eligibility | ❌ **excluded** — keep `projects/**` out of auto-commit until a validator can tell a complete capsule from a placeholder (council: Skeptic) | v2: include only frontmatter-complete capsules |
| doc-health capsule checks | ❌ blocked — `scripts/doc-health/` does not exist | v2: add checks (invalid frontmatter, illegal status, `active` past cadence, location≠status, index drift); **`paused` is exempt from staleness** |
| startup-baseline | ❌ deferred | v2: expect `project-capsules.md` (+ engine when built) |
| owner-maintenance safe-paths | optional v1 note: `*.md` + images only under `projects/**` | v2: enforce; never code/config/scripts/workflows/manifests/locks/binaries/env/secrets |
| maintenance engine (#212) | ❌ deferred | v2: per-repo capsule health |

### 4.7 Migration (conservative — unchanged)

`docs/plans/**` files are historical/fallback and remain valid. **Do not create new `docs/plans/**` files** once a repo adopts `projects/`. Migrate one active or actively-referenced plan at a time (manual in v1; `migrate <path> --as <slug>` command in v2). No bulk move. Note (council: Skeptic): a manual move can dead-link cross-references inside `docs/plans/`; when migrating an actively-referenced plan, grep for inbound links and update them in the same change.

## 5. Lane decomposition

| Lane | Title | Repo | Phase | Deps |
| --- | --- | --- | --- | --- |
| L0 | `spec(design)`: this document | archon-setup | — | — |
| **L1a** | `feat(projects)`: convention v1 — `project-capsules.md` policy + trimmed PLAN.md template + AGENTS Start Map line (in the `foundation.agents` block) + optional `projects/README.md` seed | repo-template | **v1 (ships now)** | L0; coordinate with document-policy lane 1b on the AGENTS Start Map |
| L1a′ | `chore(snapshots)`: refresh archon-setup snapshots so onboarded repos receive L1a | archon-setup | **v1** | L1a |
| L2 | `feat(engine)`: `project-plan` lifecycle engine (PCD5) | repo-template | **v2 (gated)** | L1a + proven `mv`/index pain |
| L3 | `feat(registry)`: `foundation.projects` feature — **only after** the AGENTS multi-tenant protocol (§4.5) | archon-setup | **v2 (gated)** | L2; AGENTS protocol |
| L4 | `feat(skill)`: `project-plan` skill wrapping the engine | jma-skill-review | **v2** | L2 |
| L5 | `feat(doc-health)`: capsule checks via imported `lib.mjs` | repo-template / github-workflows | **v2 (blocked)** | document-policy lane 3a must ship `scripts/doc-health/` first |
| L6 | `feat(migrate)`: `docs/plans/**` one-at-a-time migration command | repo-template | **v2** | L2 |

**Order:** L1a → L1a′ now. Everything else is a gated v2: build L2 only after the convention proves value; L3 only after the AGENTS protocol; L5 only after doc-health exists.

**Risks:** L1a touches the AGENTS.md Start Map (a distributed managed surface that document-policy lane 1b also touches) — land it as its own commit and coordinate in #223.

## 6. Verification

- **L1a:** `project-capsules.md` + the trimmed template render; the AGENTS Start Map shows the `projects/` lines and **replaces** (not duplicates) the `docs/plans/` line; AGENTS.md still has exactly one managed Start Map region (no second writer); `npm test` green in repo-template; AGENTS.md stays within its budget.
- **L1a′:** `npm run refresh-snapshots` + `snapshots:verify` green; root baseline == snapshot byte-for-byte; no `foundation.*` schema change (v1 adds no feature).
- **v2 lanes (when reached):** engine fixtures (clean → zero findings; each seeded violation → exact finding; every legal+illegal transition; idempotent re-runs; `--dry-run` writes nothing; never invokes git); `foundation.projects` plan/apply idempotent + adoption requires a real capsule; doc-health report-only.

## 7. Out of scope / deferred

- **The Project Atlas** (Gantt / dependency graph / release map / `AGENT_CONTEXT`) — future; lands graph fields under a reserved `atlas:` block.
- **The lifecycle engine, `foundation.projects`, the `project-plan` skill, and all doc-health / doc-sweep / startup-baseline / maintenance-engine wiring** — gated v2 (§5), built after the convention proves value and the document-policy floor exists.

## 8. Decision log (preserved)

DL1 root `projects/<slug>/PLAN.md` · DL2 one PLAN.md, split-on-growth · DL3 PLAN.md indexes/links out · DL4 statuses + (v2) command-owned moves · DL5 lean frontmatter, Atlas deferred · DL6 `docs/plans/**` legacy/fallback · DL7 `projects/**` durable surface · DL8 index updated with moves · DL9 transitions · DL10 adoption signal · DL11 owner-safe allowlist · DL12 conservative migration · DL13 spec transient, durable policy in repo-template · DL14 capsule trigger · DL15 `id` = bare slug · DL16 separate `project-plan` skill (v2) · DL17 slug uniqueness · DL18 `foundation.projects` default-on/unlocked (v2) · DL19 npm wrappers (v2) · DL20 `--dry-run`/`--json` (v2) · DL21 CLI/lib split (v2) · DL22 writes-only, scoped dirty-tree (v2) · DL23 idempotent (v2) · DL24 explicit reopen path + `--as` (v2) · DL25 managed-block index regen (v2) · DL26 conservative migration (v2) · DL27 engine + subcommands + order.

**Council red-team revisions (2026-06-13, rev 2):**
DL28 **convention-first v1; engine/feature/skill/doc-health deferred to a gated v2** (Pragmatist, High). DL29 **document-policy is spec-only; its lanes (1b/2a/2b/3a) are unbuilt** — v1 assumes none of them (Skeptic+Architect, verified). DL30 **AGENTS.md has one managed Start Map writer (`foundation.agents`); v1 adds no second writer**, and the `docs/plans/` line is **replaced, not duplicated** (Architect, High). DL31 **adoption = a real `PLAN.md` exists**, not feature-selection (Skeptic/Advocate). DL32 **PLAN.md template trimmed** to required (Quickload/Why/Scope/Invariants/Source links/Handoff) + optional-on-growth tables (Advocate). DL33 **`projects/**` excluded from doc-sweep auto-commit in v1** until completeness is detectable (Skeptic). DL34 **`paused` exempt from staleness; `reopen` must resolve `_finished/` collisions; CRLF `\r?\n` discipline on README regen** (Skeptic + orchestrator). DL35 **`foundation.projects` requires a multi-tenant AGENTS managed-block protocol before it can exist** (Architect).
