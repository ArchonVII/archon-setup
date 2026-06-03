# Ecosystem Status — ArchonVII

_Last updated: 2026-06-02 by Claude_

The canonical "what is the ecosystem doing right now?" document for the four ArchonVII sibling repos. Update this file as part of every ecosystem-wide rollout (step 4 of the playbook below).

## Topology

Four sibling repos under [@ArchonVII](https://github.com/ArchonVII), hub-and-spoke by data flow — no master repo, but `archon-setup` is the integration hub. `archon-setup` is the only ecosystem consumer; the other three are providers.

| Repo | Role | What it covers | What exists there | What does not belong there | Update / consumption path |
| --- | --- | --- | --- | --- | --- |
| [`ArchonVII/.github`](https://github.com/ArchonVII/.github) | Org-level defaults provider | Community-health defaults that GitHub auto-applies to ArchonVII repos when the target repo does not ship its own copy. Use this for organization-wide issue, PR, release, security, profile, and document-policy defaults. | Default PR template, issue forms, issue-template config, release-notes config, `SECURITY.md`, org profile README, and `STARTER.md` document-policy guidance. | Reusable Actions workflow bodies, per-repo caller workflows, branch protection settings, and enforced `CODEOWNERS` files. GitHub does not inherit those from the org default repo. | Edit this repo first when the shared default file itself changes. Repos consume it automatically unless they override locally. `archon-setup` snapshots selected org-default docs under `src/snapshots/org-defaults/`. |
| [`ArchonVII/github-workflows`](https://github.com/ArchonVII/github-workflows) | Reusable workflow provider | The shared GitHub Actions implementation layer. Use this for workflow logic, example callers, reusable CI/security/PR-policy gates, and repo setup automation that applies GitHub labels or branch protection through `gh api`. | `workflow_call` workflow bodies under `.github/workflows/`, example caller files under `examples/`, workflow helper scripts and tests, `scripts/setup-repo.mjs`, workflow policy parsers, and the consumer-facing `v1` tag. | Repo-specific workflow customizations, generated repo docs, org community-health files, and `archon-setup` embedded snapshots. | Land provider PRs here before refreshing consumers. For compatible reusable-workflow changes, move `v1` to the merge SHA, then refresh `archon-setup` snapshots and/or update consumer caller files. |
| [`ArchonVII/repo-template`](https://github.com/ArchonVII/repo-template) | Passive baseline provider | The clone-and-go baseline for new repos and the canonical tracked file shape for generated repos. Use this for default repo structure, agent contract text, hooks, check-map defaults, changelog mode, and pre-wired caller workflows. | README skeleton, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore`, `.agent/check-map.yml`, `.githooks/`, `.github/workflows/` callers, Dependabot config, `CODEOWNERS`, ADR placeholders, and `docs/repo-update-log.md`. | Reusable workflow internals, org default issue/PR templates, local-server onboarding code, and one-off consumer repo overrides. | New repos can start from the GitHub template directly. `archon-setup` also snapshots this repo under `src/snapshots/repo-template/` and uses it as managed baseline material for scaffold/update plans. |
| [`ArchonVII/archon-setup`](https://github.com/ArchonVII/archon-setup) | Integration hub and consumer | The user-facing onboarding/update tool and the coordination hub for ecosystem state. Use this for the local wizard, headless onboarding, feature registry, planner/executor behavior, managed update records, snapshot refreshes, and this status document. | `bin/archon-setup.mjs`, `bin/onboard.mjs`, the local RPC server, feature registry, task planner/executor modules, tests, source snapshots from the three providers, global update catalog, repo onboarding docs, ecosystem snapshot tooling, and `docs/ecosystem-status.md`. | Source-of-truth workflow bodies, org defaults, and repo-template baseline prose outside `src/snapshots/`. If a snapshot is stale or wrong, fix the provider first and run `npm run refresh-snapshots`. | Pull provider `main` branches, run `npm run refresh-snapshots`, test, and land an `archon-setup` PR. Generated or upgraded repos consume the result through the wizard, `npm run onboard`, or the update/distribution commands. |

## Rollout playbook

Every ecosystem-wide change follows this order. Skip steps that don't apply, but never reorder them.

1. **Provider repo PRs.** Land changes upstream first — in `.github`, `github-workflows`, and/or `repo-template`. Capture each squash-merge SHA.
2. **Version/tag update if needed.** When a `github-workflows` change must reach consumers, force-move the `v1` tag to the merge SHA:
   ```
   gh api -X PATCH repos/ArchonVII/github-workflows/git/refs/tags/v1 \
     -f sha=<merge-sha> -F force=true
   ```
   Verify with `gh api repos/ArchonVII/github-workflows/git/refs/tags/v1`. Anything depending on `@v1` now sees the new workflow.
3. **`archon-setup` snapshot refresh.** Pull provider `main` branches locally, then in `archon-setup`:
   ```
   git -C ../github-workflows pull
   git -C ../repo-template pull
   git -C ../.github pull
   npm run refresh-snapshots
   node --test 'test/*.mjs'
   ```
   Commit as `chore(snapshots): refresh after <upstream PRs>`. Open + merge the archon-setup PR.
4. **Update `ecosystem-status.md`.** This file. Move shipped items into Recently Completed, refresh in-flight PR state, record any decisions made.
5. **Issue cleanup / dedupe.** Close issues that the rollout resolved, dedup any stragglers, label what remains.

Notes:

- `scripts/refresh-snapshots.mjs` writes only `source`/`ref`/`sha`/`capturedAt`/`path` in `manifest.json`. Hand-added fields (e.g. `contents`) are dropped on refresh.
- For agent-managed code PRs in providers, do not self-merge (see [Owner Maintenance Lane decision](#decision-log)).
- The exemplar three-repo rollout is the v0.1.1 anomaly-triage capability (2026-05-13): `github-workflows#2 → 7fc2dea`, `repo-template#2 → bfc226d`, `archon-setup#2 → 29ba240`.

## Active workstreams

| Repo               | Status        | Detail                                                                                                                                         |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-workflows` | In progress   | PR #35 is ready for review and documents the current release/agent lifecycle gaps; strict PR contract PR #39 landed at `90c0a89` and `v1`.     |
| `archon-setup`     | Clean on main | PR #67 refreshed strict PR contract snapshots to `github-workflows@90c0a89`, `repo-template@a328461`, and `.github@792fc81`.                   |
| `repo-template`    | Clean on main | Strict PR contract PR #30 landed at `a328461`; baseline AGENTS/hooks/check-map exist and lifecycle commands/claims schema remain planned work. |
| `.github`          | Clean on main | Strict PR contract PR #23 landed at `792fc81`; role/lane policy exists and executable-vs-marker taxonomy still needs clarification.            |

## In-flight PRs

None.

## F-roadmap

Feature IDs come from the `docs/phase2/findings.md` numbering. Severity reflects the original finding.

| ID  | Title                                          | Status                                                 | Severity | Tracking issue                                         |
| --- | ---------------------------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------ |
| F1  | `repo-ci.*` features in registry               | **Shipped**                                            | —        | archon-setup #19 (`0510307`)                           |
| F2  | `pr-policy` evidence enforcement               | **Shipped (Phase 1 warning/evidence path)**            | high     | github-workflows #10; PR #19/#22                       |
| F3  | actionlint workflow + caller                   | **Shipped**                                            | medium   | repo-template #17, archon-setup #18                    |
| F4  | Format-on-edit authority duplication           | Open                                                   | medium   | `.github` #11                                          |
| F5  | Demote lint-on-edit to advisory                | Open                                                   | medium   | `.github` #12                                          |
| F6  | Close-scan marker semantics                    | Open                                                   | medium   | `.github` #13                                          |
| F7  | Agent role separation / Owner Maintenance Lane | **Partially shipped; `.github` scoped policy remains** | high     | `.github` #14; github-workflows #26; repo-template #21 |
| F8  | Worktree-per-task discipline                   | Open                                                   | medium   | `.github` #15                                          |
| F9  | Extended claim schema baseline                 | Open                                                   | medium   | repo-template #14                                      |
| F10 | Verification evidence format                   | **Shipped (paired with F2 Phase 1)**                   | medium   | github-workflows #12; PR #19/#22                       |
| F11 | Release-Admiral "finish it" merge contract     | Open                                                   | medium   | `.github` #16                                          |
| F13 | `.agent/check-map.yml` + recommender           | Open                                                   | medium   | repo-template #12                                      |
| F14 | Single targeted-ci-gate required check         | **Shipped; `v1` moved 2026-05-29**                     | medium   | github-workflows #8/#23                                |
| F15 | Actions hardening (least-priv, SHA-pin, …)     | Open                                                   | medium   | github-workflows #14                                   |
| F16 | Per-PR durable history records                 | Open                                                   | low      | `.github` #17                                          |
| F18 | `.githooks/` baseline                          | **Shipped**                                            | —        | repo-template #16/#18                                  |
| F19 | Issue-Admiral triage role                      | Open                                                   | low      | `.github` #18                                          |

## Backlog (prioritized)

1. **Land `github-workflows` PR #35** — preserve the lifecycle accounting, then execute the linked lifecycle implementation issues.
2. **Template walkthrough** — refresh issue forms against the new F2/F10 evidence shape and F7 owner-lane semantics after the strict PR contract lands.
3. **F7 `.github` policy work** — finish `.github` #14 scoped policy now that the reusable workflow and template pieces are shipped.
4. **Branch-protection 400 anomaly** — file via the anomaly-triage workflow on next `archon-setup` PR. Reference fix already exists in `archon-setup/src/server/tasks/applyBaselineBranchProtection.mjs`.
5. **Events-stream rollout** — _archon-setup side shipped (#89):_ a best-effort `appendEvent` emitter, `collectEvents`, a "Recent events" render section, and `docs/archon-events-convention.md`. Remaining: the provider-side `.archon/events.jsonl` schema in `repo-template` AGENTS.md (companion PR) and gitignoring `.archon/` in generated repos.

## Recently completed

- **2026-06-02** — Distribution/lifecycle rollout landed in `archon-setup`: no-remote smoke-test policy + leaked-repo cleanup (#81), npm publication prep (#83), workflow drift detection + upgrade (#87), `.archon/events.jsonl` stream + ecosystem "Recent events" view (#89), thin Windows `npx` bootstrap `install.ps1` (#91), staged-disabled Copilot/secrets (#93), and the agent-lifecycle baseline (#64). Owner-gated remainder: delete the five leaked smoke-test repos, `npm publish`, and real secret values.
- **2026-05-31** — `archon-setup` issue #59 completed through merged PR #60; snapshot manifest now records `github-workflows@v1` `00fbaab`, `repo-template` `7aa1e91`, and `.github` `0717902`.
- **2026-05-31** — Strict PR contract provider rollout landed across `github-workflows` #39, `repo-template` #30, and `.github` #23; `archon-setup` #67 refreshed snapshots to `github-workflows@90c0a89`, `repo-template@a328461`, and `.github@792fc81`.
- **2026-05-29** — Moved `github-workflows` `v1` to `007ad49` after the F14/F7 workflow merges and shipped `archon-setup` #29 to refresh snapshots for #28.
- **2026-05-28** — `github-workflows` role-separation PR #27 and `repo-template` Owner Maintenance Lane PR #22 merged.
- **2026-05-21** — `github-workflows` F14 targeted-gate lanes PR #23 merged.
- **2026-05-20** — `github-workflows` F2/F10 Phase 1 evidence parser work entered review.
- **2026-05-19** — Required-gate baseline landed in `repo-template` (PR #15) and `archon-setup` (`9efb514`).
- **2026-05-19** — `.githooks/` baseline (commit-msg + main guard) merged in `repo-template` (#16/#18). F18 shipped.
- **2026-05-19** — F3 actionlint workflow-syntax check merged in `repo-template` (#17) + archon-setup snapshot caller (#18).
- **2026-05-19** — F1 `repo-ci.*` features added to archon-setup registry (#19).
- **2026-05-14** — ArchonVII workflow baseline adopted by `comfyui-companion` (PR #41) and `pigafetta-gravity` (PR #35). First downstream consumers beyond the four ecosystem repos.
- **2026-05-13** — v0.1.1 anomaly-triage capability shipped across three coordinated PRs (`github-workflows#2 → 7fc2dea`, `repo-template#2 → bfc226d`, `archon-setup#2 → 29ba240`). Exemplar three-repo rollout.
- **2026-05-13** — `archon-setup` v0.1.0 scaffold shipped.

## Decision log

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-02 | **No-remote smoke-test policy (#43).** Smoke tests must not create persistent GitHub repos. The fresh-repo remote path is exercised hermetically against a local bare repo via a `gh` mock; any live-GitHub smoke test is opt-in, uses exactly one repo, and must stop if it cannot delete. The five repos leaked by PR #41 are one-time manual cleanup via `scripts/cleanup-smoketest-repos.mjs`. | Removes the leaked-repo failure mode at the root instead of adding cleanup machinery, avoids granting broad `delete_repo` authority to agent sessions, and keeps CI reproducible without GitHub API/auth flakiness. |
| 2026-05-31 | Strict PR readiness is enforced as executable policy, not agent memory: one shared validator, blessed ready wrapper, and expensive CI behind the cheap contract.                                                                                                                                                                                                                                   | Malformed ready-for-review transitions cost paid CI and have recurred; invalid PR metadata must be unrepresentable through the blessed path.                                                                        |
| 2026-05-31 | Move `github-workflows` `v1` to `00fbaab` after node-ci cache manager auto-detection PR #33.                                                                                                                                                                                                                                                                                                       | Keeps generated `@v1` callers aligned with the current reusable Node CI behavior without changing caller files.                                                                                                     |
| 2026-05-29 | Move `github-workflows` `v1` to `007ad49` after F14 and F7 because the changes are additive/default-warning-only and current snapshot callers depend on new reusable-workflow inputs and helper scripts.                                                                                                                                                                                           | Keeps `@v1` callers and helper-script checkout refs version-aligned; avoids generating callers that pass inputs unsupported by the old tag.                                                                         |
| 2026-05-20 | This `ecosystem-status.md` is the canonical "what's the ecosystem doing" doc. Lives in `archon-setup/docs/` because that repo is the integration hub.                                                                                                                                                                                                                                              | Resolves where ecosystem-wide coordination state belongs. No fifth "master" repo.                                                                                                                                   |
| 2026-05-17 | **Owner Maintenance Lane (F7).** Solo-dev policy of three lanes (Owner / Agent-managed / Default), enforced by path scope, not author identity. Owner lane allows direct `main` commits for add-only safe docs/images; agent-managed code PRs hard-block self-merge.                                                                                                                               | A universal self-merge block would prevent legitimate GitHub Desktop maintenance and can't distinguish agent from human commits under the same identity.                                                            |
| 2026-05-14 | Phase 2 review findings tracked as `phase2`-labeled issues, F-numbered from `docs/phase2/findings.md`.                                                                                                                                                                                                                                                                                             | Single numbering scheme across `.github` + `github-workflows` + `repo-template`.                                                                                                                                    |
| 2026-05-13 | Tool-agnostic capabilities ship as **reusable workflow + AGENTS.md contract** — never as a per-CLI skill.                                                                                                                                                                                                                                                                                          | A capability shipped as "a Claude skill on the user's machine" excludes Codex, Gemini, and future agents. Workflows + contracts are read by every agent.                                                            |
| 2026-05-13 | `archon-setup` is the only consumer of the other three; the others are providers. SHA-pinned snapshots under `src/snapshots/`.                                                                                                                                                                                                                                                                     | Deterministic archon-setup builds without coupling provider release cadence.                                                                                                                                        |

## Parking lot

Ideas discussed but not yet planned:

- **Native Windows installer** for `archon-setup` (winget/scoop or Inno Setup `.iss`). The thin `npx` bootstrap (`install.ps1`, #91) shipped; native installers stay deferred (design-only stubs in `docs/installer/`).
- **Status board UI** — a minimal "Recent events" section now renders in the ecosystem snapshot (#89); a richer interactive board remains deferred to v0.2 once real events accumulate.
- **`rollout-playbooks/` subdirectory** — split out per-capability playbooks if more than one accumulates. Single inline playbook above is sufficient for now.
- **Re-enable `react/no-unescaped-entities`** in `comfyui-companion` after fixing the apostrophes in `web/src/{FilesBrowser,Groups}.tsx`.

## Updating this doc

This file is the canonical ecosystem status — but it's only as fresh as the last person who touched it. Update on:

- **Step 4 of every rollout** (mandatory).
- After any cross-repo decision (add a row to the Decision log).
- When any phase2 issue's status changes (Open → In flight → Shipped — row moves).
- When a new repo joins or leaves the ecosystem (update Topology, start/stop tracking).

Keep entries terse. Detail belongs in the relevant repo's `repo-update-log.md`, in the PR description, or in agent memory.
