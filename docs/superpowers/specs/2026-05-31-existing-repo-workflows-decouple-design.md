# Decouple remote-dependent features from repo-create

**Issue:** #48 (Sub-project A of the #34 existing-repo onboarding epic)
**Date:** 2026-05-31
**Status:** Approved design

## Problem

Every feature that targets GitHub currently hard-`requires` `remote.github`:

```
workflow.pr-policy / semantic-pr-title / pr-body-autoinject / branch-naming /
required-gate / node-ci / python-ci / minimal-ci
agent-workflow.anomaly-triage
remote.labels
remote.branch-protection
        ───requires───▶  remote.github
```

`remote.github` carries the `ghRepoCreateAndPush` task, a `gh repo create
… --source=. --push` command, and the `gh.repoCreateAllowed` capability. So
selecting *any* of the above forces repo **creation**. That is correct for a
greenfield repo but wrong for one that already exists on GitHub — onboarding
`jma-ui` (#34) had to install these by hand for exactly this reason.

The bad coupling conflates three independent concepts:

1. **Repo target state** — is there a GitHub repo to act on, and where does its
   identity come from?
2. **Feature requirement type** — does a feature write a local file, or call the
   GitHub API?
3. **Authorization** — is `gh` authenticated; may it create repos?

## Central principle

> A feature may require a GitHub **repository target** without requiring the
> onboarding tool to **create** that repository.

`remote.github` means "create and push a new repo." It does **not** mean "a
GitHub repo is relevant."

## Model

### 1. Resolved repo target (state, not capability)

A pure resolver produces a `githubRepoTarget`:

```js
// resolveRepoTarget({ explicit, originDetected, selection }) -> one of:
{ status: "known",       source: "explicit" | "origin", owner, repo }
{ status: "will-create", source: "remote.github" }   // see guardrail 1
{ status: "none" }
```

**Precedence (highest first):**

1. Explicit identity from the CLI — always wins. The #46 headless CLI **already
   has `--owner` and `--repo` flags**; an explicit target = both present. No new
   flag is added in A. Invalid input (only one of the pair, or malformed) is
   rejected in `runOnboard` before `buildPlan`.
2. Detected GitHub `origin` remote in the target dir.
3. `remote.github` is selected → `will-create`.
4. Otherwise `none`.

`gh.remotePresent` is **not** introduced as a capability. `capabilities` keeps
only true authorization bits (`gh.authenticated`, `gh.repoCreateAllowed`, …).
Repo presence is detected *state*, carried on the plan context.

**Guardrail 1 — `will-create` is only legal when `remote.github` is selected.**
The resolver must never manufacture a `will-create` target from anything other
than an explicit `remote.github` selection. No "will create somehow."

**`remote.github` selected *with* a known target.** Because explicit/origin beat
`remote.github` in the precedence, selecting `remote.github` while an explicit or
origin target is already known leaves `githubRepoTarget.status === "known"` — but
the `ghRepoCreateAndPush` task is still in the plan and runs per its existing
**idempotent** behavior (`check()` returns `already-done` when the repo exists).
This is allowed in A; a later UX pass (E) may add an informational warning that
the repo already exists. We do not add a blocking conflict for it now.

### 2. Origin parsing (`parseGithubRemote`) — MVP

Recognize **github.com only**. Accepted forms:

```
https://github.com/owner/repo
https://github.com/owner/repo.git
git@github.com:owner/repo.git
ssh://git@github.com/owner/repo
ssh://git@github.com/owner/repo.git
```

A single trailing slash on the https forms is tolerated
(`https://github.com/owner/repo/`). Anything else returns no match → contributes
`status: "none"`:

- Extra path segments (`https://github.com/owner/repo/issues`,
  `…/owner/repo/tree/main`) → `null` (not a bare repo remote).
- Missing owner or repo, unsupported hosts (GitHub Enterprise, gitlab, …),
  non-`origin` or absent remote → `null`.

**Contract:** only an *exact* github.com repository remote URL yields
`{owner, repo}`; everything else is `null`. **Enterprise host support is explicit
future work**, out of scope for A.

### 3. Per-feature requirement enum

New registry field `remoteRequirement`. Absent means local-only (no gate).

| Feature | `remoteRequirement` | `capabilitiesNeeded` | No target → |
|---|---|---|---|
| `workflow.*`, `agent-workflow.anomaly-triage` | `"runtime"` | `[]` | **warning** (`severity: "warn"`) |
| `remote.labels`, `remote.branch-protection` | `"api-target"` | `["gh.authenticated"]` | **error** (`severity: "error"`) unless `remote.github` selected |

- **`runtime`** features only write local YAML (`installWorkflow` is a pure
  `readFile` snapshot → `safeWriteFile`; no `gh`, no auth). They are valid with
  no remote — the file simply won't *run* until the repo reaches GitHub.
- **`api-target`** features call the GitHub API against a live repo
  (`applyLabels` / branch protection invoke `gh` + `waitForGitHubRepo`). With no
  target and no creation, there is no meaningful local fallback → blocking error.

The four feature groups **drop** `requires: ["remote.github"]`.

**Aggregate the runtime warning.** When several `runtime` features are selected
with no target, `buildPlan` emits **one** deduped runtime diagnostic (keyed by
`remoteRequirement: "runtime"`), not one per workflow, so the user is not spammed
with identical copies.

### 4. Ordering — unchanged, single authority

`taskPhase` in `buildPlan.mjs` is the *only* execution-ordering system and is
independent of `requires` (which only drives the selection closure):

```
initGitAndCommit = 10
ghRepoCreateAndPush = 20
applyLabels = 30
applyBaselineBranchProtection = 40
local file writes / installWorkflow = 0
```

`plan.ordered` is sorted by `taskPhase` then original index
(`buildPlan.mjs:158-161`). Dropping `requires` therefore **cannot** reorder
labels/protection relative to repo-create: phase 30/40 still sort after phase
20. No `provides`/`consumes`/`orderAfterIfSelected` machinery is added — that
would be a redundant second ordering system.

### 5. Warning severity + blocking gate

Warnings carry `severity: "warn" | "error"`:

- `runtime` feature, target `none` → `severity: "warn"` (non-blocking).
- `api-target` feature, target `none`, `remote.github` not selected →
  `severity: "error"` (blocking).

`buildPlan` stays pure (emits diagnostics; never throws). **Each warning is
stamped with a derived `blocking: boolean`** computed once, server-side:

```js
warning.blocking =
  warning.severity === "error" ||
  warning.feature === "workflows.ci" ||      // legacy: missing/dup CI choice
  /conflicts with/.test(warning.message)     // legacy: feature conflicts
```

This is the **single source of truth** for the gate. Both consumers just filter
`warnings.filter(w => w.blocking)` — no duplicated classifier:

- CLI: `runOnboard` blocks Execute (today's `isBlockingWarning` becomes
  `w => w.blocking === true`; its #46 tests update to the `blocking`/`severity`
  shape).
- Wizard: `renderReview` in `src/ui/app.mjs` has its **own inline** filter today
  (`w.feature === "workflows.ci" || /conflicts with/`). It is replaced with
  `w.blocking`, so the plan crossing the RPC boundary carries the gate decision
  with it.

> The array stays named `warnings` for compatibility; conceptually these are
> *diagnostics* (a `warn`/`error` severity each). No rename in A.

**Wizard scope for A (Option A — minimal gating, not full UX).** A wires
`checkOriginRemote` into preflight and updates `renderReview`'s gate to
`w.blocking` so the wizard refuses Execute on `error` diagnostics. Richer UI
surfacing (dedicated copy, an "existing repo detected" affordance, create-vs-use
toggle) remains **E**.

**Runtime warning copy** (direct, so the user does not read it as failure):

> GitHub workflow files will be installed locally, but they will not run until
> this directory is pushed to GitHub. To create and push a new GitHub repo now,
> also select "Create GitHub repo."

## Data flow

```
Wizard:  preflight.checkOriginRemote(target) ──┐
                                               ├─▶ context.repoTargetCandidate
Headless: runOnboard detects origin in target ─┘   (status known|none, owner/repo)
                                               │
  + explicit owner/repo (headless flags) ──────┤
                                               ▼
buildPlan: resolveRepoTarget({ explicit, originDetected, selection })
           → applyResolvedRepoTarget(context) → {githubRepoTarget, owner, repo}
           → per-feature remoteRequirement gate → warnings[{severity, blocking}]
           → ordered (taskPhase)
                                               ▼
executePlan: api-target tasks read owner/repo from context (see guardrail 2)
```

**Guardrail 2 — API-target tasks consume the resolved target explicitly.**
`resolveRepoTarget` is **pure** — it returns a `githubRepoTarget` and mutates
nothing. `buildPlan` is responsible for applying it to the plan context:

```js
const githubRepoTarget = resolveRepoTarget({ explicit, originDetected, selection });
const planContext = applyResolvedRepoTarget(context, githubRepoTarget);
// applyResolvedRepoTarget returns a NEW context; it does not mutate its input.
```

The existing `applyLabels` / `applyBaselineBranchProtection` already read
`ctx.owner` / `ctx.repo`, so `applyResolvedRepoTarget` sets those to the single
source of truth:

- `status === "known"` → `owner`/`repo` = the explicit/detected identity
  (overriding any stale values).
- `status === "will-create"` → `owner`/`repo` left as-is; they *are* the
  creation identity `remote.github` will use, and `ghRepoCreateAndPush` (phase
  20) runs before labels/protection (30/40).
- `status === "none"` for an `api-target` feature is already a blocking error
  (§5), so those tasks never execute without a resolved target.

Invariant: an api-target task must derive `owner/repo` from the resolved target
and must not fall back to unrelated assumptions.

**`will-create` with missing creation identity.** If an `api-target` feature is
selected with `status === "will-create"` but `remote.github` lacks a usable
`owner`/`repo` to create (empty identity), `buildPlan` emits a blocking `error`
diagnostic — labels/protection must not proceed against a repo that cannot be
created/pushed.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/parseGithubRemote.mjs` | Parse a remote URL → `{owner, repo}` for github.com; else null | — |
| `preflight/checkOriginRemote.mjs` | `git -C <target> remote get-url origin` → detected target state | `parseGithubRemote` |
| `planner/resolveRepoTarget.mjs` | **Pure**: combine explicit + detected + selection → `githubRepoTarget` (guardrail 1). Also exports `applyResolvedRepoTarget(context, target)` → new context with `owner/repo/githubRepoTarget` set (no mutation) | `parseGithubRemote` |
| `planner/buildPlan.mjs` (edit) | Apply resolved target; drop `requires`; `remoteRequirement` gate; emit diagnostics with `severity` + stamped `blocking`; dedupe runtime diagnostic | `resolveRepoTarget` |
| `registry/features.json` (edit) | `remoteRequirement` + adjusted `capabilitiesNeeded`; remove `requires: remote.github` from the 4 groups | — |
| `onboard/headlessOnboard.mjs` (edit) | Auto-detect origin in target; validate `--owner`/`--repo` pair; pass `explicit`; `isBlockingWarning` → `w => w.blocking === true` | `checkOriginRemote`/`parseGithubRemote` |
| `executor` tasks (edit) | `applyLabels` / branch-protection consume resolved `ctx.owner/ctx.repo` (guardrail 2) | — |
| `src/ui/app.mjs` `renderReview` (edit) | Replace inline blocking filter with `w.blocking` (single source of truth) | — |

## Testing

Pure-unit first (no network), mirroring existing `manifestAccuracy` / `registry`
test style.

**Registry (`registry.test` / `foundationParity`-style):**
- `workflow.*` + `agent-workflow.anomaly-triage`: no `requires: remote.github`;
  `remoteRequirement: "runtime"`; `capabilitiesNeeded: []`.
- `remote.labels` + `remote.branch-protection`: no `requires: remote.github`;
  `remoteRequirement: "api-target"`; `capabilitiesNeeded: ["gh.authenticated"]`.

**`parseGithubRemote`:**
- `git@github.com:owner/repo.git` → `{owner, repo}`.
- `https://github.com/owner/repo(.git)` and trailing-slash `…/repo/` → `{owner, repo}`.
- `ssh://git@github.com/owner/repo.git` → `{owner, repo}`.
- `https://github.com/owner/repo/issues` (extra path segment) → null.
- non-github / empty → null.

**`checkOriginRemote`:**
- non-git directory → `none`, **no thrown error**.
- git repo with no `origin` → `none`, **no thrown error**.
- git repo with a github `origin` → detected `{owner, repo}`.

**`resolveRepoTarget`:**
- explicit `--repo org/main` + origin `user/fork` → `known`, `org/main`
  (explicit beats origin).
- origin only → `known` from origin.
- `remote.github` selected, no origin/explicit → `will-create`.
- nothing → `none`. `will-create` never appears without `remote.github`
  (guardrail 1).

**`buildPlan`:**
- `workflow.pr-policy` alone, no target → `ordered` has `installWorkflow`, **no**
  `ghRepoCreateAndPush`; one `severity:"warn"`, `blocking:false` diagnostic.
- `workflow.pr-policy` with **no `gh.authenticated`** capability → **no** blocking
  auth diagnostic (runtime needs no auth; protects the behavior at the planner
  level, not just the registry).
- Multiple `runtime` features, no target → **one deduped** runtime diagnostic,
  not one per workflow.
- `remote.labels` alone, no target, no `remote.github` → `severity:"error"`,
  `blocking:true`; no misleading "written locally".
- `remote.labels` with detected origin → no repo-create task; needs
  `gh.authenticated`; uses detected owner/repo.
- `remote.github` + `remote.labels` → `ghRepoCreateAndPush` present; `applyLabels`
  ordered after it (phase 20 < 30).
- `remote.github` + `remote.labels` with **empty creation identity**
  (`will-create`, no owner/repo) → blocking `error` (labels must not proceed
  against an un-creatable repo).

**Headless (`onboardHeadless.test`):**
- seeded temp git repo with a github origin, onboarded with a `workflow.*`
  feature → YAML written, **no** repo-create in plan; owner/repo backfilled from
  origin.

## Out of scope (separate sub-issues)

- Existing-repo audit/plan/apply mode and `checkTargetPath` accepting populated
  dirs — **#49 (B)**.
- AGENTS.md/CLAUDE.md reconcile — **#50 (C)**.
- Branch-protection two-step automation — **#51 (D)**.
- **Richer** browser-wizard UX for the new model — dedicated diagnostic copy, an
  "existing repo detected" affordance, a create-vs-use toggle — **E** (later).
  Note: A *does* include minimal wizard work (origin detection in preflight +
  `renderReview` gating on `w.blocking`); only the richer UX is deferred.
