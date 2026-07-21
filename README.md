# archon-setup

Plug-and-play repo bootstrapper for the ArchonVII ecosystem.

A local browser wizard that scaffolds a new repository — minimal files and git init by default, with optional `gh` remote, labels, branch protection, hooks, and workflows — driven by a dependency-aware feature registry.

## First End Goal

The first product end goal is a safe ArchonVII repo upgrade path:

> Given a fresh repository or an existing repository, `archon-setup` should be
> able to bring it onto the ArchonVII ecosystem baseline for GitHub workflow,
> CI, agent process, documentation, and repository governance by auditing what
> exists, carrying forward real repo-specific decisions, and replacing weak or
> stale setup with the managed baseline when the user asks for onboarding.

That means the tool must be useful for both new projects and lived-in repos. It
should audit first, explain what it found, show an exact plan, apply only the
selected changes, and leave enough manifest/history data for a future agent or
human to understand what was installed and what was intentionally skipped.

For a plain-English explanation of what onboarding checks, confirms, adds,
edits, and leaves for review, see
[`docs/REPO_ONBOARDING_WALKTHROUGH.md`](./docs/REPO_ONBOARDING_WALKTHROUGH.md).
For the binding rule that defines when onboarding is actually complete, see
[`docs/agent-process/deterministic-onboarding.md`](./docs/agent-process/deterministic-onboarding.md).
For the current coordinator/review/close handoff, see
[`docs/COORDINATOR_HANDOFF.md`](./docs/COORDINATOR_HANDOFF.md).
For the current active-lane map and held decision gates, see
[`docs/CURRENT_WORK.md`](./docs/CURRENT_WORK.md). The Agent OS roadmap promoted
on 2026-06-12 lives at
[`docs/plans/2026-06-12-os-roadmap.md`](./docs/plans/2026-06-12-os-roadmap.md).

## Quickstart

`archon-setup` is **freshly built and under active testing before its first npm
release** — it is **not yet on npm**. Run it from a source checkout:

```bash
npm start
# equivalently:
node bin/archon-setup.mjs
```

