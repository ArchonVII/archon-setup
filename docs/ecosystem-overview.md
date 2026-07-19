# ArchonVII Ecosystem Overview (for agents)

The high-level "what exists and how it connects" map for the **meta/ecosystem layer**.
Read this before you change anything that another repo depends on — a shared
workflow, an org-default file, the per-repo template, a snapshot, or a global skill.
It situates the repo you are in within the larger picture and tells you **where** to
make a change so it propagates correctly and **does not** clobber something managed.

> The repo-map table below is generated from
> [`config/ecosystem-map.json`](../config/ecosystem-map.json) + the live snapshot
> refs in [`src/snapshots/manifest.json`](../src/snapshots/manifest.json). Do not
> hand-edit it — run `npm run update-ecosystem-overview`.

This doc is the **map**. The companion **contract** — what "maintained" means per
role, the green/yellow/red status rules, and the dev-port policy — is
[`docs/MAINTENANCE.md`](./MAINTENANCE.md).

## When to read this

Read (or be pointed at) this doc before modifying:

- a **global / shared skill** or persona,
- a **reusable workflow** or its caller,
- an **org-default** GitHub file (issue/PR templates, SECURITY, release.yml),
- the **per-repo template** (`AGENTS.md`, `.agent/`, agent scripts),
- **archon-setup snapshots** or onboarding behavior.

