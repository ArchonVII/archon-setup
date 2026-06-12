# Ecosystem registry, maintenance contract & dashboard — design spec

- **Date:** 2026-06-12
- **Author:** Claude (Fable 5), via owner planning session (decisions recorded below).
- **Status:** DRAFT — for owner review. This doc is the review gate before the lanes implement it.
- **Tracking issue:** [archon-setup #212](https://github.com/ArchonVII/archon-setup/issues/212) (epic; one sub-issue per lane).
- **Branch / worktree:** `agent/claude/212-ecosystem-registry-spec` at `C:\GitHub\archon-setup-212-ecosystem-registry-spec`.
- **Builds on:** `docs/FRONTEND_REDESIGN_SPEC.md` (binding behavioral spec for the UI), `docs/ECOSYSTEM_STATE.md`, `docs/ecosystem-overview.md`, `docs/reviews/2026-06-11-fable-agent-os-v01-rfc.md`.

---

## 1. Problem

The ecosystem has no single user-facing answer to: **which repos are active, what state is each in, and what does maintaining them entail.**

- `src/server/ecosystem/repoRegistry.json` is the canonical active-repo list, but it is hand-edited tracked source — not visible or editable by the owner without a code change.
- "What maintenance entails" per repo is defined nowhere. The signals exist (manifest status, workflow drift, events, governance, snapshot pins) but no doc states the duties and no function rolls them into a per-repo status.
- The wizard UI is a one-repo-at-a-time vanilla-DOM skeleton; the multi-repo Dashboard exists only as a design outline in `docs/FRONTEND_REDESIGN_SPEC.md`.
- Owner OS-wide asks (recorded in `C:\GitHub\user-plan.md`) are unimplemented: dev-port reservations (no 5173), a standard session-open/status-update message format, a `/docs/milestones/` convention, and a "10 Commandments" codification.

## 2. Understanding summary

- **What:** a user-editable repo registry (tracked seed + user overlay), a written + computed maintenance contract, the React shell with the Dashboard tab as its first real surface, and the four OS-wide conventions routed through the normal provider → snapshot → distribution path.
- **Why:** the owner needs to see/select/add/remove repos and know at a glance which repos need attention and what "maintained" means for each.
- **Who:** the ecosystem owner (primary), agents (consume the registry/state read-only), newcomers (unchanged Onboard path).
- **Integration:** everything reuses the existing audit machinery (`src/server/onboard/auditPlan.mjs`, `src/updater/checkWorkflowDrift.mjs`), snapshot assembly (`src/server/ecosystem/snapshot.mjs` + collectors), the contracts layer (`src/contracts/`), and the RPC server. No new runtime dependencies.
- **Non-goals (v1):** bulk audit/bulk apply (FRONTEND_REDESIGN_SPEC §12 defers them), an Archon-terminal fleet view (later consumer of the same RPC), `scripts/agent/port.mjs` helper, auto-discovery of unregistered repos (RFC threat D-13 — accepted residual).

## 3. Owner decisions (2026-06-12)

| # | Decision | Alternatives rejected | Why |
| --- | --- | --- | --- |
| OD1 | UI home = archon-setup browser dashboard | Archon Electron app; both at once | archon-setup owns registry, audit, RPC; the redesign spec already defines this Dashboard; Archon can consume `registry.repos`/`ecosystem.snapshot` later |
| OD2 | Build the React+Vite+Tailwind/shadcn shell now | Extend the vanilla skeleton first | "Addressing our UI" is part of the ask; the skeleton was always a placeholder; vanilla retires only after parity (lane 9) |
| OD3 | All four OS-wide items in scope | Defer some | Owner selected all |
| OD4 | Issue-first rollout: spec → lane issues → lane 1 first | Big-bang implementation | Repo contract; PR-sized lanes |

## 4. Design

### 4.1 Registry: tracked seed + user overlay

- The tracked seed stays at `src/server/ecosystem/repoRegistry.json` — it guarantees the meta-layer repos exist in any checkout/npx install and stays code-reviewed.
- All UI/CRUD writes go to a **user overlay** at `~/.archon/repo-registry.json` (override root via `ARCHON_HOME` for tests). The UI never dirties the archon-setup working tree.
- New module `src/server/ecosystem/registryStore.mjs`:
  - `loadEffectiveRegistry({ seedPath, overlayPath })` — index by `id`; an overlay entry with a seed `id` **replaces the seed entry wholesale** (no deep merge — auditable); overlay-only entries are additions; every normalized entry is stamped `origin: "seed" | "overlay"`.
  - `lifecycle: "removed"` entries are **tombstones**: kept for history, excluded from active sets and health targets. Hard delete is permitted only for `origin: "overlay"` entries.
  - `writeOverlay(entries)` — atomic via the existing tmp-then-rename in `src/server/ecosystem/writeAtomic.mjs`.
  - Existing consumers (`collectRepos.mjs`, `snapshot.mjs`, `bin/ecosystem-snapshot.mjs`) switch their default source to `loadEffectiveRegistry()`; an explicit `--repo-registry <file>` continues to mean "this file only, no overlay".
- **Meta-layer guard:** ids present in `config/ecosystem-map.json` cannot be removed (soft or hard) and have `owner`/`repo`/`role` locked; `path`/`reservedPorts`/`devServer`/`notes` stay editable via overlay. New sync-gate test `test/registryMapConsistency.test.mjs` asserts every map repo exists in the seed with matching `owner`/`repo`/`localPath`↔`path`/`role` (normalize `\r?\n` and path separators; CI is LF, local is CRLF).
- **Registry = configuration, never live state.** No `lastAuditAt` in the registry. Deep-audit results cache to `~/.archon/state/audit-cache.json` (keyed by repo id: `{ ts, verifiedStatus, counts }`), written by the `repo.audit` RPC (lane 3) and joined at render time.

New contract schema `src/contracts/schemas/repo-registry.schema.json` following the existing pattern (`schemaVersion: 1`, `additionalProperties: false`, fail-closed `src/contracts/validate.mjs`, enums pinned in `src/contracts/vocab.mjs`, golden valid+invalid fixtures under `test/fixtures/contracts/repo-registry/`). Entry shape:

```jsonc
{
  "id": "pigafetta",
  "name": "pigafetta",
  "owner": "ArchonVII",
  "repo": "pigafetta",
  "path": "C:/PythonProjects/pigafetta",
  "lifecycle": "active",            // enum: active | inactive | removed
  "healthTarget": true,
  "role": "application",            // enum: application | workflow-provider | baseline-provider
                                    //       | org-defaults-provider | ecosystem-health-hub | skill-source
  "reservedPorts": [5190, 5191],    // explicit list, not ranges
  "devServer": { "kind": "vite", "primaryPort": 5190, "command": "npm run dev" },  // optional
  "notes": "free text",             // optional
  "addedAt": "2026-06-12",          // overlay entries
  "updatedAt": "2026-06-12",        // overlay entries
  "reason": "why inactive/removed"  // optional
}
```

### 4.2 Maintenance contract

**Human-readable:** new `docs/MAINTENANCE.md` (own doc; `docs/ecosystem-overview.md` is the map, this is the contract; cross-link both). Per-role duties:

| Role | Duties |
| --- | --- |
| provider (`repo-template`, `github-workflows`, `.github`) | keep default branch clean/releasable; `github-workflows` retags `@v1` only via the leased v1-retag pattern; after any provider change, queue snapshot reconvergence in the Ecosystem Fix Queue (`docs/ecosystem-status.md`) rather than ad-hoc refreshes |
| integrator (`archon-setup`) | run `refresh-snapshots` batches when the fix queue warrants; keep `snapshots:verify` green; root baseline == snapshot byte-for-byte; registry/map hygiene (lifecycle truth, port reservations current) |
| application | stay `manifest_current`; accept distributions (no perpetually-skipped repos); keep `.archon/events.jsonl` flowing; keep the primary checkout clean (work in worktrees) |
| skill-source | catalog hygiene (`docs/skill-catalog.md` current); clean checkout |

Plus: the status rules below, the port policy (§4.5), and cadence guidance.

**Machine-readable (lane 2):** `src/server/ecosystem/maintenanceStatus.mjs`, a pure function:

```
computeMaintenanceStatus({ entry, repoState, fastStatus, workflowDrift, events, governance, snapshotPin, auditCache })
  → { status: "green"|"yellow"|"red", basis: "fast"|"audited", reasons: [{ code, detail }] }
```

and `src/server/ecosystem/manifestStatus.mjs` — `computeFastStatus(repoPath)` reads `.github/archon-setup.json` (written by `src/server/tasks/writeSetupManifest.mjs`) → `not_onboarded | manifest_current | manifest_outdated | unknown_needs_audit` (FRONTEND_REDESIGN_SPEC §5.1).

Inputs → existing functions: `collectOneRepo` (`collectRepos.mjs`) for available/dirty/branch/worktrees/lastCommit; `checkWorkflowDrift.mjs`; `collectEvents.mjs` (+ new per-repo `lastEventAt`); `collectGovernance.mjs`; snapshot pin freshness from `src/snapshots/manifest.json` vs provider local HEAD.

**Status rules** (worst reason wins; every status carries reason codes; thresholds documented in MAINTENANCE.md):

- All roles — RED `repo-unavailable`; YELLOW `dirty-worktree`.
- application (basis `fast`) — RED `not-onboarded` (while `healthTarget`); YELLOW `manifest-outdated` | `workflow-drift` | `needs-audit` | `events-stale` (no event in 14 days); GREEN renders **"Manifest current · run audit to verify" — never bare "Current"** (spec §5 honesty rule). Basis `audited` (fresh cache): verified current → GREEN "Verified current"; drift/missing → YELLOW; blocked/needs_review → RED.
- provider — GREEN pin == provider HEAD and clean; YELLOW `snapshot-behind`, plus `v1-retag-pending` for github-workflows (local `v1` tag != HEAD); RED `snapshot-integrity` (pinned SHA unreachable).
- integrator — GREEN pins verify and fix queue empty; YELLOW `fix-queue-pending` | `snapshot-behind`; RED snapshot integrity failure.
- skill-source — GREEN available + clean + catalog exists; YELLOW `catalog-missing` or dirty; RED unavailable.

Rollup wired into `assembleSnapshot` (`src/server/ecosystem/snapshot.mjs`) as a per-repo `maintenance` field; `docs/ECOSYSTEM_STATE.md` contract updated in the same lane. New schema `src/contracts/schemas/repo-maintenance-status.schema.json`; new vocab enums `FAST_STATUSES`, `MAINTENANCE_STATUSES`, `MAINTENANCE_REASONS`.

### 4.3 React shell (lane 4)

- UI source in new top-level `ui/` (TypeScript; shadcn components under `ui/src/components/ui/`). **devDependencies only** (`react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `typescript`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, Radix primitives as components are added — pinned in the lane PR for deterministic installs). The published package keeps zero runtime deps: the build emits a static bundle.
- `npm run ui:build` → emits `src/ui/dist/`, served token-gated by the existing `node:http` server (`src/server/index.mjs`) with `Content-Security-Policy: default-src 'self'`. The `/?token=` gate and bearer-token RPC contract are unchanged; the React app reads the token from `location.search` at boot exactly as the vanilla app does.
- `npm run ui:dev` → Vite on archon-setup's own reserved port **5180** (dogfoods the port policy; never 5173), proxying `/rpc` to the local server; add a `--port` flag to `startServer` so the proxy target is stable. Dev mode is developer-only (spec N3).
- Packaging: gitignore `src/ui/dist/`; the package.json `files` whitelist includes it in the tarball (files-field wins over .gitignore). Extend `scripts/prepublish-check.mjs` to run `ui:build` and fail if `src/ui/dist/index.html` is absent.
- CI: `node-ci@v1` already exposes a `build-script` input (`github-workflows/.github/workflows/node-ci.yml:38`) — one-line caller change `build-script: ui:build`.
- Legacy vanilla UI (`src/ui/app.mjs`) stays behind `--legacy-ui` until lane 9 reaches parity, then is deleted.

### 4.4 Registry CRUD + audit RPC (lane 3; documented in `docs/RPC_CONTRACT.md`)

- **GET `registry.repos`** — the Dashboard's single fast call: effective entries joined with cheap repo state, `fastStatus`, `maintenance`, port reservations + live-port conflicts, and the audit-cache stamp (= `RepoSummary`, spec §4.1, per registered repo).
- **POST `registry.addRepo`** `{ owner, repo, path, role, reservedPorts?, devServer?, notes? }` — fail-closed validation: path exists and is a git worktree (via `src/server/lib/commandRunner.mjs`); origin remote parsed with `src/server/lib/parseGithubRemote.mjs` must match `owner/repo` (error `origin-mismatch`; explicit `allowOriginMismatch: true` escape hatch); unique id; port policy passes. Writes one overlay entry.
- **POST `registry.updateRepo`** `{ id, patch }` — same validations on touched fields; meta-layer locks apply.
- **POST `registry.setLifecycle`** `{ id, lifecycle: "active"|"inactive", reason? }` — `healthTarget` follows lifecycle unless explicitly overridden.
- **POST `registry.removeRepo`** `{ id, reason?, hard? }` — soft by default (tombstone with `removedAt` + reason); `hard: true` only for overlay-origin entries; meta-layer ids refuse both.
- **POST `repo.audit`** `{ id }` — composes existing `buildPlan` + `auditPlan.mjs` + `checkWorkflowDrift` → AuditResult (spec §4.2), writes `~/.archon/state/audit-cache.json` atomically, returns recomputed maintenance with `basis: "audited"`. **Never writes to the target repo** (the "audits never write" invariant holds; the cache is tool-home state — documented in RPC_CONTRACT).

### 4.5 Port reservations (lane 1 schema/policy; lane 2 surfacing; lane 6 agent instruction)

- Schema: explicit `reservedPorts: number[]` (auditable, conflict-checkable; no range math) + optional `devServer.primaryPort ∈ reservedPorts`.
- New `src/server/ecosystem/portPolicy.mjs`: `FORBIDDEN_PORTS = [5173]` (Vite default — the collision magnet; source: owner instruction in `C:\GitHub\user-plan.md`); standard dev range **5170–5999** (outside-range = warning, for non-web tooling); `validatePortAssignment(ports, registry, { excludeId })` → errors `port-conflict | port-forbidden | port-invalid`, warning `port-out-of-range`.
- Seed assignments (lane 1): a 2-port block per active repo, archon-setup = 5180–5181 first; remaining blocks assigned against live usage in `C:\Users\josep\.claude\port-registry.json` at implementation time (currently 5174/7878/8765 are machine tools — skills hub and vision-gateway — and must not be reserved by repos).
- Surfacing (lane 2): the snapshot ports section gains a join — each live port annotated `reservedBy` (repo id) and `conflict: true` when the live owner ≠ reserving repo or the port is forbidden.
- Agent consumption (lane 6): repo-template AGENTS.md instruction — before starting any dev server, use the repo's reserved ports from the ecosystem state; never 5173; no reservation → ask the owner to add one via the Dashboard. A `scripts/agent/port.mjs` helper is deliberately deferred.

### 4.6 OS-wide items routing (provider PR → `refresh-snapshots` → distribution; never hand-edit `src/snapshots/**`)

| Item | Lands in | Distribution path |
| --- | --- | --- |
| Port schema + validation + snapshot surfacing | archon-setup (hub-local) | none needed |
| Port discipline instruction | repo-template `AGENTS.md` (managed block) | snapshot refresh → distributor `agents` category |
| Session-open/status-update format (repo name, full absolute local path, full issue/PR URLs, server address) | repo-template AGENTS.md "Session reporting" subsection + `templates/agent/agent.progress-update.standard.md` + `agent.handoff.standard.md` | snapshot refresh; templates flow through the onboard/templates pipeline |
| `/docs/milestones/` convention (goals, changes, current state, next steps, review criteria per milestone) | repo-template `docs/milestones/README.md` + Agent Start Map line; archon-setup feature-registry entry (`creates: ["docs/milestones/README.md"]`) + audit coverage | onboard/audit for files; `agents` distribution for the start-map line |
| 10 Commandments | repo-template AGENTS.md, new managed block `agents-ten-commandments`: never work on main; issue/plan first; claim before work; atomic conventional commits with selective staging; draft PR early, ready only via blessed wrapper; verify with evidence before ready; never bypass hooks; standard status-message format; respect port reservations; choose the more specific term | new region in `src/distributor/managed-regions.json` + `managed-sources.json`, distributed via the granular distributor `agents` category |

Fleet-wide distribution (lane 8) runs **only after explicit owner confirmation**, with auditable per-repo results (AGENTS.md global-updates rules).

## 5. Lane decomposition

| Lane | Title | Repo | Deps |
| --- | --- | --- | --- |
| 1 | feat(ecosystem): registry seed+overlay store, repo-registry schema, port policy, docs/MAINTENANCE.md | archon-setup | — |
| 2 | feat(ecosystem): maintenance status engine + fastStatus + snapshot wiring | archon-setup | 1 |
| 3 | feat(rpc): registry CRUD + repo.audit + audit cache | archon-setup | 1, 2 |
| 4 | feat(ui): React+Vite+Tailwind/shadcn shell scaffold | archon-setup | — (parallel with 2–3) |
| 5 | feat(ui): Dashboard tab v1 | archon-setup | 3, 4 |
| 6 | feat(agents): 10 Commandments + session reporting format + port discipline | repo-template | — |
| 7 | feat(milestones): /docs/milestones/ convention | repo-template + archon-setup (linked pair) | — |
| 8 | chore(snapshots): refresh + distributor regions + owner-confirmed distribution run | archon-setup | 6, 7 |
| 9 | feat(ui): port Onboard/Templates/Doctor to React; retire vanilla UI | archon-setup | 4, 5 |

Risks: Windows path normalization in the overlay merge (`C:/` vs `C:\` — normalize on load, as `repoRegistry.mjs` already tolerates); shadcn pulls Radix deps incrementally (pin in lane 4); lane 8 distribution is owner-gated.

## 6. Verification (per lane; recorded in each PR)

- Lane 1: `npm test` green including new registryStore/portPolicy/schema/consistency tests; `node bin/ecosystem-snapshot.mjs` still renders; schema fixtures valid+invalid per the contract pattern.
- Lane 2: status rules unit-tested per role with synthetic inputs; snapshot output validates against the updated ECOSYSTEM_STATE contract.
- Lane 3: CRUD round-trip — add via RPC → overlay written, seed untouched; remove → tombstone; meta-layer locks refuse; `repo.audit` writes cache and never the target.
- Lane 4: `ui:build` output served token-gated; CSP header present; CI build green.
- Lane 5: `npm run ui:dev` end-to-end — badges match `registry.repos`; bare "Current" never rendered from fast basis.
- Lane 8: distribution dry-run diff per repo before owner-confirmed apply; per-repo applied/unchanged/skipped/failed results recorded.
