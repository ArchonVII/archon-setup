# Distribution & lifecycle rollout — design spec

- **Date:** 2026-06-01
- **Author:** Claude (Opus 4.8), via parallel blueprint workflow `wf_902cd8a4-e8a` (7 code-architect agents + synthesis).
- **Status:** DRAFT — for owner review. No code written yet. This doc is the review gate before implementation.
- **Scope source:** archon-setup issues #64 and #43, plus the ROADMAP "In Progress / Planned / Deferred" backlog (npm publication, workflow drift, `.archon/events.jsonl`/status-board, Copilot/secrets, packaged distribution, Windows installer). Owner selected **"everything on the list"** with a **no-remote smoke-test** policy for #43.

> **Honesty flags up front.** Three items cannot be _completed_ by an agent — they need owner credentials/decisions: (1) deleting the 5 leaked repos needs an interactive `gh auth refresh -s delete_repo`; (2) `npm publish` needs your npm token + 2FA; (3) real secret values for Copilot/secrets. Everything else is fully codeable and testable. The three are designed as **prep + a clean handoff**.

---

## 1. Lanes overview

| Lane  | Issue / roadmap item                                   | Status                           | Size |
| ----- | ------------------------------------------------------ | -------------------------------- | ---- |
| **A** | #64 agent-lifecycle install/update/audit baseline      | ✅ codeable (gated by #49/#59)   | S–M  |
| **B** | #43 no-remote smoke-test policy + leaked-repo guard    | ✅ codeable                      | S    |
| **C** | Workflow drift detection + upgrade                     | ✅ codeable                      | M    |
| **D** | `.archon/events.jsonl` conventions + status-board view | ✅ codeable                      | S    |
| **E** | Packaged distribution / npm publication **prep**       | ⚠️ prep; publish is owner-gated  | S    |
| **F** | Copilot / secret setup — **staged disabled** for v0.4  | ⚠️ staged; values owner-gated    | S    |
| **G** | Windows installer — **thin `npx` bootstrap** slice     | ⚠️ depends on E; native deferred | S    |

---

## 2. Recommended build order (minimize rebase churn)

`B → E → G → C → D → F → A`

Rationale (from synthesis):

1. **B** is the keystone _safety_ lane — it builds the `commandRunner` binary-injection seam that A's remote-task tests and any future hermetic remote test reuse, and it eliminates the leaked-repo failure mode. Touches **no** shared structural files.
2. **E** establishes the published-package baseline (version bump, `files[]`, `prepublishOnly`). **G** depends on E (the `npx` bootstrap is inert until the package is published), so E before G.
3. **C** is a self-contained updater-layer change (no shared structural files).
4. **D** is additive (new lib + collector + emitter call-sites); merging it before A puts the `executePlan.mjs` import block into its final shape.
5. **F** adds two _disabled_ features + two `auditPlan.mjs` switch cases; least-invasive auditPlan change.
6. **A last** because it has the most cross-cutting coupling: it rebases `auditPlan.mjs` onto #49's output, appends `copyFiles[]` onto #59's output, adds to the `executePlan.mjs` TASKS map after D and F, and requires a snapshot-refresh run that advances the `repoTemplate` SHA to ≥ `4cbb599`.