If you are working inside an ordinary application/consumer repo on app code, you do
**not** need this — start from that repo's local `AGENTS.md` and its documented
dependencies only. This map is intentionally a meta-layer concern (see
[Why consumer repos don't link here](#why-consumer-repos-dont-link-here)).

## Scope

This document covers only the five meta-layer repos. It deliberately does **not**
enumerate application repos (archon, pigafetta, jma-history, …), because the per-repo
agent contract is coordination-isolated: an agent in a consumer repo must not assume
sibling repos exist.

## Mental model

The meta layer is **providers → integrator → consumers**, with a separate
**skill source** feeding the agent runtimes:

- **Providers** publish source-of-truth that other repos inherit:
  - `.github` → org-default GitHub/community-health files (fallback when a repo has no copy)
  - `github-workflows` → reusable workflows, consumed by callers at the moving `@v1` tag
  - `repo-template` → the canonical per-repo scaffold and `AGENTS.md` contract
- **Integrator** — `archon-setup` snapshots the three providers under
  `src/snapshots/` (SHA-pinned), audits/onboards repos, and is the only repo that
  legitimately references all the others.
- **Skill source** — `jma-skill-review` (checked out at `C:\Users\josep\skills`)
  owns shared skills + personas under `shared/`, exposed to Claude/Codex/Gemini via
  per-CLI **junction aliases**. Runtime loading comes from the active session
  registry, not a path assumption.

### Repo map

<!-- BEGIN GENERATED: ecosystem-map -->
| Repo | Local checkout | Role | Owns (source of truth) | Snapshot / version |
| --- | --- | --- | --- | --- |
| [ArchonVII/.github](https://github.com/ArchonVII/.github) | `C:/GitHub/.github` | org-defaults-provider | issue templates; pull request templates; SECURITY.md; release.yml; STARTER.md doc-policy guide | snapshot main@fe48c2f |
| [ArchonVII/github-workflows](https://github.com/ArchonVII/github-workflows) | `C:/GitHub/github-workflows` | workflow-provider | reusable workflow bodies (examples/*.yml); scripts/setup-repo.mjs (labels + branch protection) | consumed @v1; snapshot v1@f34893a |
| [ArchonVII/repo-template](https://github.com/ArchonVII/repo-template) | `C:/GitHub/repo-template` | baseline-provider | AGENTS.md (canonical per-repo contract); .agent/ startup + check-map baseline; scripts/agent/ lifecycle helpers; scripts/doc-sweep/ | snapshot main@318fb1c |
| [ArchonVII/archon-setup](https://github.com/ArchonVII/archon-setup) | `C:/GitHub/archon-setup` | ecosystem-health-hub | src/snapshots/ (SHA-pinned provider snapshots); src/registry/features.json (feature registry); src/server/globalUpdates.mjs (distributable AGENTS.md fixes); ecosystem-state.json health surface; config/ecosystem-map.json + docs/ecosystem-overview.md (this map) | not snapshotted (integrator/source) |
| [ArchonVII/jma-skill-review](https://github.com/ArchonVII/jma-skill-review) | `C:/Users/josep/skills` | skill-source | shared/ (active shared skills); shared/agents/ (cross-tool personas, e.g. gamemaster); docs/skills-policy.md (canonical skills policy); docs/skill-catalog.md (skills index); shared/skill-router/ (skill selection router) | not snapshotted (integrator/source) |

_Provider snapshots captured 2026-07-17T05:08:36.637Z … 2026-07-19T16:56:27.859Z (source: `src/snapshots/manifest.json`)._
<!-- END GENERATED: ecosystem-map -->

## Change routing — "to change X, edit Y first"

| You want to change… | Edit here (source of truth) | Then |
| --- | --- | --- |
| Global/shared skill or persona behavior | `C:\Users\josep\skills\shared\<skill>` (repair target) — resolve the active path first per `docs/skills-policy.md` | Update `docs/skill-catalog.md`; PR via `ArchonVII/jma-skill-review` |
| Skill inventory / selection | `C:\Users\josep\skills\docs\skill-catalog.md`; `C:\Users\josep\skills\shared\skill-router\` | Keep the catalog and router aligned; PR via `ArchonVII/jma-skill-review` |
| Skill loading / repair / duplicate policy | `C:\Users\josep\skills\docs\skills-policy.md` | — |
| Per-repo `AGENTS.md` contract | `C:\GitHub\repo-template\AGENTS.md` | Re-run `npm run refresh-snapshots` in archon-setup |
| A reusable workflow body | `C:\GitHub\github-workflows\examples\*.yml` | Deliberate `@v1` retag, then refresh snapshot |
| Org-default issue/PR/security docs | `C:\GitHub\.github` | Refresh `orgDefaults` snapshot |
| Snapshot/onboarding behavior | `C:\GitHub\archon-setup` | — |

For repair-target routing during an incident, page-gm uses
[`skills-policy.md`](https://github.com/ArchonVII/jma-skill-review/blob/main/docs/skills-policy.md) and its own
`references/routing.md`; this table is the constructive counterpart.

## Managed-content rules (don't clobber, don't lose)

1. **Never edit a snapshot or a generated/managed block as the source of truth.**
   `src/snapshots/**` is a copy of a provider; a `<!-- BEGIN MANAGED … -->` or
   `<!-- BEGIN GENERATED … -->` block is rendered from elsewhere. Editing the copy
   is silently overwritten on the next refresh/regen. **Fix the provider, then
   propagate.**
2. **Update the provider first, then refresh.** Workflow bodies live in
   `github-workflows`; `AGENTS.md` lives in `repo-template`; org defaults live in
   `.github`. `scripts/refresh-snapshots.mjs` is the *only* path that pulls them in.
3. **`@v1` is a deliberately-moved major tag.** Don't retag casually — use the
   leased v1-retag pattern after an explicit owner go, then re-pin the snapshot.
4. **Skill roots are junctions, not copies.** `~/.claude/skills`, `~/.codex/skills`,
   `~/.gemini/skills` may alias `shared/`. Verify with `Get-Item` before writing;
   never replace a junction with a copied directory, and never infer a skill's active
   `SKILL.md` from its name (see `skills-policy.md`).
5. **Don't widen distribution by inference.** A meta-layer change is not automatically
   pushed to every repo. archon-setup's global update catalog
   (`src/server/globalUpdates.mjs`) distributes only explicit, owner-confirmed
   `AGENTS.md` blocks, with per-repo applied/skipped/failed results.
6. **Respect coordination-isolation.** Do not teach a consumer repo to assume siblings
   exist.
7. **`.archon/` tracking policy.** `.archon/region-ownership.json` is durable
   evidence (keep-local decisions are unreconstructable from anywhere else) and
   **must be committed** in consumer repos — the PR lane stages it alongside the
   managed files it records decisions about. Local event/cache files under
   `.archon/` (e.g. `events.jsonl`) are per-machine and **may be gitignored**;
   never gitignore the directory wholesale.

## Skill quick-start (designing a new global skill)

To add or change a global skill, read, in order:

1. this overview (where the skill source sits in the ecosystem),
2. [`skills-policy.md`](https://github.com/ArchonVII/jma-skill-review/blob/main/docs/skills-policy.md) — loading,
   junctions, repair routing, duplicates, promotion/retirement,
3. `docs/skill-catalog.md` — the existing index (avoid duplicating a skill),
4. the `writing-skills` skill — authoring conventions,
5. an adjacent existing skill under `shared/` as a structural template.

Author in `C:\Users\josep\skills\shared\<name>\SKILL.md`, update the catalog, PR
through `ArchonVII/jma-skill-review`. **Do not** put a global skill in
`repo-template` — that would snapshot a personal capability into every repo.
Ecosystem-wide *agent behaviors* ship as a reusable workflow plus an `AGENTS.md`
contract, never as a per-repo skill copy.

## Why consumer repos don't link here

This overview is owned by `archon-setup` and linked only from meta-repos and tools
that legitimately operate across ecosystem boundaries (jma-skill-review, page-gm
routing, `.github`, `github-workflows`). It is **intentionally not** linked from
`repo-template/AGENTS.md`, because that file snapshots into consumer repositories and
must preserve the rule that an agent working in a consumer repo does not assume
sibling repositories exist. Agents working on global skills, shared workflows,
org-default files, snapshots, onboarding, or page-gm repair routing may be explicitly
pointed here; agents inside ordinary repos start from that repo's local `AGENTS.md`.

## Freshness

- The repo-map block is generated. After editing `config/ecosystem-map.json` or
  refreshing snapshots, run `npm run update-ecosystem-overview`.
- `node scripts/update-ecosystem-overview.mjs --check` fails if the committed block is
  stale; `test/ecosystemOverview.test.mjs` enforces this on every `npm test`.
- Prose sections are human-maintained and explain concepts; the generated block holds
  volatile inventory (paths, roles, snapshot refs).
