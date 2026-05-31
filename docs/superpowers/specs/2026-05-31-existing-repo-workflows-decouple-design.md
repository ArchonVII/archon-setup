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

1. Explicit `--repo owner/repo` (CLI/config) — always wins.
2. Detected GitHub `origin` remote in the target dir.
3. `remote.github` is selected → `will-create`.
4. Otherwise `none`.

`gh.remotePresent` is **not** introduced as a capability. `capabilities` keeps
only true authorization bits (`gh.authenticated`, `gh.repoCreateAllowed`, …).
Repo presence is detected *state*, carried on the plan context.

**Guardrail 1 — `will-create` is only legal when `remote.github` is selected.**
The resolver must never manufacture a `will-create` target from anything other
than an explicit `remote.github` selection. No "will create somehow."

### 2. Origin parsing (`parseGithubRemote`) — MVP

Recognize **github.com only**. Accepted forms:

```
https://github.com/owner/repo
https://github.com/owner/repo.git
git@github.com:owner/repo.git
ssh://git@github.com/owner/repo
ssh://git@github.com/owner/repo.git
```

Anything else (GitHub Enterprise hosts, non-github remotes, no `origin`) returns
no match → contributes `status: "none"`. **Enterprise host support is explicit
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

`buildPlan` stays pure (emits warnings; never throws). The gate classifier
becomes:

```js
isBlockingWarning(w) =>
  w.severity === "error" ||
  w.feature === "workflows.ci" ||           // legacy: missing/dup CI choice
  /conflicts with/.test(w.message)          // legacy: feature conflicts
```

Both the CLI (`runOnboard`) and the wizard Review screen block Execute when any
blocking warning is present.

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
  + explicit --repo (headless) / future UI ────┤
                                               ▼
buildPlan: resolveRepoTarget({ explicit, originDetected, selection })
           → context.githubRepoTarget {status, owner?, repo?}
           → per-feature remoteRequirement gate → warnings[{severity}]
           → ordered (taskPhase)
                                               ▼
executePlan: api-target tasks read owner/repo from context (see guardrail 2)
```

**Guardrail 2 — API-target tasks consume the resolved target explicitly.**
The existing `applyLabels` / `applyBaselineBranchProtection` already read
`ctx.owner` / `ctx.repo`. To keep one source of truth, `resolveRepoTarget`
**writes the resolved identity back onto the plan context**:

- `status === "known"` → set `context.owner` / `context.repo` to the
  explicit/detected `owner/repo` (overriding any stale values).
- `status === "will-create"` → leave `context.owner` / `context.repo` as-is;
  they *are* the creation identity `remote.github` will use, and
  `ghRepoCreateAndPush` (phase 20) runs before labels/protection (30/40).
- `status === "none"` for an `api-target` feature is already a blocking error
  (§5), so those tasks never execute without a resolved target.

This makes guardrail 2 automatic for the current tasks, but is stated as an
invariant: an api-target task must derive `owner/repo` from the resolved target
and must not fall back to unrelated assumptions.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/parseGithubRemote.mjs` | Parse a remote URL → `{owner, repo}` for github.com; else null | — |
| `preflight/checkOriginRemote.mjs` | `git -C <target> remote get-url origin` → detected target state | `parseGithubRemote` |
| `planner/resolveRepoTarget.mjs` | Combine explicit + detected + selection → `githubRepoTarget` (guardrail 1) | `parseGithubRemote` |
| `planner/buildPlan.mjs` (edit) | Drop `requires`; apply `remoteRequirement` gate; emit `severity` warnings | `resolveRepoTarget` |
| `registry/features.json` (edit) | `remoteRequirement` + adjusted `capabilitiesNeeded`; remove `requires: remote.github` from the 4 groups | — |
| `onboard/headlessOnboard.mjs` (edit) | Auto-detect origin in target; backfill owner/repo; pass `explicit` | `checkOriginRemote`/`parseGithubRemote` |
| `executor` tasks (edit) | `applyLabels` / branch-protection consume resolved target (guardrail 2) | — |
| `onboard/headlessOnboard.mjs` `isBlockingWarning` (edit) | Add `severity === "error"` | — |

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
- `https://github.com/owner/repo(.git)` → `{owner, repo}`.
- `ssh://git@github.com/owner/repo.git` → `{owner, repo}`.
- non-github / empty → null.

**`resolveRepoTarget`:**
- explicit `--repo org/main` + origin `user/fork` → `known`, `org/main`
  (explicit beats origin).
- origin only → `known` from origin.
- `remote.github` selected, no origin/explicit → `will-create`.
- nothing → `none`. `will-create` never appears without `remote.github`
  (guardrail 1).

**`buildPlan`:**
- `workflow.pr-policy` alone, no target → `ordered` has `installWorkflow`, **no**
  `ghRepoCreateAndPush`; one `severity:"warn"` warning.
- `remote.labels` alone, no target, no `remote.github` → `severity:"error"`
  warning; `isBlockingWarning` true; no misleading "written locally".
- `remote.labels` with detected origin → no repo-create task; needs
  `gh.authenticated`; uses detected owner/repo.
- `remote.github` + `remote.labels` → `ghRepoCreateAndPush` present; `applyLabels`
  ordered after it (phase 20 < 30).

**Headless (`onboardHeadless.test`):**
- seeded temp git repo with a github origin, onboarded with a `workflow.*`
  feature → YAML written, **no** repo-create in plan; owner/repo backfilled from
  origin.

## Out of scope (separate sub-issues)

- Existing-repo audit/plan/apply mode and `checkTargetPath` accepting populated
  dirs — **#49 (B)**.
- AGENTS.md/CLAUDE.md reconcile — **#50 (C)**.
- Branch-protection two-step automation — **#51 (D)**.
- Browser-wizard surfacing of the new model / warning copy — **E** (later).