> **DECISION 1 (order vs. headline):** This order defers your _primary_ ask (#64) to the end. Alternative is **headline-first** (A first). A's collisions with #49/#59 are _additive_ and low-risk, so A could go first and let #49/#59 rebase onto it — but that pushes rebase work onto the agents holding those worktrees. See §6.

---

## 3. Per-lane design

### Lane A — #64 agent-lifecycle baseline ✅ (gated by #49/#59)

**Goal:** archon-setup can install / update / audit the repo-template agent-lifecycle baseline (shipped upstream in repo-template PR #33, commit `4cbb599`: `scripts/agent/{lib,start-task,status,prune}.mjs` + 3 `agent:*` package.json scripts + an AGENTS.md subsection).

**Create:**

- `src/server/tasks/writeAgentLifecycle.mjs` — snapshot-backed task: copies the 4 scripts (via `writeSnapshotFile`), then **idempotently merges** the 3 `agent:*` entries into the target `package.json` (creates a minimal `{name, type:"module", scripts:{}}` if absent; merges only the 3 entries if present; re-run ⇒ `already-done`). Exports `AGENT_SCRIPTS` const for the audit path.
- `test/writeAgentLifecycle.test.mjs` — 8 cases: check/apply/verify, package.json absent (creates minimal), present (merges, preserves other keys), entries-present (skips), idempotency (no manifest noise), verify ok/err.

**Modify:**

- `src/registry/features.json` — append `agent-lifecycle.baseline` feature (group `agent-workflow`).
- `src/server/executor/executePlan.mjs` — import + register `writeAgentLifecycle` in `TASKS`.
- `src/server/onboard/auditPlan.mjs` — new `expectedBodyFor` case (scripts = exact compare; package.json = **new `comparison:"entries"`** branch reporting present/missing/drifted on the 3 entries).
- `scripts/refresh-snapshots.mjs` — add 4 `scripts/agent/*.mjs` paths to the `repoTemplate` `copyFiles[]`.
- `src/snapshots/manifest.json` — regenerated by a `refresh-snapshots` run (advances `repoTemplate` SHA ≥ `4cbb599`). **Never hand-edited.**

**Tests also touch:** `onboardAudit.test.mjs` (+7, incl. a regression guard that existing `existence`/`exact` audit paths still pass after the insertion), `onboardHeadless.test.mjs` (+3), `registry.test.mjs` (+3).

**Docs:** `.changelog/unreleased/` fragment `feat(agent-lifecycle): …(#64)`; `docs/FEATURE_REGISTRY.md`; ROADMAP move #64 → Built.

**Open decisions:**

- **DECISION A1 — minimal package.json shape.** When the target has no `package.json`, write `{name, type:"module", scripts:{}}` only, or also `version`/`private:true`/`engines` to match repo-template exactly? (Recommend: minimal only — adding the rest is opinionated. Tests assert only what we write.)
- **DECISION A2 — locked vs. default.** `default:true` + unlocked (repos with no npm-scripts convention can opt out), or `locked:true` (every ArchonVII repo must have lifecycle commands)? (Recommend: `default:true`, unlocked.)
- **DECISION A3 — `creates[]` vs. a `manages[]` field** for `package.json` (since "creates" implies a new file but here it's a merge). Recommend: keep `creates[]` listing the 4 scripts only; do **not** list `package.json` under `creates[]` (it's merged, not created) — avoids misleading the wizard UI.

**Risks:** `safeWriteFile` is overwrite-false, so a hand-edited script won't be re-written (consistent with `writeGithooks`). The new `comparison:"entries"` branch must be inserted so it fires _only_ for this task + `package.json`.

---

### Lane B — #43 no-remote smoke-test policy ✅

**Policy (owner-decided):** smoke tests must **not** create persistent GitHub repos by default; the remote path runs against a **local bare repo / `gh` mock**. Any live-GitHub smoke test is opt-in (`ARCHON_LIVE_GITHUB_SMOKE=1`), uses **exactly one** repo, and **stops + reports** if it cannot delete. The 5 leaked repos are **one-time manual cleanup** the owner runs.

**Create:**

- `test/mocks/fake-gh.mjs` — emulates `gh repo create` (inits a local bare repo as `origin`) and `gh api`/`repo view` (success), enabling hermetic e2e.
- `test/smokeFreshRepo.test.mjs` — 4 cases: full fresh-repo onboard through the mock asserts **no** github.com call + working local origin + push.
- `scripts/cleanup-smoketest-repos.mjs` — `--dry-run` lists `ArchonVII/*-smoketest-*` and prints exact `gh repo delete` commands; refuses to delete unless `--confirm` AND `delete_repo` scope present.

**Modify:**

- `src/server/lib/commandRunner.mjs` — add `ARCHON_GH_BIN` / `ARCHON_GIT_BIN` (binary override) + an args-prefix seam, as a **pure conditional** (no-op when env absent). **DECISION B1:** use a **JSON-array** env var (`ARCHON_GH_ARGS_PREFIX_JSON`) not space-split — space-split breaks on Windows paths with spaces (e.g. `Program Files`). _(I'd just take the JSON-array form; it's a correctness fix, but flagging it.)_
- `src/server/tasks/ghRepoCreateAndPush.mjs` — skip the live `waitForGitHubRepo` poll when the mock bin is active (clearly commented as test-only).
- `docs/ecosystem-status.md` — append a **decision-log** row for #43.
- `docs/HANDOFF-fresh-repo-wizard.md` — replace the "process lesson" prose with the implemented-as-code policy.
- `ROADMAP.md` — update the "End-to-end wizard hardening" bullet.

**Blocked on you:** `gh auth refresh -h github.com -s delete_repo`, then `node scripts/cleanup-smoketest-repos.mjs --confirm` (or the 5 listed `gh repo delete` commands).

**Open decisions:** B2 — implement the live `ARCHON_LIVE_GITHUB_SMOKE` path now (as a real test) or ship the gate + guard as a documented stub? (Recommend: stub for first merge — safer.) B3 — register `cleanup-smoketest-repos.mjs` in `package.json` scripts or keep ad-hoc? (Recommend: ad-hoc, to prevent accidental `npm run` in CI.)

---

### Lane C — Workflow drift detection + upgrade ✅

**Goal:** use recorded snapshot SHAs to find and upgrade stale managed workflow callers.

**Create:** `src/updater/checkWorkflowDrift.mjs` (compares each managed caller against its snapshot body, annotated with manifest SHA + `capturedAt`); `test/checkWorkflowDrift.test.mjs` (7 cases).

**Modify:** `src/updater/updateManagedFiles.mjs` (export `managedWorkflowName`; add `upgradeWorkflowCallers` that replaces stale callers + re-applies budget defaults); `bin/archon-setup.mjs` (`update --check` = report-only, `update --upgrade` = apply, both with `--dry-run`); `test/updateManagedFiles.test.mjs` (+6).

**Open decisions:** C1 — `--upgrade` **fully replaces** the caller body (snapshot + budget defaults); any repo-specific additions beyond budget defaults are **discarded**. Acceptable? (Recommend: yes, document loudly — budget defaults re-inject known customizations.) C2 — should `.github/archon-setup.json` record per-workflow installed SHA (a lock-file) for actionable "installed sha X, current sha Y" drift reports? (Scope expansion — recommend deferring to a follow-up.) C3 — `update --check` exits non-zero when drifted (it's a gate by design) — document explicitly.

**Risk:** the snapshot `# Copy to .github/workflows/<name>` header must be stripped before compare; add a test asserting a fresh install reports `current` (not `drifted`) for all 17 snapshot files.

---

### Lane D — `.archon/events.jsonl` + status-board ✅

**Goal (conservative, per roadmap):** ship conventions + a best-effort emitter + a minimal read view; inert until events accumulate.

**Create:** `src/server/lib/events.mjs` (append-only emitter; **never throws** into task flow); `src/server/ecosystem/collectEvents.mjs`; `docs/archon-events-convention.md` (line schema: `ts, type, actor, ref, detail`, aligned with the existing `.archon/anomalies-thispr.md` convention); `test/events.test.mjs` (6), `test/collectEvents.test.mjs` (5).

**Modify:** `src/server/executor/executePlan.mjs` (void emitter call-sites); `src/server/ecosystem/snapshot.mjs` + `renderHtml.mjs` (a "Recent events" section with a graceful empty state); `test/ecosystemRenderHtml.test.mjs` (+2), `test/ecosystemSnapshot.test.mjs` (+1).

**Open decisions:** D1 — emit to the **target repo's** `.archon/events.jsonl` (recommended) vs. archon-setup's own. D2 — the convention's provider-side schema should also land in repo-template AGENTS.md — block on a companion repo-template PR, or is the `docs/` convention enough for now? (Recommend: ship archon-setup side + convention doc; file a repo-template follow-up.) **Gap:** the live ecosystem server's `buildSnapshot` call-site that must pass `eventsJsonlPath` isn't pinned — implementer must read `bin/ecosystem-snapshot.mjs`/server startup first.

---

### Lane E — Packaged distribution / npm **prep** ⚠️

**Create:** `scripts/prepublish-check.mjs` (runs tests + `node --check` on bins); `.github/workflows/publish.yml` (`workflow_dispatch`; runs tests then `npm publish --access public --provenance` using `NPM_TOKEN`); `test/packageManifest.test.mjs` (12 cases: `npm pack --dry-run --json` REQUIRED/FORBIDDEN path sets).

**Modify:** `package.json` (add `prepublishOnly`; bump `0.1.0-pre` → `0.1.0`); `README.md` (promote `npx @archonvii/archon-setup` quickstart); `CHANGELOG.md` (Unreleased → `0.1.0` at release time).

**Blocked on you:** create `NPM_TOKEN` secret; confirm `@archonvii` org provenance; optionally a `npm-publish` GitHub environment with a required reviewer; run the dispatch publish; `npm view @archonvii/archon-setup` to confirm name.

**Open decisions:** E1 — remove `CLAUDE.md`/`GEMINI.md` from `files[]`? (They're dev-repo authority files, useless+noisy to consumers, and could clash with a consumer's own. Recommend: remove.) E2 — straight to `0.1.0` on `latest`, or `0.1.0-rc.1` on `next` first? (Recommend: RC first for a first publish.) E3 — add `docs/` to `files[]` so linked walkthroughs ship offline? E4 — manual-approval environment gate yes/no?

**Risk:** `bin/ecosystem-snapshot.mjs` hard-codes `C:\GitHub` as default `--github-root` — wrong for `npx` consumers on other machines/OSes. Not a publish blocker; flag as a usability gap (and a candidate follow-up).

---

### Lane F — Copilot / secrets — **staged disabled** ⚠️

**Goal:** register the capability but ship it `disabled:true` (v0.4 gate). **Hard constraint:** secrets go only through `gh secret set` via **stdin**, never disk/logs; manifest records only the NAME + `wasSet`, never the value.

**Create:** `src/server/tasks/setRepoSecrets.mjs` (pipes value via existing `commandRunner` stdin path); `src/server/tasks/enableCopilot.mjs` (flips the repo setting via `gh api` + a manual checklist for billing/browser steps); `test/copilotSecrets.test.mjs` (9).

**Modify:** `features.json` (+2 `disabled:true` features, `group:"copilot"`); `executePlan.mjs` (register both tasks); `redact.mjs` (+1 pattern to catch accidental `gh secret set NAME VALUE` command-line leaks); `auditPlan.mjs` (+2 null-returning cases — pure remote-mutation, no files); `docs/SECURITY_MODEL.md` + `docs/FEATURE_REGISTRY.md`.

**Blocked on you:** real secret values (at v0.4 activation); the decision to flip `disabled`; Copilot billing tier; `gh` token `repo`/secrets scope.

**Open decisions:** F1 — secret values via plan options (in-memory plan object) vs. a **deferred-stdin prompt** at execute time? (Recommend: deferred-stdin for v0.4 — keeps values out of plan/RPC payloads.) **Gap:** `enableCopilot` uses the Preview `orgs/{owner}/copilot/billing` endpoint — verify it's still valid before writing; add a `blocked` path when `owner` is a personal (non-org) account.

---

### Lane G — Windows installer — thin `npx` bootstrap ⚠️

**Create:** `install.ps1` (checks Node ≥20 + `gh`, prints fix guidance, then runs `npx @archonvii/archon-setup`); `docs/installer/winget-stub.yaml` + `scoop-stub.json` (**design-only**, never submitted); `docs/WINDOWS_INSTALL.md`; `test/installPs1.test.mjs` (9; pwsh-gated cases skip on non-Windows CI, structural checks run everywhere).

**Modify:** `README.md` (Windows bootstrap subsection in Quickstart); `ROADMAP.md` (split the deferred bullet into shipped-thin-slice vs. still-deferred-native); `CHANGELOG.md`; `package.json` `files[]` (+`install.ps1` — and add `install.ps1` to Lane E's `packageManifest.test.mjs` REQUIRED list).

**Blocked on you:** depends on Lane E publishing the package; winget/scoop submissions are out of scope (design-only stubs).

**Open decisions:** G1 — `install.ps1 --dry-run` flag (skip the final `npx`) for CI prereq testing? (Recommend: yes.) G2 — add `*.ps1 text eol=crlf` to `.gitattributes`?

---

## 4. Shared seams (build once, reuse)

| Seam                                                                                                              | Built by | Reused by                                                        |
| ----------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `commandRunner` binary injection (`ARCHON_GH_BIN`/`ARCHON_GIT_BIN` + JSON args-prefix) + `test/mocks/fake-gh.mjs` | **B**    | A (remote-task test), F (gh secret), any future remote-task test |
| `AGENT_SCRIPTS` export from `writeAgentLifecycle.mjs` (precedent: `scrubHookBody` from `writeGithooks`)           | A        | A's audit path                                                   |
| `export managedWorkflowName` from `updateManagedFiles.mjs`                                                        | C        | C's `checkWorkflowDrift`, future updater modules                 |
| `appendEvent` / `TYPE_*` from `events.mjs` (never-throws contract)                                                | D        | D's executor emitter; future task/onboarder callers              |
| snapshot multi-file helper (`checkAllExist`/`verifyAllExist`/`writeSnapshotFile`)                                 | _exists_ | A is the 2nd consumer after `writeGithooks`                      |
| `npm pack --dry-run --json` manifest gate (`packageManifest.test.mjs`)                                            | E        | G (must add `install.ps1` to REQUIRED)                           |

---

## 5. Conflict matrix (shared files)

| File                                             | Lanes               | Resolution                                                                                                 |
| ------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `features.json`                                  | A, F                | Append distinct objects; ensure no trailing comma; valid JSON. Neither #49/#59 touch it.                   |
| `executePlan.mjs`                                | A, D, F             | A/F add import+TASKS entries; D adds function-body call-sites. Non-overlapping. Order A→F→D.               |
| `auditPlan.mjs`                                  | A, F **+ live #49** | **#49 merges first**, then rebase A and F. Additive switch cases at different locations; inspect manually. |
| `refresh-snapshots.mjs`                          | A **+ live #59**    | **#59 merges first**, then A appends 4 `copyFiles[]` entries.                                              |
| `manifest.json`                                  | A **+ live #59**    | Machine-generated; never hand-merge. #59 refresh then A refresh; whichever runs last wins.                 |
| `package.json`                                   | A, E, G             | Distinct keys/slots. Order E→G→A.                                                                          |
| `README.md`                                      | E, G                | E rewrites Quickstart; G inserts a subsection inside it. E first.                                          |
| `CHANGELOG.md`                                   | E, G                | G adds to Unreleased; E promotes Unreleased→0.1.0 at publish. G before E's bump.                           |
| `ROADMAP.md`                                     | B, C, G             | Different sections. Any order.                                                                             |
| `ecosystem-status.md`                            | B, D                | Different sections (decision log vs. backlog/parking-lot). Any order.                                      |
| `updateManagedFiles.mjs`, `bin/archon-setup.mjs` | C only              | Independent.                                                                                               |
| `snapshot.mjs`, `renderHtml.mjs`                 | D only              | Independent.                                                                                               |
| `redact.mjs`                                     | F only              | Independent.                                                                                               |

---

## 6. Concurrency plan (live worktrees)

`git worktree list` shows two **other agents'** active worktrees — do **not** stash/revert/commit their work:

- **#49** `agent/codex/49-existing-repo-audit-plan-apply` — touches `auditPlan.mjs`, `headlessOnboard.mjs`.
- **#59** `agent/codex/59-refresh-workflow-snapshots` — touches `refresh-snapshots.mjs`, regenerates `manifest.json`.

**Safe to start immediately (zero overlap with #49/#59):** B, C, E, G. (D touches `executePlan.mjs` function body only — verify #49 hasn't started touching it.)

**Must wait / rebase:** **A** and **F** touch `auditPlan.mjs` → rebase onto #49. **A** touches `refresh-snapshots.mjs`/`manifest.json` → rebase onto #59 + run a fresh `refresh-snapshots`.

> **DECISION 2 (gating):** wait for #49 and #59 to merge before starting A (cleanest, but blocks the headline issue), OR start A now and accept that #49/#59 will rebase their additive changes onto A. Recommend: **start the zero-overlap lanes now (B first); begin A only once #49/#59 land** — or ping those agents via `.agent/coordination/` to sequence.

---

## 7. Cross-cutting gaps to close (from synthesis)

1. **A:** add an explicit regression test that existing `existence`/`exact` audit cases still pass after the new `entries` branch.
2. **A:** don't silently add `version`/`private`/`engines` to the minimal package.json without DECISION A1 + a test update.
3. **B:** use JSON-array args env var (Windows path-with-spaces correctness). _(DECISION B1.)_
4. **C:** state the acceptance criterion for "upgrade discards non-budget customizations". _(DECISION C1.)_
5. **C:** add a test that a fresh install reports `current` for all 17 snapshot files (header-strip regression).
6. **D:** pin the live `buildSnapshot` call-site for `eventsJsonlPath` before implementing.
7. **D:** `TYPE_PLAN_END` currently fires before `writeSetupManifest`; document the known timing skew.
8. **E:** resolve `CLAUDE.md`/`GEMINI.md` in `files[]`. _(DECISION E1.)_
9. **F:** verify the Copilot Preview API endpoint is current; add a `blocked` path for personal (non-org) accounts.
10. **F:** validate `docs/SECURITY_MODEL.md` current content before editing the threat table.
11. **Portfolio:** a post-merge `ROADMAP.md` reconciliation pass (move C/D/E/F bullets out of Planned/Deferred) — assign it to the last lane to land.
12. **G:** verify the `node --test` skip pattern registers correctly before committing.

---

## 8. Delivery model

- One **PR per lane**, each on its own branch `agent/claude/<issue>-<slug>` in a **sibling worktree** (F19: primary checkout stays on default branch).
- Each PR honors the **strict PR-ready contract** (github-workflows#39/#41): `## Verification` with evidence + a linked issue; `node --test` green; `git diff --check` clean.
- Lanes C/D/E/F/G need **issues opened first** (issue-first per AGENTS.md) — #64 and #43 already exist; the four roadmap bullets need tracking issues.
- The three owner-gated handoffs (repo deletion, npm publish, secret values) are delivered as **staged commands + docs**, not executed by the agent.

## 9. Open decisions for the owner (consolidated)

- **DECISION 1** — build order: minimize-churn (`B…A`) vs. headline-first (`A…`).
- **DECISION 2** — gate A behind #49/#59 merging, or start A now and let them rebase.
- **A1** minimal package.json shape · **A2** locked vs default · **A3** creates vs manages.
- **B1** JSON-array args env · **B2** live smoke path now vs stub · **B3** cleanup script in package.json.
- **C1** upgrade discards non-budget customizations · **C2** per-workflow SHA lock-file.
- **D1** target-repo vs own `.archon/` · **D2** repo-template companion PR.
- **E1** drop CLAUDE/GEMINI from files[] · **E2** RC vs straight 0.1.0 · **E3** docs/ in files[] · **E4** publish env gate.
- **F1** deferred-stdin secret prompt.
- **G1** install.ps1 --dry-run · **G2** .gitattributes ps1 eol.
- **Issues:** open 4 tracking issues for the roadmap lanes (C/D/E/F/G share roadmap bullets)?
