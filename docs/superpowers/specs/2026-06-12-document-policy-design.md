# Document policy: charters, vision layer & doc-health — design spec

- **Date:** 2026-06-12
- **Author:** Claude (Fable 5), via owner planning session (decisions recorded below).
- **Status:** DRAFT — for owner review. This doc is the review gate before the lanes implement it.
- **Tracking issue:** [archon-setup #223](https://github.com/ArchonVII/archon-setup/issues/223) (epic; one sub-issue per lane).
- **Branch / worktree:** `agent/claude/223-document-policy-spec` at `C:\GitHub\archon-setup-223-document-policy-spec`.
- **Builds on:** [github-workflows #63](https://github.com/ArchonVII/github-workflows/issues/63) (Codex document-policy proposal), `ArchonVII/.github/STARTER.md`, `repo-template/AGENTS.md` + `docs/agent-process/doc-sweep.md`, `docs/MAINTENANCE.md` + `docs/superpowers/specs/2026-06-12-ecosystem-registry-and-maintenance-design.md` (epic #212).

---

## 1. Problem

The ecosystem has three healthy policy layers — human-facing (`STARTER.md`), agent-facing (`AGENTS.md`), and distribution (feature registry) — but no document-control model connecting them, and five concrete gaps:

1. **No single document policy.** What each doc is for, who may change it, how it propagates, and when it stops being guidance is distributed across `STARTER.md`, AGENTS.md sections, and four convention READMEs.
2. **No placement policy.** Nothing states what must appear in the first screen of an agent-read doc, what its size budget is, or that a fact may have only one canonical home. AGENTS.md sections are appended in arrival order, not priority order.
3. **No vision/goals layer.** No VISION/GOALS/PRD-shaped doc exists in any template. Owner intent lives in chat transcripts; owner decisions are buried in spec-PR tables where they cannot be found later.
4. **No doc-health loop.** Doc Sweep-Up recovers *stranded* docs; nothing audits *degraded* docs — overgrown, stale, contradictory, or irrelevant content in active repos.
5. **No owner-drift instrument.** Nothing captures owner intent in a form agents can check work against, and nothing answers "why is it like this, and when was that decided?"

## 2. Understanding summary

- **What:** per-document charters + placement-priority rules (one policy doc, distributed via the normal provider path), a root `VISION.md` + append-only owner decision log + interactive intake skill, and a doc-health capability (deterministic checker + maintenance-engine signal + monthly semantic audit).
- **Why:** documents are the agents' operating surface; uncontrolled docs drift into noise that misdirects agents, and uncaptured owner intent makes scope drift invisible until it is expensive.
- **Who:** the owner (authors vision, appends decisions, answers intake interviews), agents (honor charters, check drift, run doc-health), the maintenance engine (surfaces per-repo doc-health status).
- **Integration:** charters extend `STARTER.md` and land as `repo-template/docs/agent-process/document-policy.md` (the doc-sweep "contract + detail doc" pattern); doc-health reuses the `scripts/doc-sweep/` shape, the registry's `lifecycle: active` list, the maintenance status engine (epic #212 lane 2), and the github-workflows cron-caller pattern; the vision layer ships through the feature registry like every other foundation doc.
- **Non-goals:** auto-rewriting docs (doc-health reports and files issues; it never edits); status headers on `README.md`/`AGENTS.md`/`CHANGELOG.md`/tool stubs (gw#63 §5 exemption holds); a per-repo mega policy file; any machine-global doc registry; replacing ADRs (they stay technical).

## 3. Relationship to github-workflows#63

[gw#63](https://github.com/ArchonVII/github-workflows/issues/63) is adopted as the policy core with amendments:

- **Adopted as-is:** §1 governing-rule table, §2 source-of-truth hierarchy, §4 lifecycle states (`draft / active / accepted / superseded / archived / scratch`), §5 status header (durable `docs/**` only), §6 enforcement map, §7 maturity ladder (observation → napkin → research → plan → policy), §8 placement (full policy in repo-template; index in STARTER.md; no giant per-repo file).
- **Amended:** §3 default doc map gains `VISION.md` and `docs/decisions/decision-log.md` rows; §9's single "connect the layers" PR is replaced by the lane decomposition below.
- **Added (not in the proposal):** placement-priority rules (§5.1), the vision/decision layer (§5.2), doc-health (§5.3), warning-only lint (§5.4).

gw#63 is cross-linked to this spec and closes when lane 1 ships.

## 4. Owner decisions (2026-06-12)

| # | Decision | Alternatives rejected | Why |
| --- | --- | --- | --- |
| OD1 | `VISION.md` at repo root | `docs/vision.md` | Same rank as README/AGENTS; root placement is what gets it read |
| OD2 | Decision log = separate append-only ledger at `docs/decisions/decision-log.md` | ADR subtype | Fits the Owner Maintenance Lane append allowance; ADRs stay technical and agent-authored |
| OD3 | Semantic doc-health audit: monthly cron **and** on-demand | Cron-only; on-demand-only | Cron catches what nobody asks about; on-demand serves active sessions |
| OD4 | Size budgets: README ≤150, AGENTS.md ≤300, CLAUDE/GEMINI stubs ≤25, VISION ≤120 lines | No budgets; hard caps | Budgets are doc-health flags, not blocks; over budget means content moves down the hierarchy |
| OD5 | `foundation.vision` registry feature: default-on, **unlocked** | Locked like other foundations | Provider/defaults repos don't need a vision doc; applications do |
| OD6 | Spec home: this repo's `docs/superpowers/specs/` | Keep in gw#63 thread | Matches the #212 convention; gw#63 stays cross-linked |

Cadence defaults (owner-approved with this plan, 2026-06-12; tune in lane PRs without re-review): VISION.md `Last reviewed` stale after **90 days**; `active` plans untouched for **30 days** flag stale; semantic audit cadence **monthly** per `lifecycle: active` repo.

## 5. Design

### 5.1 Policy core: charters + placement rules (lanes 1a–1c)

`repo-template/docs/agent-process/document-policy.md` is the full per-repo policy. It contains the gw#63 lifecycle states and status header, plus a **charter** per foundational doc — the question it answers, its owner, size budget (OD4), above-the-fold requirement, and hard exclusions:

| Document | Answers | Owner | Budget | Hard exclusions |
| --- | --- | --- | --- | --- |
| `README.md` | What is this, how do I run it? | human | ≤150 | architecture detail, process rules, history |
| `AGENTS.md` | How do agents work here? | ecosystem (provider) | ≤300 | tool quirks, full specs (contract + link only), project vision |
| `CLAUDE.md` / `GEMINI.md` | Tool divergences only | ecosystem | ≤25 | anything that applies to all tools |
| `VISION.md` *(new)* | What experience are we building; what is out of scope? | **human only** | ≤120 | implementation detail, task lists, status |
| `docs/decisions/decision-log.md` *(new)* | What did the owner decide, when? | human (agent-appended) | append-only | rationale essays — one-liners + links |
| `CHANGELOG.md` / fragments | What shipped for users? | agents | n/a | operational changes (update log's job) |
| `docs/repo-update-log.md` | What changed operationally? | agents | append-only | user-facing release notes |
| `ARCHITECTURE.md` | Where does each subsystem live? | agents | on-demand | per-file documentation |
| `docs/plans/`, `docs/adr/`, `docs/research/` | Planning / technical decisions / evidence | agents | existing conventions | (unchanged) |
| `.claude/noticed.md`, `.claude/napkin.md` | Observations / curated runbook | agents | napkin top-10/category | promotable content left unpromoted |

**Placement-priority rules** (enforced by doc-health §5.3 and lint §5.4):

1. **Above-the-fold:** the first ~30 lines of any agent-read doc hold binding rules or pointers to them — never history, background, or rationale.
2. **Fixed AGENTS.md section order:** the template defines a priority-ordered skeleton (Read First → Start Map → Workflow → enforcement guards → lifecycle/closeout → capabilities → reference). New capabilities insert into their priority class, not at the end.
3. **One home per fact:** every rule has exactly one canonical doc; every other mention links. Two copies always diverge.
4. **Contract + detail doc:** anything needing >10 lines in AGENTS.md becomes a ≤5-line contract plus a link to `docs/agent-process/<topic>.md` (the doc-sweep pattern, codified).
5. **Managed blocks** for every distributor-maintained section.
6. **Budgets per the charter table;** exceeding one moves content down the hierarchy rather than growing the doc.

Wiring: AGENTS.md Start Map pointer + `.agent/startup-baseline.json` entry (lane 1b); `STARTER.md` gains charter columns, the two new doc rows, and a pointer to the full policy — it remains the human-facing index (lane 1a); `foundation.agents` `creates` list gains `docs/agent-process/document-policy.md` + snapshot refresh (lane 1c).

### 5.2 Vision layer (lanes 2a–2d)

**`VISION.md`** (root, owner-authored, agent-read). Template sections: **Experience** (the experience the user/developer should have), **North star** (long-term ideal, no constraints), **Scope** (must-have / nice-to-have / **explicitly-not**), **Current horizon** (what "done for now" means), **Drift tripwires** (owner-stated creep signals), plus a status header with `Last reviewed:`.

**`docs/decisions/decision-log.md`** — append-only owner-intent ledger, newest first:

```markdown
## 2026-06-12 — <decision title>
- **Decision:** <one line>
- **Lane:** <issue/PR URL>
- **Why:** <one line>
```

Deliberately not an ADR: ADRs are agent-authored technical records; this is the owner's intent ledger. Lane 2a adds it to the pre-commit append-log allowlist (alongside `.claude/noticed.md` / `.claude/napkin.md`) so the owner can append on main with zero ceremony.

**Agent drift duties** (new ≤5-line AGENTS.md contract, detail in document-policy.md): at plan time, read `VISION.md` if present; if requested work conflicts with Scope/explicitly-not, surface the conflict and cite the relevant decision-log entry before proceeding; at closeout, append any owner scope decisions made during the lane. The PR template gains one line: `Owner decisions this lane: appended / none`.

**`project-intake` skill** (jma-skill-review `shared/project-intake/`, propagating to all three CLIs). Per the tool-agnostic-capability rule, the *artifact contract* (VISION.md format, drift duties) lives in repo-template; the skill is only the interactive front-end. Two modes:

- `new` — interviews the owner and writes `VISION.md` + seed decision-log entries. Question set: the experience you want the user/developer to have; the long-term ideal version (scope answers depend on it); must-have vs nice-to-have; explicitly-not; what "done for now" looks like; who it's for / not for; constraints; what would make you redesign this; how we'll know it's drifting.
- `revisit` — re-asks against the existing `VISION.md`, diffs the answers, proposes updates + decision-log entries for what changed. This is the drift-catch on the owner.

**Registry:** new `foundation.vision` feature (default-on, unlocked — OD5; `creates: ["VISION.md", "docs/decisions/decision-log.md"]`) (lane 2b). **Backfill** (lane 2d): owner-paced intake interviews per `lifecycle: active` registry repo; tracked as epic checklist, no sub-issue.

### 5.3 Doc-health (lanes 3a–3c)

**Deterministic checker** — `repo-template/scripts/doc-health/` (sibling shape to `scripts/doc-sweep/`), contract at `docs/agent-process/doc-health.md` + ≤5-line AGENTS.md contract. Checks: charter budget overruns; `Last reviewed` past cadence; `active` plans untouched past cadence; `superseded` docs without a `Superseded by` pointer; dangling relative links; placeholder tokens (TODO/TBD/N/A) in `active` docs; tool stubs grown past budget; startup-baseline ↔ filesystem mismatches. Output: report + filed issues. **Never edits docs** — fixes go through normal lanes.

**Maintenance-engine signal** — the per-repo `maintenance` status (epic #212 lane 2, `computeMaintenanceStatus`) gains a doc-health input with reason codes `docs-overbudget | docs-stale | docs-unswept`, computed for `lifecycle: active` repos from the checker's cached report (same audit-cache pattern as `repo.audit`; never writes to the target repo). Sequenced after/with #215 — if #215 has merged, this is an additive reasons-source PR.

**Semantic audit** — what scripts can't catch: contradictions between docs, irrelevant/carried-away content, vision drift (recent merged PRs vs `VISION.md` Scope). Monthly cron caller in github-workflows per the doc-sweep cron precedent, plus on-demand invocation (OD3). Output: a report + issues per finding; never edits.

### 5.4 Enforcement (lane 4)

Warning-only `doc-policy-lint` reusable workflow in github-workflows (the PR-template drift-guard precedent: warn first): status-header presence on durable `docs/**` (ADRs/fragments/plans-with-own-format exempt), charter budgets, dangling `Supersedes`/`Superseded by` links, placeholder tokens in `active` docs. Promotion into `.agent/check-map.yml`'s `docs` category as a required check is deferred until a clean quarter of warnings.

## 6. Lane decomposition

| Lane | Title | Repo | Deps |
| --- | --- | --- | --- |
| 1a | docs(starter): STARTER.md → document-policy charter index | .github | — |
| 1b | docs(policy): document-policy.md charters + placement rules + Start Map pointer + startup-baseline | repo-template | — |
| 1c | chore(snapshots): refresh + foundation.agents document-policy wiring | archon-setup | 1a, 1b |
| 2a | feat(vision): VISION.md template + decision-log convention + drift duties + PR-template line | repo-template | 1b |
| 2b | feat(registry): foundation.vision feature | archon-setup | 2a |
| 2c | feat(skill): project-intake skill (new + revisit modes) | jma-skill-review | 2a |
| 2d | Backfill vision interviews on active repos | owner-paced (epic checklist) | 2c |
| 3a | feat(doc-health): deterministic checker + contract | repo-template | 1b |
| 3b | feat(maintenance): doc-health signal in maintenance engine | archon-setup | 3a, #215 |
| 3c | feat(cron): monthly semantic doc-health audit caller | github-workflows | 3a |
| 4 | feat(lint): doc-policy-lint reusable workflow (warning-only) | github-workflows | 1b |

Risks: AGENTS.md reordering (rule 2) touches a distributed managed surface — land it as its own commit inside lane 1b with a snapshot-refresh note in the Ecosystem Fix Queue; budget numbers may prove wrong in practice — they are flags, and lane PRs may tune them citing OD4; lane 3b must not collide with in-flight #215 (coordinate in that issue before branching).

## 7. Verification (per lane; recorded in each PR)

- 1a/1b: charters render; Start Map + startup-baseline agree with the filesystem; `npm test` green in repo-template; AGENTS.md stays ≤300 lines after its own reordering.
- 1c: `npm run refresh-snapshots` + `snapshots:verify` green; root baseline == snapshot byte-for-byte; registry tests assert the new `creates` entry.
- 2a: VISION/decision-log templates pass doc-policy charters; pre-commit allows owner append to `docs/decisions/decision-log.md` on main and still blocks other modifies.
- 2b: feature plan/apply idempotent (re-run produces no duplicate state); unlocked + default-on asserted in registry tests.
- 2c: skill walkthrough produces a valid VISION.md in a scratch repo; `revisit` mode diffs and proposes decision-log entries.
- 3a: checker fixtures for every check (clean repo → zero findings; seeded violations → exact findings); report-only verified (no writes outside report path).
- 3b: status rules unit-tested with synthetic doc-health inputs; snapshot validates against the ECOSYSTEM_STATE contract.
- 3c/4: scoped `actionlint` on changed workflow files; integration test per the reusable-workflow review rule (permissions block, tag-ref alignment, integration-test presence).

## 8. Amendment 2026-06-15 — authority/freshness via simplification

**Context.** A Hudson Bend doc-cohesion review (`ArchonVII/hudson-bend` PRs [#216](https://github.com/ArchonVII/hudson-bend/pull/216)/[#218](https://github.com/ArchonVII/hudson-bend/pull/218) — caught in review, *not* shipped) confirmed the §1 gap concretely: `wiki:lint`/`wiki:doctor` prove *structure*, not *truth*. A branch can pass every documented check while a roadmap, index, `CANON.md`, or front door still carries stale current-state claims.

**Decision (owner, 2026-06-15).** Close this by **reducing the number of places that may claim current truth**, not by adding review procedure. No new taxonomy, no mandatory pre-PR search ritual, no per-repo interim checklist, no blocking gates. Every item below reuses the §5.1 charters, §4 lifecycle states, and the §5 status header. This section is self-contained so the original owner-approved §1–§7 design stays intact.

### 8.1 Three invariants (policy text — extends §5.1, no parallel model)

These land in `repo-template/docs/agent-process/document-policy.md` as policy prose. They do **not** add an "authority classes" taxonomy — the charter "Answers" column, lifecycle states, and `Source of truth:` header already encode authority.

1. **Few current-truth registers.** A repo names a small, explicit set of current-truth surfaces using the existing `Source of truth: yes` header. Everything else is navigation, decision history, evidence, or project-local context. Fewer surfaces that may say "current" means less to keep mutually consistent.
2. **Front doors link; they don't duplicate.** `README.md`, `ROADMAP.md`, `docs/INDEX.md`, and `llms.txt` are navigation. They may link to current truth but must not restate volatile status. Before a front door labels a target "current/authoritative," that target must itself declare `Status: active` + a recent `Last reviewed:`; otherwise the front door labels it historical/contextual.
3. **Dated plans are historical by default.** A dated `docs/plans/<date>-*.md` is a historical snapshot unless it carries `Status: active` + `Source of truth: yes`. For active per-feature work the current front door is `projects/<slug>/PLAN.md` (project-capsules convention, [repo-template #87](https://github.com/ArchonVII/repo-template/pull/87)); `docs/plans/**` are historical/fallback once a capsule exists.

### 8.2 Doc-health signals (folds into lanes 3a/4 — warn-only, replaces manual steps)

The "search every front door / grep stale terms / register every index before each PR" checklist is **rejected as a manual ritual** (open-ended, token-costly, inconsistently performed). Instead lane 3a's checker and lane 4's warn-only lint gain two tool-side signals that *replace* agent obligations:

- **Index coherence (warn).** A durable doc that exists but is absent from its landing/index (`docs/adr/*.md` ∉ ADR index; durable `docs/**` ∉ `docs/INDEX.md`) warns. Prefer *generated* indexes where cheap (`projects/README.md` from `projects/*/PLAN.md`; changelog from `.changelog/unreleased/*`) over manual registration — manual registration is a transition state, not the target.
- **Stale active-doc terms (warn).** When a PR changes a current-truth register, warn if nearby `active` docs still carry stale tokens (issue/migration numbers; "not deployed / next / remaining / deferred / blocked / pending"). Warning-only, never blocking; a reviewer may request it on demand.

The Hudson Bend #216/#218 drift (stale roadmap claim; ADR absent from `docs/INDEX.md`; stale `CANON.md` wording) is the named **acceptance fixture** for lane 3a's seeded-violation fixtures (§7, 3a): the checker must surface exactly these, and a clean repo must yield zero findings.

### 8.3 Stack-aware review (note, not a lane)

One line added to the closeout/review contract (rides lane 2a; **not** a doc-policy mechanism): for stacked docs PRs, review `origin/main..HEAD`, not the narrow PR diff, so a clean top-of-stack diff cannot hide unresolved base drift.

### 8.4 Lane impact

- **No change to PR [repo-template #96](https://github.com/ArchonVII/repo-template/pull/96) (lane 1b).** It stays the tight charters/placement/baseline lane and is faithful to §5.1; nothing in it contradicts §8.1. Folding §8.1 into it would mix scopes.
- §8.1 policy text folds into the next repo-template policy lane (**2a**) or a small **1d** follow-up — owner to schedule.
- §8.2 signals are absorbed by existing lanes **3a** (checker) + **4** (warn-only lint) — no new lane.
- §8.3 is a one-line addition to the AGENTS.md closeout/review contract (rides **2a**).

**Explicitly rejected (do not re-add):** a second "authority classes" taxonomy; a mandatory per-PR search/inspection checklist; per-repo interim checklists; blocking enforcement (warn-first per the PR-template drift-guard precedent).
