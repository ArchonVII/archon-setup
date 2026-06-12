# Ecosystem Maintenance Contract

What "keeping a repo up to date" means, per role, for every repository in the
active registry. [`docs/ecosystem-overview.md`](./ecosystem-overview.md) is the
**map** (what exists and how it connects); this document is the **contract**
(what maintained means and how status is judged).

- **Registry of record:** the tracked seed
  [`src/server/ecosystem/repoRegistry.json`](../src/server/ecosystem/repoRegistry.json)
  plus the user overlay `~/.archon/repo-registry.json` (override the home with
  `ARCHON_HOME`). All add/update/lifecycle/remove edits go to the **overlay**
  via [`src/server/ecosystem/registryStore.mjs`](../src/server/ecosystem/registryStore.mjs);
  the seed changes only by PR. Removal is a `lifecycle: "removed"` tombstone —
  history is kept; hard delete is only legal for overlay-only additions.
  Meta-layer repos (the ids in
  [`config/ecosystem-map.json`](../config/ecosystem-map.json)) cannot be
  removed, and their `owner`/`repo`/`role` are locked.
- **Registry = configuration.** Live status (audit results, drift, dirtiness)
  is computed at render time and cached under `~/.archon/state/` — it is never
  stored in the registry.

Spec: [`docs/superpowers/specs/2026-06-12-ecosystem-registry-and-maintenance-design.md`](./superpowers/specs/2026-06-12-ecosystem-registry-and-maintenance-design.md)
(epic [archon-setup #212](https://github.com/ArchonVII/archon-setup/issues/212)).

## Duties by role

| Role | Repos (today) | Maintenance duties |
| --- | --- | --- |
| **provider** | `repo-template`, `github-workflows`, `.github` | Keep the default branch clean and releasable. `github-workflows` moves the public `@v1` tag **only** via the leased v1-retag pattern after an owner go. After any provider change, queue the snapshot impact in the Ecosystem Fix Queue ([`docs/ecosystem-status.md`](./ecosystem-status.md)) — batch refreshes; no ad-hoc `refresh-snapshots` per small change. |
| **integrator** | `archon-setup` | Run `refresh-snapshots` batches when the fix queue warrants. Keep `snapshots:verify` green. Root baseline must equal the repo-template snapshot byte-for-byte (`npm run agent:self-apply`; audited by `test/agentLifecycleScripts.test.mjs`). Keep the registry truthful: lifecycle states, paths, and port reservations current. |
| **application** | `archon`, `pigafetta`, `jma-history`, `hudson-bend` (+ overlay additions) | Stay `manifest_current` (`.github/archon-setup.json` matches the current baseline). Accept distributions — a repo that is perpetually skipped is not maintained. Keep `.archon/events.jsonl` flowing. Keep the **primary checkout clean and on the default branch**; feature work happens in worktrees. |
| **skill-source** | `jma-skill-review` (checkout `C:\Users\josep\skills`) | Keep `docs/skill-catalog.md` current with `shared/`. Keep the checkout clean; skill edits land via worktree + PR, never as drive-by dirty state. |

## Maintenance status (green / yellow / red)

Computed per repo by the maintenance engine (lane 2,
[archon-setup #215](https://github.com/ArchonVII/archon-setup/issues/215));
worst reason wins, and every status carries its reason codes. The rules:

**All roles**

- RED `repo-unavailable` — registered path missing or not a git worktree.
- YELLOW `dirty-worktree` — primary checkout has uncommitted changes.

**application** (cheap "fast" basis)

- RED `not-onboarded` — no `.github/archon-setup.json` while `healthTarget: true`.
- YELLOW `manifest-outdated`, `workflow-drift`, `needs-audit`, or
  `events-stale` (no event in **14 days** — chosen as roughly two idle weeks
  before a repo counts as drifting out of maintenance; spec §4.2).
- GREEN (fast) — manifest current, no drift, clean. Always rendered as
  **"Manifest current · run audit to verify"**, never a bare "Current"
  (honesty rule, `docs/FRONTEND_REDESIGN_SPEC.md` §5).
- With a fresh deep-audit cache the basis becomes `audited`:
  verified current → GREEN "Verified current"; drifted/missing → YELLOW;
  blocked/needs-review → RED.

**provider**

- GREEN — snapshot pin (`src/snapshots/manifest.json`) equals the provider's
  local default-branch HEAD, and clean.
- YELLOW `snapshot-behind` — provider HEAD ahead of the pin (refresh pending);
  `github-workflows` also `v1-retag-pending` (local `v1` tag != HEAD).
- RED `snapshot-integrity` — the pinned SHA is unreachable in provider history.

**integrator**

- GREEN — snapshot pins verify and the fix queue is empty.
- YELLOW `fix-queue-pending` or `snapshot-behind`.
- RED — snapshot integrity failure.

**skill-source**

- GREEN — available, clean, catalog present. YELLOW `catalog-missing` or
  dirty. RED — unavailable.

## Dev-port policy

Policy module: [`src/server/ecosystem/portPolicy.mjs`](../src/server/ecosystem/portPolicy.mjs);
enforced on every registry write.

- **5173 is forbidden.** It is Vite's default and the cross-repo collision
  magnet (owner instruction, `C:\GitHub\user-plan.md`).
- Standard dev range: **5170–5999**. Outside the range is a warning (allowed
  for non-web tooling), inside-but-taken is an error.
- Reservations are explicit port lists per registry entry (`reservedPorts`),
  optionally with `devServer { kind, primaryPort, command }` where
  `primaryPort` must be one of the reserved ports.
- Before starting any dev server, agents use the repo's reserved ports; a repo
  with no reservation gets one added via the registry (Dashboard, lane 5)
  first — never an ad-hoc port.

### Current seed assignments (2026-06-12)

2-port blocks per active dev-server-running repo. Machine-level tools observed
live on this machine (skills hub on 5174/7878, vision-gateway on 8765 — see
`~/.claude/port-registry.json`) are deliberately outside the reserved blocks.

| Repo | Reserved | Notes |
| --- | --- | --- |
| `archon-setup` | 5180–5181 | 5180 = future `ui:dev` (lane 4) |
| `archon` | 5182–5183 | Electron/Vite dev |
| `pigafetta` | 5184–5185 | |
| `jma-history` | 5186–5187 | |
| `hudson-bend` | 5188–5189 | |
| providers / skill-source | — | no dev servers; reserve via overlay if that changes |

## Cadence

- **On every ecosystem-wide rollout:** follow the 4-step playbook in
  [`docs/ecosystem-status.md`](./ecosystem-status.md), including its status
  update (step 4).
- **Weekly-ish (or at session start):** glance at the dashboard / ecosystem
  snapshot; clear YELLOWs that are one command away (`refresh-snapshots`
  batch, distribution acceptance, stale dirty checkouts).
- **Before npm publish:** the shakedown matrix
  (`docs/testing/shakedown/PHASE2-RUNBOOK.md`) gates the cut — registry health
  is not a substitute.
