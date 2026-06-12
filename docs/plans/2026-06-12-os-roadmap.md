# Agent OS Roadmap — 2026-06-12

**Scope:** github-workflows, archon-setup, .github, repo-template, jma-skill-review (skills integration).
**North star:** An OS that is efficient, dependable, and clear; survives model/tooling change; and is *visually inspectable* — a live workflow graph generated from the real config, where every template, hook, workflow, policy, and branch point is a card you can open (and eventually edit).
**Author:** Manager session (Claude), surveyed all five repos + the pigafetta graph substrate on 2026-06-12.
**Status doc location:** `docs/plans/2026-06-12-os-roadmap.md` in ArchonVII/archon-setup (tracked in-repo copy promoted by ArchonVII/archon-setup#230).

---

## 1. The organizing insight

The visual graph the owner wants is a **rendering of the OS, not the OS itself**. The graph can only show "genuine pathing" if the processes are described in machine-readable data rather than prose. Today:

- **archon-setup** is already machine-readable (feature registry with `requires`/`conflictsWith`/`creates`/`tasks`; ecosystem repo registry + maintenance contract merged 2026-06-12 in PRs [#222](https://github.com/ArchonVII/archon-setup/pull/222) and [#228](https://github.com/ArchonVII/archon-setup/pull/228)).
- **repo-template**'s process is ~20–25% machine-readable (`.agent/startup-baseline.json`, `.agent/check-map.yml`, npm lifecycle scripts) and ~60–65% prose-only (issue→branch→worktree→PR lifecycle, coordination model, close/ship gates live in AGENTS.md text).
- **github-workflows** has 20 reusable workflows but no manifest — discovery is README table + reading YAML.
- **jma-skill-review** has a curated catalog (`C:\Users\josep\skills\docs\skill-catalog.md`, 57 live skills + 3 shared agents) but it is hand-maintained markdown; no published manifest; no backlink from the OS repos.

The **pigafetta graph substrate is portable by design** (`C:\PythonProjects\pigafetta\src\ui\graph\` — React Flow + dagre, domain-free; consumers supply a `buildXxxGraph()` data builder + node renderers). The archon-setup React shell (epic #212 lane 4, issue [#217](https://github.com/ArchonVII/archon-setup/issues/217)) is the natural host. So the path to the graph is: **manifests first, RPC second, graph tab third** — and most of the middle is already planned in epic [#212](https://github.com/ArchonVII/archon-setup/issues/212).

---

## 2. Current state scorecard (2026-06-12)

| Repo | Health | One-line state |
|---|---|---|
| github-workflows | Strong | 20 workflows, governance baseline installed 2026-06-11, 122/122 tests; no machine-readable workflow manifest; 10 open issues, 2 open PRs |
| archon-setup | Strong, mid-rollout | Registry + maintenance engine shipped (lanes 0–2 of #212); lanes 3–9 queued; doc-policy spec PR #224 held for owner; ecosystem-status.md 2 days stale |
| repo-template | Solid core, wiring gaps | Lifecycle scripts + hooks + doc-sweep mature; anomaly-triage caller NOT installed, path mismatch `.archon/` vs `.agent/`, doc-orphan backstop not wired, close-scan missing (#28 stale) |
| .github | Healthy, small backlog | Templates/policy current; profile refresh in flight (#28/PR #29); STARTER.md charter columns pending (#27, doc-policy lane 1a) |
| jma-skill-review | Curated, isolated | Catalog/router in sync after consolidation (55–57 live skills); audit script not CI-gated; not discoverable from the other OS repos; 3 open PRs |

---

## 3. Gap analysis, ranked by impact on the owner's goals

### Gap 1 — No friction telemetry ("development hooks") — HIGHEST VALUE, CHEAPEST START
Agent hiccups (linter reruns, missing skill dirs, bash path quirks, template confusion) are exactly what eats context, and today they land in scattered manual channels: `.claude/noticed.md` (free-form), `.archon/anomalies-thispr.md` (PR-scoped, bug-flavored), `ai-discovered`-labeled issues. Nothing aggregates them; nothing ranks recurring friction; nothing feeds priorities.

### Gap 2 — Process layer is prose, so no graph can be honest
The lifecycle, gates, owner-lane safe paths, and coordination rules are AGENTS.md prose plus bash-hardcoded lists. github-workflows has no manifest. Skills have no published manifest. Until these are data, a workflow graph would be a hand-drawn picture that drifts — the exact thing the owner doesn't want.

### Gap 3 — Known wiring defects (dependability)
All already flagged in `noticed.md` files or stale issues, none scheduled:
1. Anomaly path mismatch: repo-template AGENTS.md says `.archon/anomalies-thispr.md`; everything else in template uses `.agent/` (`C:\GitHub\repo-template\.claude\noticed.md` [config] entry).
2. `anomaly-triage.yml` caller not installed in repo-template — agents write anomalies that strand on branches.
3. `doc-orphan-detector.yml` cron backstop not wired into repo-template.
4. Close-scan local guard referenced in AGENTS.md but never shipped ([repo-template#28](https://github.com/ArchonVII/repo-template/issues/28), stale since 2026-05-31).
5. Hardcoded `main`/`master` in pre-commit owner-lane gate (ignores `checkout_default_branch()`).
6. Dangling `docs/phase2/` references in hooks; capability catalog planned but missing.
7. Snapshot hygiene: stray untracked `C:\GitHub\github-workflows\.claude\skills\` pollutes archon-setup snapshot refresh; stale snapshot SHAs (archon-setup `noticed.md`).

### Gap 4 — Orientation is 4-doc cross-referencing, not 1-minute
archon-setup has no single "where are we" map (HANDOFF.md + epic checklist + ecosystem-status.md [stale 2026-06-10] + spec PRs); no glossary (seed/overlay, fastStatus, basis, lanes); skills repo invisible from the ecosystem-overview repo map.

### Gap 5 — Owner decision queue is silently gating three workstreams
See §6. Held items block the document-policy epic (8 lanes), the @v1 retag, and several small merges.

---

## 4. Roadmap — staged capability goals

> Stage order: friction data (Stage 1) informs what to encode first (Stage 2); the graph (Stage 3) rides epic #212 lanes already queued. Stage 0 runs immediately and in parallel.

### Stage 0 — Stabilize & Decide (now → ~1 week)
**Capability goal:** *Every known defect is fixed or has a scheduled issue; no silent owner-gates; status docs current.*

- Clear the owner decision queue (§6).
- File + fix the Gap 3 wiring defects in repo-template (anomaly path, install anomaly-triage + doc-orphan callers, revive close-scan #28, default-branch fix in pre-commit).
- Refresh `C:\GitHub\archon-setup\docs\ecosystem-status.md`; create `CURRENT_WORK.md` convention (lane map + held PRs + decision gates, updated on every lane merge).
- Add jma-skill-review to the archon-setup ecosystem repo map / overview so skills are discoverable from the OS.
- Exit test: a fresh agent in any of the five repos reaches "what is this repo, what's in flight, what do I read next" in under one minute, verifiable via `page-gm`.

### Stage 1 — Friction telemetry, the "development hooks" (parallel with Stage 0; collect for 2+ weeks)
**Capability goal:** *The OS is aware of its own friction: every hiccup lands in one structured stream at near-zero ceremony, and a weekly ranked digest drives priorities.*

- Define a one-line friction entry contract (suggested: `.claude/friction.md` append-log ledger, columns: date | repo | category (tooling/docs/skill/hook/CI/env) | what happened | cost (rerun/blocked/context-burn) | suggested fix). The owner-maintenance append-log lane already exempts such ledgers from PR ceremony — same mechanism as `noticed.md`.
- Roll out via repo-template + archon-ecosystem-sync; AGENTS.md managed block gets one instruction: "log friction, don't fix, keep working."
- Aggregate: archon-setup already has an events collector (`src/server/ecosystem/collectEvents.mjs` → `.archon/events.jsonl`); add a friction collector and surface counts in the maintenance status / future dashboard.
- Ritual: weekly `page-gm` pass over the aggregate; recurring items become issues; durable fixes follow the existing global-vs-repo-local repair routing.
- Exit test: after two weeks there is a ranked top-10 recurring-friction list, and at least the top 3 have filed fixes.

### Stage 2 — Machine-readable process layer (the graph's data contract)
**Capability goal:** *The OS can describe itself: workflows, lifecycle, policies, and skills all exist as queryable data that CI keeps honest.*

- **github-workflows:** generate a `workflows-manifest.json` from the 20 workflow YAML `inputs:` blocks (name, purpose, inputs, example caller, version) with a CI check that it stays in sync. (Existing issues [#65 README refresh](https://github.com/ArchonVII/github-workflows/issues/65) and the doc-policy lanes [#69/#70](https://github.com/ArchonVII/github-workflows/issues/70) are adjacent.)
- **repo-template:** extract the prose process into `docs/process/*.yml` — lifecycle states (issue→branch→worktree→PR→review→merge→prune), gates per transition, owner-lane safe-path list exported from bash to JSON; ship the missing capability catalog.
- **jma-skill-review:** auto-generate the catalog from `shared/*/SKILL.md` frontmatter; publish a `skills-manifest.json`; promote `tools/audit-skill-paths.ps1` to a CI gate (already follow-up candidate #1 in `C:\Users\josep\skills\docs\project-status.md`).
- **archon-setup:** lane 3 ([#216](https://github.com/ArchonVII/archon-setup/issues/216)) RPC + `repo.audit` becomes the single query surface over all of the above.
- Exit test: one RPC call (or one JSON read per repo) returns everything a graph needs: nodes (templates, hooks, workflows, skills, policies), edges (requires/triggers/gates), and metadata (why it exists, limits).

### Stage 3 — See it: dashboard + process-graph view
**Capability goal:** *The owner opens the archon-setup UI and sees the real, current workflow — entry points, template cards with previews, hook cards, branch points, policy limits — pulled live from Stage 2 data.*

- Ship epic #212 lanes 3→4→5 as already planned (RPC, React shell, dashboard tab v1).
- **New lane (propose as #212 follow-on): "Process Graph" tab** — port the pigafetta substrate pattern (`GraphCanvas` + `layoutGraph()` + namespaced position persistence are domain-free); write `buildProcessGraph(manifests)`; node cards = template/hook/workflow/skill/policy with click-to-expand preview (the substrate already supports inline preview panes and hover path-highlighting). Read-only first.
- Friction overlay from Stage 1 data: counts per node — this is what makes "wait, we lint 5 times per PR?" visible.
- Exit test: a non-developer can trace "new feature" from entry point to merge on screen and spot a redundant step.

### Stage 4 — Touch it: edit-in-place + policy registry
**Capability goal:** *Click a template card, edit the question, save — and the next agent uses the updated template. Policies ("max N playwright pulls") are first-class data shown on the graph and injected into AGENTS.md managed blocks.*

- Edit flow routes through the existing owner-gated PR lane (registry CRUD RPC from lane 3 is the precedent; distribution lane 8 [#219](https://github.com/ArchonVII/archon-setup/issues/219) is the propagation mechanism).
- Policy registry: small structured file per policy (statement, why, scope, limit value, source) rendered as graph cards and compiled into managed AGENTS.md blocks by the existing distributor.
- Exit test: owner edits the agent report-back template in the UI; the change lands via the gated lane; the next session's agent uses it.

### Continuous threads (run through all stages)
- **Document-policy epic [#223](https://github.com/ArchonVII/archon-setup/issues/223)** (charters, VISION.md, doc-health) — clarity backbone; unblocks when spec PR #224 is reviewed.
- **E2E ecosystem epic [#154](https://github.com/ArchonVII/archon-setup/issues/154)** milestones.
- **Model-evolution resilience principle:** every contract lives in data + repo docs (AGENTS.md, manifests, registries) — never in one CLI's feature set. Skills/personas stay tool-agnostic (shared source + junctions; reusable workflows + AGENTS.md contract, not personal CLI skills).

---

## 5. What the OS is "aware of" at each stage (owner's capability ladder)

| After | The OS can manage / be aware of |
|---|---|
| Stage 0 | Its own current state: fresh status docs, no orphaned defects, every gate visible |
| Stage 1 | Its own friction: structured hiccup stream, ranked recurring issues, weekly digest |
| Stage 2 | Its own shape: every workflow, gate, policy, skill queryable as data, CI-verified |
| Stage 3 | Showing itself: live visual graph of genuine pathing, friction overlaid |
| Stage 4 | Being steered: owner edits processes/policies through the UI, propagation handled |

---

## 6. Owner decision queue (everything currently waiting on you)

1. **[archon-setup PR #224](https://github.com/ArchonVII/archon-setup/pull/224)** — document-policy spec (draft, held). Gates 8 lanes across 5 repos (epic #223). *Highest leverage review.*
2. **@v1 retag** for github-workflows — held for owner go since the PR-template drift-guard rollout (v1 currently `b27979b3`, main at `c1ad03e`+). Consumers don't get recent fixes until retag.
3. **[github-workflows PR #66](https://github.com/ArchonVII/github-workflows/pull/66)** (README refresh) and **[PR #68](https://github.com/ArchonVII/github-workflows/pull/68)** (Dependabot actions bump ×13) — both open, reviewable.
4. **[.github PR #29](https://github.com/ArchonVII/.github/pull/29)** — public profile refresh (draft, awaiting feedback).
5. **jma-skill-review PRs [#180](https://github.com/ArchonVII/jma-skill-review/pull/180) (description lint gate), [#183](https://github.com/ArchonVII/jma-skill-review/pull/183), [#184](https://github.com/ArchonVII/jma-skill-review/pull/184)** — open Codex lanes.
6. **This roadmap** — approve staging/ordering; decide where it lives permanently (recommended: archon-setup `docs/` + tracked as an epic with one issue per stage).

---

## 7. Source survey evidence (file pointers)

- github-workflows survey: `C:\GitHub\github-workflows\AGENTS.md`, `README.md`, `HANDOFF.md`, `.agent\check-map.yml`, `.agent\startup-baseline.json`
- archon-setup survey: `C:\GitHub\archon-setup\.claude\HANDOFF.md`, `docs\ecosystem-overview.md` (merged PR #148, 2026-06-09), `docs\MAINTENANCE.md`, `docs\ecosystem-status.md` (stale), `src\server\ecosystem\repoRegistry.json`, `src\registry\features.json`
- repo-template survey: `C:\GitHub\repo-template\AGENTS.md`, `.claude\noticed.md` (5 flagged defects), `docs\agent-process\doc-sweep.md`, `docs\repo-update-log.md`
- .github survey: `C:\GitHub\.github\STARTER.md`, `profile\README.md`, `.github\ISSUE_TEMPLATE\*.yml`, `.github\PULL_REQUEST_TEMPLATE.md`
- skills survey: `C:\Users\josep\skills\docs\skill-catalog.md`, `shared\skill-router\SKILL.md`, `docs\skill-root-config.json`, `tools\audit-skill-paths.ps1`, `.hub\` (local Skills Hub workbench)
- graph substrate reference: `C:\PythonProjects\pigafetta\src\ui\graph\GraphCanvas.tsx` (React Flow + dagre, domain-free; consumers at `src\planetLab\`, `src\ui\elementWorkbench\`)