The one-line `npx` quickstart is the goal once `0.1.0` is published (tracked in
#82); until then it will not resolve:

```bash
npx @archonvii/archon-setup   # after publication
```

### Windows bootstrap

On Windows, `install.ps1` checks prerequisites (Node >= 20, `gh`) and then runs
the `npx` quickstart for you (see [`docs/WINDOWS_INSTALL.md`](./docs/WINDOWS_INSTALL.md)):

```powershell
iwr -useb https://raw.githubusercontent.com/ArchonVII/archon-setup/main/install.ps1 | iex
# or, from a checkout, just verify prerequisites:
./install.ps1 -DryRun
```

Native winget/scoop installers are deferred; the thin `npx` bootstrap is the
supported Windows path for now.

Your default browser opens to a local URL. The wizard walks you through:

0. **Doctor** — confirms `git`, `gh`, optional `actionlint`, network, and write permissions are good.
1. **Location** — choose a new repo folder or an existing repo to audit/onboard.
2. **Features** — checkbox tree (Foundations, GitHub remote, PR contract, …).
3. **Review** — exactly what files will be created and commands run; existing
   repo mode also shows present/missing/drifted audit results and requires an
   explicit target confirmation before write-capable steps.
4. **Execute** — streaming progress plus applied/skipped/failed task results.
5. **Ecosystem** — current active-repo/port/signals snapshot plus recorded
   global update fixes that can be dry-run or distributed with explicit
   confirmation.

Nothing leaves your machine except the `git` / `gh` calls you approve.

### Headless onboarding

For scripted / agent-driven onboarding (no browser), use the `onboard`
entrypoint. It reuses the **same planner and executor** the wizard drives, so
the two stay in lockstep:

```bash
npm run onboard -- <targetPath> [options]
```

| Option             | Effect                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `--profile <id>`   | Select `docs-min`, `agent-standard`, or `flagship`; additional `--features` are unioned into a custom selection |
| `--features a,b,c` | Use this explicit selection plus true `requires` dependencies (default only when omitted; `foundation.git-init` does not force a license) |
| `--owner <name>`   | GitHub owner/account; enables `CODEOWNERS` and the manifest owner                                        |
| `--repo <name>`    | Repo name recorded in `.github/archon-setup.json`                                                        |
| `--visibility <v>` | `private` (default) or `public`                                                                          |
| `--audit`          | Report planned baseline items as `present`, `missing`, or `drifted` without writing                      |
| `--dry-run`        | Print the plan and exit without writing                                                                  |
| `--json`           | Emit the result as JSON instead of human-readable text                                                   |

`--dry-run` shows exactly what the wizard's Review screen would. Standard
onboarding writes the minimal solo-dev baseline: README, license, gitignore,
agent pointers, neutral coordination docs, `.gitattributes`, manifest, and the
initial git commit. Local hooks, changelog ceremony, CODEOWNERS, Dependabot, PR
templates, branch protection, labels, lifecycle scripts, template libraries, and
runtime workflow callers such as `repo-required-gate.yml` and
`anomaly-triage.yml` are explicit opt-ins. The former repo-update-log fragment
guard remains only as a disabled compatibility identifier for older manifests.

`--audit` is the read-only existing-repo entrypoint: it builds the same plan but
checks each planned baseline file in the target repo, reporting `present` when
it matches, `missing` when absent, and `drifted` when the existing content
differs from the managed baseline. The JSON result also includes
`audit.startupReadiness`, a selected-profile startup summary with the baseline
version, missing files, stale content, misplaced managed blocks, legacy plan
paths, and a repair command. The default profile includes the executable
documentation floor and its report-only doc-health companion. Repos that opt
into the full agent lifecycle, doc-sweep, PR template, check-map, or required-gate
features get their additional startup/process surface audited too, including
concrete lifecycle files and managed `package.json` `agent:*`/`docs:*` entries.
Managed wiki markdown files may carry
repo-local YAML frontmatter; audit and repair preserve that metadata when the
baseline body is current. The startup baseline file itself is checked when it is
part of the selected profile, and same-version contract drift is treated as
stale.

Headless dry-run, apply, and audit results also include
`selectionValidation`. It verifies that the generated startup floor and
relative links in selected repo-template Markdown close over the resolved
feature install set. Findings are machine-readable blocking errors; apply is
refused, audit cannot complete successfully, and post-merge verification reports
`blocked` until the provider contract is repaired.

**Existing repos.** In the browser wizard, choose **Existing repo** on Location.
The wizard accepts a populated git repo, detects its GitHub `origin`, runs a
read-only audit on the shared plan, and disables GitHub repo creation while
still allowing workflow callers, labels, and baseline branch protection to
target the selected repo. The headless equivalent is to point `onboard` at a
repo that already has a GitHub `origin` and select GitHub features without
`remote.github`. Pass `--owner`/`--repo` to target a specific repo (e.g. an
upstream instead of a fork); explicit values win over the detected origin.

**Decisioned existing-repo repair.** Use the repair flow when an existing repo
needs a full baseline reconciliation rather than an ad-hoc agent patch:

```bash
# Read-only: create a versioned decision document (or add --save-issue).
node bin/onboard.mjs repair C:\path\to\repo --profile agent-standard --owner OWNER --repo REPO --save-issue

# After every decision is resolved in the document or issue, create a draft repair PR.
node bin/onboard.mjs repair C:\path\to\repo --intake issue:#123 --owner OWNER --repo REPO

# After merge, audit the fetched default-branch commit—not the old checkout.
node bin/onboard.mjs verify-merged C:\path\to\repo --record C:\Users\you\.claude\archon-onboarding-repair\<run>.jsonl
```

Only `apply-central` decisions write files. `keep-local`, `declined`,
`merge-manual`, `defer`, and `blocked` are persisted in the setup manifest and
carried into the draft PR; the repair flow never auto-merges or changes branch
protection. Matching `keep-local` fingerprints are accepted local authority,
`declined` capabilities leave the effective selection, and the other manual
states keep onboarding incomplete. Every defer needs a review trigger or
expiry. A selective repair applies only the resolved `apply-central` features,
while its generated startup baseline and setup manifest retain the effective
selection and named profile.

### Updating managed workflows

Once a repo is onboarded, keep its managed workflow callers in step with the
recorded `github-workflows` snapshot:

```bash
# Refresh budget defaults in existing managed callers (preserves custom inputs):
node bin/archon-setup.mjs update --target <repo>

# Report drift vs the recorded snapshot (exits non-zero if anything is drifted):
node bin/archon-setup.mjs update --check --target <repo>

# Rewrite drifted callers to the current snapshot (re-injects budget defaults):
node bin/archon-setup.mjs update --upgrade --target <repo>
```

`--check` classifies each caller as `current`, `drifted`, or `unmanaged` and is
safe to run in CI or a pre-push hook (it never writes). `--upgrade` **fully
replaces** drifted managed callers with the snapshot body, so any customization
beyond the standard budget defaults is discarded — use plain `update` when you
need to preserve custom inputs. Both `--check` and `--upgrade` accept
`--dry-run`, and `--target` defaults to the current directory.

### Refreshing managed regions

Use the `refresh` subcommand when you need a read-only audit of ArchonVII-managed
regions in one existing repo, including AGENTS/global-update blocks:

```bash
node bin/archon-setup.mjs refresh --target <repo>
node bin/archon-setup.mjs refresh --target <repo> --json
```

The command runs the distributor in `audit` mode, so it never writes files and
can audit a repo that is sitting on `main` or has local changes. It still skips
targets whose git state cannot be trusted, such as non-git paths or detached
HEADs. JSON output is a `RepoRefreshReport` with raw reconcile state, the
operation projection, any server-computed drift diff, and a deterministic
recommendation for each item. Exit codes are stable for automation: `0` means
nothing to do, `10` means a clean update is pending, `20` means a human decision
or conflict remains, and `1` means the target could not be audited or an
operational failure occurred.

Completed decision docs can be executed through the PR lane:

```bash
node bin/archon-setup.mjs refresh --target <repo> --intake <doc.json|issue:#N> --execute --confirm "<phrase>"
node bin/archon-setup.mjs refresh --target <repo> --intake <doc.json|issue:#N> --execute --local-only --confirm "<phrase>"
node bin/archon-setup.mjs refresh --target <repo> --intake <doc.json|issue:#N> --execute --pr-only --confirm "<phrase>"
```

`--execute` re-validates the decision doc into an `ApplySet`, creates a
disposable branch/worktree from `origin/<default>`, applies allowed managed
region changes there, and records a durable JSONL run state under
`~/.claude/archon-prlane-runs/`. `--local-only` stops after the post-apply
audit, `--pr-only` commits/pushes and opens a labeled draft PR without
auto-merge, and the default mode queues auto-merge only after the machine gate
passes: confirmation phrase, allowed categories/paths, no unresolved or
auto-resolved conflict items, `automated-distribution` label, PR body evidence,
required checks passing, and a clean post-apply audit.

After GitHub reports the PR merged, verify and clean up the run record:

```bash
node bin/archon-setup.mjs verify-merged --run <run-id>
node bin/archon-setup.mjs cleanup --run <run-id>
```

`verify-merged` fetches `origin/<default>`, audits the recorded merge commit in
a detached disposable worktree, and requires every applied item to report
`clean_apply changed:false`. A failed post-merge audit leaves a rollback-ready
RunReport. `cleanup` is idempotent: after `verified_merged`, it removes the
recorded worktree and local/remote run branch; before a merge, it closes the PR
when possible, deletes the branch, and records the run as aborted.

Rollback is a guaranteed-safe revert attempt, not a promise to restore the whole
tree:

```bash
node bin/archon-setup.mjs rollback --run <run-id>
node bin/archon-setup.mjs rollback --last
```

It never mutates `main` directly. If the original PR never merged, rollback
falls back to cleanup. If it did merge, rollback creates a new revert branch
from `origin/<default>`, auto-detects squash versus merge commits
(`git revert` versus `git revert -m 1`), checks that affected paths match the
recorded base tree, pushes the branch, and opens a rollback PR. Later commits in
the same managed region can make the revert unsafe; in that case rollback stops
with a manual-review failure and creates no PR.

## Canonical New-Repo Setup

Use `archon-setup` as the canonical path for new ArchonVII repos. It wraps the
older manual recipe from `repo-template` and `github-workflows`:

1. Run `node bin/archon-setup.mjs` from this repo.
2. Pass Doctor checks for `git`, `gh`, optional `actionlint`, network access,
   and write permissions.
3. Choose the target location, repo name, visibility, and feature set.
4. Review the exact files, commands, remote mutations, and deferred post-checks.
5. Execute the plan, then follow the generated manifest's post-checks.

The manual fallback remains:

1. Create from `ArchonVII/repo-template`.
2. Customize README, license, `.gitignore`, `CODEOWNERS`, `AGENTS.md`, CI mode,
   Dependabot, and changelog mode.
3. Run `node scripts/setup-repo.mjs ArchonVII/<repo> --solo` from a
   `github-workflows` checkout.
4. Install `.githooks/` in every clone.
5. After the first PR run, set branch protection's required check to
   `repo-required-gate / decision`:

   ```bash
   node bin/archon-setup.mjs tighten-required-gate --target <repo-path>
   ```

   The command reads `.github/archon-setup.json` for `owner/repo` when present,
   falls back to the GitHub `origin`, and exits successfully with a clear
   pending message if GitHub has not seen the gate run yet.

For the human-readable version of this process, including what to inspect in a
lived-in repo before replacing old setup, read the
[repo onboarding walkthrough](./docs/REPO_ONBOARDING_WALKTHROUGH.md).

## Agent Authority Files

Generated agent-touched repos get:

- `AGENTS.md` - the cross-tool contract for Claude, Codex, Gemini, Copilot, and
  future agents.
- `CLAUDE.md` - a short Claude-specific addendum that tells Claude to read
  `AGENTS.md` first.
- `GEMINI.md` - the same pointer pattern for Gemini.

Do not put shared workflow rules only in `CLAUDE.md`. If every agent must obey a
rule, put it in `AGENTS.md`; tool-specific quirks belong in the tool addendum.

## Agent And Automation Catalog

Existing agent-facing capabilities:

- **Cross-tool agent contract** - `AGENTS.md` defines the rules that all agents
  must follow, including issue/branch/PR discipline, verification expectations,
  repo update logs, anomaly notes, check maps, and coordination guidance.
- **Claude addendum** - `CLAUDE.md` points Claude at `AGENTS.md` first and holds
  only Claude-specific differences when they are needed.
- **Gemini addendum** - `GEMINI.md` follows the same pattern for Gemini.
- **Codex compatibility** - Codex is governed through `AGENTS.md`, branch naming,
  PR verification, update logs, and the same reusable workflow gates rather than
  a Codex-only policy file.
- **Copilot compatibility foundation** - PR body autoinjection, semantic title
  checks, branch naming checks, and future secret setup are designed to make bot
  PRs easier to review without giving Copilot a separate authority source.
- **Anomaly triage workflow** - optional agent workflow that turns side findings
  recorded during PR work into sticky PR comments or follow-up issues.
- **Required gate plus check map** - optional `.agent/check-map.yml` and
  `repo-required-gate.yml` give agents and branch protection one shared map from
  changed paths to required verification when a repo wants enforced closeout.
- **Executable documentation floor** - the locked `foundation.doc-system`
  capability installs a selection-aware `.agent/doc-map.yml`, non-destructive
  `docs/CANON.md`/`docs/INDEX.md` seeds, the doc-system contract, all six
  zero-dependency `scripts/docs/*.mjs` generators, and the managed
  `docs:render`/`docs:status` package commands. Its report-only doc-health
  companion is a required dependency, while doc-sweep remains an explicit
  opt-in. The opt-in changelog capability owns both `CHANGELOG.md` and
  `docs:changelog`, so no profile advertises a command without its input. Audit
  validates the same files and package-script ownership, and generated-consumer
  tests execute the installed commands end to end. Charter line budgets remain
  visible maintenance warnings, not absolute merge caps.
- **Versioned startup baseline** - `.agent/startup-baseline.json`,
  `docs/plans/README.md`, `AGENTS.md`, and `agent:status` give agents one
  canonical first-stop map for plans, process files, coordination, PR flow, and
  repair actions. `agent:start-task -- --carry <path...>` verifies explicit task
  inputs in the new lane, then cleans only sources whose filesystem and Git-index
  state still match the captured receipt. Divergent staged/unstaged versions are
  rejected, changed or recreated sources are preserved with recovery details,
  and unrelated dirt still blocks startup. Do not edit either checkout until
  `agent:start-task` returns.
- **Repo update log archive** - generated repos receive the frozen
  `docs/repo-update-log.md` archive for compatibility; the former per-PR fragment
  workflow is retired and its feature identifier resolves as a disabled no-op.
- **Global update records** - archon-setup records shared agent/workflow fixes
  that may need ecosystem-wide dissemination, exposes them in the Ecosystem UI,
  and logs per-repo distribution results.
- **Plan/status closeout guidance** - generated repos and global update records
  now tell agents that delivery is incomplete while lane-created or lane-used
  plan, progress, handoff, audit, roadmap/status, or coordination artifacts
  still read as active execution guidance.
- **Ecosystem overview** - `docs/ecosystem-overview.md` is the canonical
  high-level "what exists and how it connects" map of the meta layer (the three
  providers, this integrator, and the `jma-skill-review` skill source). It
  carries the change-routing and managed-content rules an agent needs before
  touching anything another repo depends on. The repo-inventory block is
  generated from `config/ecosystem-map.json` + live snapshot refs via
  `npm run update-ecosystem-overview` (`--check` is enforced by `npm test`).
  It is meta-repo only and is intentionally not linked from `repo-template`, so
  consumer repos stay coordination-isolated.
- **Current work map** - `docs/CURRENT_WORK.md` is the single active-lane map
  for the current Agent OS, document-policy, and registry/dashboard work. Update
  it in the same PR whenever a lane merges, a lane issue is filed, or a held
  decision gate changes.
- **Headless existing-repo audit** - `npm run onboard -- <repo> --audit`
  reports planned baseline files as `present`, `missing`, or `drifted` without
  writing.
- **Managed AGENTS / CLAUDE reconcile** - existing agent instruction files can
  receive ArchonVII managed blocks while preserving repo-specific content.
- **Strict PR-ready contract** - generated policy forbids direct `gh pr ready`
  and points agents at the shared `agent:close-preflight` /
  `agent:pr-ready` wrapper path. Draft validation through `npm run pr:contract`
  uses an explicit temporary body file on PowerShell, not stdin piped into npm;
  the lifecycle installer merges that wrapper into consumer `package.json`.
- **Required-gate tighten command** - `tighten-required-gate` performs the
  delayed `repo-required-gate / decision` required-check step once GitHub has
  seen the check run.
- **Owner / agent / default lanes** - the ecosystem policy distinguishes safe
  owner maintenance from agent-managed code changes and ordinary reviewed work.

Planned agent-facing capabilities:

- **Existing-repo browser UX** - surface the existing-repo audit and apply path
  in the browser wizard with explicit confirmation before write-capable steps.
- **Managed merge planner** - classify every proposed update as create, refresh,
  replace, carry-forward, skip, or needs-human-review, with clear diffs for
  AGENTS sections, workflows, check maps, and repo-local customizations.
- **Skills and memory preservation** - detect `.claude`, `.codex`, `.gemini`,
  skill directories, local memory/runbook files, and tool-specific notes; carry
  useful facts into tracked repo policy when setup is being replaced.
- **Issue-Admiral / triage path** - formalize issue creation, dedupe, labeling,
  severity, and routing for new repos and upgraded repos.
- **Release / close path** - encode the finish flow for verification evidence,
  PR body updates, merge readiness, changelog fragments, and post-merge cleanup.
- **Status board agent** - render `.archon/events.jsonl`, manifests, PR state,
  and rollout status inside the local wizard once real event streams exist.
- **Dependency steward** - wire dependency review, Dependabot,
  auto-merge policy, least-privilege Actions permissions, and
  action pinning into a reviewable upgrade path.
- **Copilot and secret setup** - enable the v0.4 path for Copilot-related
  repository settings and Actions secrets, with secret values streamed directly
  to `gh secret set` and never written to disk or logs.

## Common Pitfalls

- `npx @archonvii/archon-setup` is the target launch command after npm
  publication. Until then, run from a source checkout.
- `src/snapshots/` files are read-only copies. Change upstream provider repos
  first, then refresh snapshots with `npm run refresh-snapshots`.
- The existing-repo updater intentionally updates only managed workflow callers
  that already reference `ArchonVII/github-workflows@v1`. It does not rewrite
  repo-specific `AGENTS.md` content.
- `archon-setup update` is workflow-only. Use
  `node C:\GitHub\archon-setup\bin\onboard.mjs C:\path\to\repo --audit` to
  check the selected onboarding profile; pass explicit full-process features
  when you want the full startup/process audit.
- Baseline branch protection can require PRs immediately, but named required
  checks must wait until the check has run at least once.
- A repo is not fully onboarded just because an onboarding branch or side branch
  passed. The selected baseline and any required workflow callers must exist on
  the current default branch; see
  [`docs/agent-process/deterministic-onboarding.md`](./docs/agent-process/deterministic-onboarding.md).
- Use `node bin/archon-setup.mjs tighten-required-gate --target <repo-path>`
  after the first `repo-required-gate` run. Re-running it is safe; it leaves an
  already-required gate in place and marks the manifest post-check complete.
- Use the repo-owned `npm test` script for verification. Invoking
  `node --test test/` directly can fail on this checkout because the tests are
  matched by the package script's `test/*.test.mjs` glob.
- `docs/FEATURE_REGISTRY.md` mentions `test/golden/`; the current suite uses
  `test/*.test.mjs`. Add tests in the existing pattern unless golden fixtures
  are introduced in the same change.

## Updating Existing Repos

Use the update command to refresh managed files in an existing repo after the
central ArchonVII sources change:

```bash
node C:\GitHub\archon-setup\bin\archon-setup.mjs update --target C:\path\to\repo --dry-run
node C:\GitHub\archon-setup\bin\archon-setup.mjs update --target C:\path\to\repo
```

The updater only changes workflow callers that already reference
`ArchonVII/github-workflows@v1`, and preserves repo-specific inputs such as Node
versions and script names. Bespoke local workflows, hooks, and repo-specific
`AGENTS.md` sections are skipped unless they gain an explicit managed sync path.

Use the onboard audit command when the question is whether the repo has the full
startup/process baseline:

```bash
node C:\GitHub\archon-setup\bin\onboard.mjs C:\path\to\repo --audit
node C:\GitHub\archon-setup\bin\onboard.mjs C:\path\to\repo --audit --json
```

This reports `audit.startupReadiness` without writing files. An incomplete
startup readiness status means the repo needs repair, but the command still
exits successfully unless CLI usage or repo access fails.

## Ecosystem Health Registry

The Ecosystem screen and `npm run snapshot` use
`src/server/ecosystem/repoRegistry.json` as the canonical active/inactive repo
list before falling back to a first-level `C:\GitHub` scan. Active registry
entries are collected into `ecosystem-state.json` `repos[]`; inactive entries
remain visible in `repoRegistry.repositories[]` but are not scanned as health
targets.

As of 2026-06-09, the active set is `archon`, `archon-setup`,
`github-workflows`, `repo-template`, `.github`, `pigafetta`, `jma-history`,
`skills-review` (`ArchonVII/jma-skill-review` at `C:\Users\josep\skills`), and
`hudson-bend`. `jma-ui` is explicitly marked inactive.

Override the registry for ad hoc runs with:

```powershell
npm run snapshot -- --repo-registry C:\path\to\repoRegistry.json
npm run snapshot -- --repo-registry none
```

## Global Update Distribution

Global/shared fixes, such as agent workflow rules or Codex capability guardrails,
must be recorded before they are disseminated. Each record lives in the
archon-setup global update catalog and should also be mentioned in this README
and the current `.changelog/unreleased/` fragment.

Every distributable record and every generated managed-region source cites one
or more feature IDs from `src/registry/features.json`. The marker lint and
runtime catalog both reject missing or unknown IDs, so distribution guidance
cannot establish a second, hand-maintained inventory of capability paths.

The Ecosystem screen now shows **Global Update Records**. Each record includes a
confirmation phrase and a **Distribute Fix to Ecosystem** button. The button does
not silently mutate repositories:

- The user must type the exact confirmation phrase.
- Dry-run and apply modes both return per-repo results.
- Clean non-`main` lanes can be updated automatically.
- Dirty repos, missing `AGENTS.md`, and protected `main`/`master` checkouts are
  skipped with explicit reasons such as `dirty-worktree`, `missing-agents`, or
  `protected-main`.
- Runs are appended to
  `C:\Users\<you>\.codex\archon-setup\global-update-runs.jsonl` so failures and
  skipped repos remain visible after the browser session.

Agents must ask before distributing any global fix across the full ecosystem.
If the answer is no, record the local fix and leave distribution unrun.

Mechanical distribution PRs may use the reviewed auto-merge distribution lane
only after the machine-enforced eligibility gate passes: explicit
scope-confirmation, resolved decision items, clean post-apply audit, the
`automated-distribution` label, PR body links to the decision doc and issue, and
category/path allowlists that start narrowly with AGENTS-managed regions. Agent
code PRs still use the normal reviewed close path and are not part of this
auto-merge lane.

Current recorded global fixes include:

- `2026-05-31-browser-backend-preflight` - separates Browser plugin availability
  from live browser backend availability and requires browser preflight.
- `2026-05-31-strict-pr-ready-contract` - forbids direct `gh pr ready` and
  requires the shared PR contract wrapper before ready-for-review; local draft
  validation uses a real body-file path through npm.
- `2026-06-05-owner-docs-safe-paths` - records that add-only `docs/**` files are
  owner-maintenance safe by default while explicit unsafe paths still require
  normal PR lanes.
- `2026-06-09-agent-startup-baseline` - records the selection-derived startup
  baseline contract. Its managed body cites `foundation.agents` and
  `agent-lifecycle.baseline` instead of copying a fixed path inventory, and
  defines receipt-bound, fail-closed `--carry` behavior for explicit dirty task
  inputs.
- `2026-06-10-plan-status-closeout` - records that agents must close, narrow,
  or supersede lane-created or lane-used plan/status artifacts before PR
  ready/merge.

## Ecosystem Fix Queue

Small ecosystem fixes do not need to trigger an immediate snapshot refresh every
time. `docs/ecosystem-status.md` now carries a coordinator-only Ecosystem Fix
Queue for low-urgency source-of-truth fixes that should be reviewed together
before the next `archon-setup` snapshot batch.

Use the queue when the fix belongs in `.github`, `github-workflows`,
`repo-template`, or repo-local policy first, but the downstream snapshot or
consumer distribution can wait. Each queued row records the source issue or
incident, source-of-truth target, intended fix, snapshot impact, consumer action,
and batch notes. The global update catalog remains reserved for ready
distributable AGENTS managed blocks.

## Local Workflow Validation

For PRs that change GitHub Actions workflow files, use scoped local validation:

```bash
actionlint .github/workflows/<workflow>.yml
```

`archon-setup` Doctor reports whether `actionlint` is available. It checks
`actionlint` on `PATH` first, then the standard Windows location
`C:\Tools\actionlint\actionlint.exe`. Avoid broad filesystem searches for the
binary; install it at that path or add its directory to `PATH`.

Windows setup:

```powershell
New-Item -ItemType Directory -Force C:\Tools\actionlint
# Place actionlint.exe from https://github.com/rhysd/actionlint/releases in C:\Tools\actionlint
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Tools\actionlint",
  "User"
)
```

Open a new terminal after changing `PATH`, then confirm with
`actionlint -version`.

## What this is

Today, bootstrapping an ArchonVII repo is a 5-step manual recipe (clone template → customize → run setup script → tick required checks → commit). This tool wraps that recipe behind a UI that:

- Non-developers can use (no terminal).
- Makes feature dependencies explicit (you can't enable the CHANGELOG fragment gate unless you've picked Fragment mode).
- Records exactly what got installed (`.github/archon-setup.json` in every generated repo).
- Stays decoupled from the artifacts it scaffolds — it consumes `ArchonVII/.github`, `github-workflows`, and `repo-template` as read-only snapshots.

## Status

`0.1.0-pre` — freshly built, source-runnable, and under active testing and
refinement before its first npm release. The local wizard and update command
work from a checkout; public npm publication and the final `npx` path are
deliberately held until that shakedown is done.

See [ROADMAP.md](./ROADMAP.md) for what is already built and what remains in
progress.

## Roadmap

The roadmap is organized around getting from today's source-runnable wizard to a
safe, repeatable ecosystem upgrade tool for fresh and existing repositories.

### Phase 1: Fresh Repo Baseline

Built or actively hardening:

- Generate README, LICENSE, `.gitignore`, `AGENTS.md`, `CLAUDE.md`,
  `GEMINI.md`, `.agent/coordination/README.md`, `docs/repo-update-log.md`,
  `.gitattributes`, and `.github/archon-setup.json` by default.
- Keep the repo-template `templates/**` library available as an opt-in feature
  for repos that want the standard agent, prompt, report, operations, GitHub,
  and partial templates.
- Initialize git by default; GitHub repo creation, labels, and baseline branch
  protection are explicit feature selections.
- Keep `repo-required-gate.yml`, check-map, and Node/Python/minimal CI callers
  available as opt-in managed workflows instead of installing a required gate
  into every repo.
- Run Doctor checks for `git`, `gh`, GitHub auth, Node, network access,
  `actionlint`, and target write permissions.
- Keep provider artifacts upstream: workflow bodies in `github-workflows`,
  templates in `repo-template`, org defaults in `.github`, and snapshots in this
  repo.

### Phase 2: Existing Repo Upgrade

Next major milestone:

- Audit existing repos before changing them, including GitHub Actions, CI
  scripts, branch protection, labels, issue templates, PR templates, hooks,
  protected docs, agent docs, skills, and memory/runbook files.
- Compare the repo against the selected ArchonVII baseline and its recorded
  `.github/archon-setup.json` manifest when present.
- Harvest useful repo-specific decisions from bespoke workflows, local AGENTS
  sections, CLAUDE/GEMINI addenda, `.claude`/`.codex`/`.gemini` state, local
  skills, and repo-specific process notes before applying a managed replacement.
- Offer explicit managed sync paths for workflows, check maps, docs sections,
  hooks, labels, and branch protection instead of rewriting whole files.
- Produce a dry-run plan that separates creates, updates, skipped files,
  warnings, manual follow-ups, and commands that will call `gh`.

### Phase 3: GitHub Actions, CI, And Governance

Planned expansion:

- Make `repo-required-gate / decision` the preferred required check for new
  repos after its first successful run.
- Add security and dependency workflows: dependency review, Dependabot, and
  Dependabot auto-merge.
- Add hygiene workflows: stale issue handling, locked-thread policy, and
  anomaly-to-issue conversion.
- Harden workflow callers with least-privilege permissions, pinned external
  actions, scoped tokens, and local `actionlint` validation.
- Track branch protection drift and guide the user through required-check
  updates when check names change.

### Phase 4: Agent Workflow And Process

Planned expansion:

- Promote the agent workflow bundle from baseline files into a full operating
  system for issue-first work, worktree-per-task lanes, claims, verification
  evidence, PR readiness, and closeout.
- Support repo-specific process overlays without losing the tool-agnostic
  `AGENTS.md` contract.
- Add managed sections for memory, skills, local runbooks, anomaly logs, and
  update logs so agents can carry forward existing context while replacing
  weak or contradictory policy.
- Surface which agent or automation owns each proposed change, including
  Claude, Codex, Gemini, Copilot, GitHub Actions, and future tools.

### Phase 5: Integrations And Distribution

Planned or deferred:

- Publish `@archonvii/archon-setup` so `npx @archonvii/archon-setup` becomes
  the primary launch path.
- Add a status-board view for manifests, `.archon/events.jsonl`, workflow
  state, and ecosystem rollout progress.
- Add Copilot enablement and secret setup once the v0.4 security path is ready.
- Consider a Windows installer after the npm path is stable.
- Keep `docs/ecosystem-status.md` as the cross-repo coordination snapshot and
  [ROADMAP.md](./ROADMAP.md) as the detailed product status tracker.

## Architecture

- **Runtime:** Node 20+.
- **Server:** `node:http` bound to `127.0.0.1` on an ephemeral port. Session-token-gated. POST for state changes only.
- **UI:** Single-page, React via ESM CDN (no build step in this skeleton; Vite migration is a follow-up).
- **Registry:** `src/registry/features.json` — single source of truth for what can be installed and how.
- **Planner / Executor:** Separate. The Review screen and the Execute screen consume the same plan object.
- **Snapshots:** `src/snapshots/` holds frozen copies of the three sibling repos with recorded SHAs. Refresh with `npm run refresh-snapshots`.

See `docs/FEATURE_REGISTRY.md`, `docs/RPC_CONTRACT.md`, `docs/SECURITY_MODEL.md`, `docs/MANIFEST.md`.

## License

MIT — see [LICENSE](./LICENSE).
