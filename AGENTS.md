# AGENTS.md

Cross-tool contract for AI agents (Claude, Codex, Copilot, Gemini, etc.) working in this repo.

> Per-tool addenda live in `CLAUDE.md`, `GEMINI.md` etc. when they exist. This file holds the rules every agent must follow.

<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->
<!-- BEGIN MANAGED AGENT START MAP -->

## Agent Start Map

Agents should not spend time rediscovering the process files. Start here:

- Plans: `docs/plans/`
- Agent process: `docs/agent-process/`
- Repo update log: `docs/repo-update-log.md`
- Check map: `.agent/check-map.yml`
- Coordination: `.agent/coordination/README.md`
- PR process: `.github/PULL_REQUEST_TEMPLATE.md`
- Agent scripts: `scripts/agent/`
- Close guards: `scripts/close/`
- Doc sweep: `scripts/doc-sweep/`
- Legacy plans: `docs/superpowers/plans/` is history only; do not add new implementation plans there.
- Friction ledger: for a non-bug workflow hiccup, append one row to `.claude/friction.md`, do not fix it mid-task, and keep working; bugs/security or off-task defects still go to `.archon/anomalies-thispr.md`.

If these files are missing or unclear, stop searching and run:

```text
node <path-to-archon-setup>/bin/onboard.mjs <repo> --audit
```

<!-- END MANAGED AGENT START MAP -->
<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->

## What this repo is

`archon-setup` is a plug-and-play repo bootstrapper for the ArchonVII ecosystem. It's a Node-based local web wizard (`npx @archonvii/archon-setup`) that scaffolds a new repository — files, git init, `gh` remote, labels, branch protection — driven by a dependency-aware feature registry.

It is the fourth ArchonVII sibling alongside:

- `ArchonVII/.github` — org defaults
- `ArchonVII/github-workflows` — reusable workflows (consumed at `@v1`)
- `ArchonVII/repo-template` — passive clone-target template

This repo treats those three as read-only sources of truth. Snapshots live under `src/snapshots/` with recorded SHAs.

## Read first

- `README.md` — what this is and how to run it
- `docs/FEATURE_REGISTRY.md` — how features are defined and consumed
- `docs/RPC_CONTRACT.md` — the local-server RPC surface
- `docs/SECURITY_MODEL.md` — why the server is token-gated
- `docs/MANIFEST.md` — what the generated repo gets

## Foundation decisions (locked)

1. The feature registry (`src/registry/features.json`) is the single source of truth. UI renders it, planner consumes it, tests assert against it. Never duplicate feature data anywhere else.
2. Planner and executor are separate. Review screen and Execute screen consume the **same plan object**.
3. Every generated repo gets `.github/archon-setup.json` recording tool version, source SHAs, selected features, created files, remote actions.
4. Every task implements `plan() / check() / apply() / verify() / rollbackHint()`. Re-running the same plan must never duplicate state.
5. The local RPC server binds to `127.0.0.1`, requires a per-launch session token, validates Origin/Host, and uses POST for state-changing RPCs only.
6. v0.1 and v0.2 ship as `npx` only. No `pkg`, no SEA, no installer yet.
7. Copilot enablement and secret entry are deferred to v0.4.
8. Branch protection applied during scaffold is **baseline only**. Named required status checks are deferred until at least one check has run.

## Workflow

1. **Issue first.** Create a GitHub issue with `Acceptance Criteria` before branching. Use the `Task` issue form.
2. **One issue → one branch → one PR.** Branch name: `agent/<tool>/<issue>-<slug>` (e.g. `agent/claude/12-doctor-screen`).
3. **Never commit to `main`.** Branch protection enforces this once wired.
4. **Conventional Commits.** `<type>(<scope>): <description>` where `<type>` is one of `feat fix refactor test docs style chore perf ci build revert`.
5. **PR metadata must pass the shared contract before ready-for-review.** Non-doc PRs must use this exact body order: `## Summary`, `## Verification`, `### Verification Notes`, `## Docs / Changelog`, and an issue link (`Closes #N`, `Fixes #N`, or `Refs #N`). The PR title must use Conventional Commits. Each checked verification box must be backed by concrete command/check/manual evidence, and placeholders such as TODO/TBD/N/A must be gone. Doc-only PRs (every file matches `*.md`, `*.txt`, an image extension, or `.changelog/**`) skip the body ceremony but still need a valid title and branch.

## Startup

- Start with `npm run agent:status` from the repo root to confirm branch,
  upstream, dirty state, PR/task state, startup map, and next action.
- If lifecycle/startup files are missing or `agent:status` is unavailable, run
  `npm run onboard -- . --audit` to inspect the full startup/process baseline.
- `archon-setup update` is workflow-only. Do not use it for startup/process
  repair, lifecycle scripts, doc-sweep files, or AGENTS startup-map repair.

## Verification

Before marking a PR ready:

- Run `npm test` and record the exact command output in `### Verification Notes`.
- For workflow file changes, run scoped validation with `actionlint <workflow-files>`.
  Do not search the whole filesystem for the binary. Use `actionlint` on `PATH`,
  or on Windows install it at `C:\Tools\actionlint\actionlint.exe` and add
  `C:\Tools\actionlint` to `PATH`.
- For UI changes, launch `npm run dev`, exercise the wizard end-to-end with `ARCHON_SETUP_E2E=1`, and record what you exercised.
- Tick a `- [x]` box **only after** the command actually passed.
- Adversarial check: re-run the same plan twice — assert no duplicate state.
- For `refresh --execute` changes, verify at least `--local-only` against a repo
  with a local bare `origin`; `--pr-only` must prove no auto-merge call, and
  auto mode must prove pending/missing required checks leave the PR open with a
  resumable run record.
- Do **not** run `gh pr ready` directly. Run the blessed wrapper so
  malformed PRs cannot trigger paid or expensive ready-for-review checks:

  ```powershell
  npm run agent:close-preflight -- --repo ArchonVII/archon-setup --pr <number>
  npm run agent:pr-ready -- --repo ArchonVII/archon-setup --pr <number>
  ```

  If the npm wrapper scripts are missing, add this repo's portable wrapper
  setup first. Do not substitute direct `gh pr ready` or machine-local
  command paths.

## CHANGELOG

Mode 1 (direct edit) until concurrent PRs cause merge conflicts on `CHANGELOG.md`. Then switch to Mode 2 (`.changelog/unreleased/`) and wire `changelog-fragment.yml` from `github-workflows`.

## Global Workflow Updates

- When changing global/shared agent, workflow, onboarding, skill, or ecosystem
  policy that should be distributed into consumer `AGENTS.md` files, record the
  update in this repo's global update catalog, README, and CHANGELOG in the same
  PR. Coordinator-only process changes update README, CHANGELOG, and
  `docs/ecosystem-status.md` instead.
- Use the Ecosystem Fix Queue in `docs/ecosystem-status.md` for low-urgency
  source-of-truth fixes that should be reviewed together before the next
  `archon-setup` snapshot refresh. Do not run `npm run refresh-snapshots` for
  every small provider/doc change by default; fix the provider first, queue the
  snapshot impact, and batch the refresh unless the owner asks for an immediate
  one or the change unblocks active work.
- Atomic commits are not atomic PRs. Companion docs, changelog, roadmap, status,
  and update-log edits that describe the same issue phase or slice belong in
  that same PR, usually as final commits after verification. Open a separate PR
  only for a separate issue/phase, unrelated housekeeping, or material review
  risk expansion.
- Ask the user explicitly before disseminating a global fix across the full
  ecosystem. Do not assume a local/global config fix should be pushed into every
  repo without confirmation.
- Distribution must produce auditable per-repo results: applied, unchanged,
  skipped, or failed with a concrete reason. Silent best-effort sync is not
  acceptable.
- Do not apply global update blocks directly to protected `main` checkouts.
  Use clean branch/worktree lanes and normal PR review, or skip with an explicit
  `protected-main` reason.

## Commit hygiene

- One logical unit per commit. If the message needs "and," split it.
- Stage specific files: `git add <path> <path>`. Never `git add -A`.
- Don't bypass hooks (`--no-verify`, `--no-gpg-sign`). Fix the underlying issue.

## When stuck

If the same approach fails twice, stop. Switch tactics, ask the user, or document what you tried in the issue.

## Source-of-truth boundaries

- **Workflow YAML bodies** live in `ArchonVII/github-workflows/examples/*.yml`. We never re-author them here — only embed snapshots.
- **AGENTS.md template content** lives in `ArchonVII/repo-template/AGENTS.md`. Same rule.
- **Org defaults** (issue templates, SECURITY, release.yml) live in `ArchonVII/.github`. Same rule.
- `scripts/refresh-snapshots.mjs` is the only place that pulls these in.

If you find yourself editing a workflow `.yml` inside `src/snapshots/`, **stop** — fix it in `github-workflows` upstream and re-run `npm run refresh-snapshots`.

### Root baseline = snapshot, mechanically

This repo's own root copies of the agent baseline (`scripts/agent/*`,
`scripts/doc-sweep/*`, `.agent/startup-baseline.json`, the `agent:*` package
scripts) are **derived from the repo-template snapshot, never hand-edited**.
The update flow, end to end:

1. Fix the provider: PR to `ArchonVII/repo-template`.
2. `npm run refresh-snapshots` — machine-writes `src/snapshots/` (the integrity
   gate refuses if the existing snapshot doesn't match its manifest pin).
3. `npm run agent:self-apply` — repairs the root copies from the snapshot via
   the same installer code paths consumers get (`--check` for a read-only
   drift report).
4. Commit. `test/agentLifecycleScripts.test.mjs` audits the result: root must
   equal snapshot byte-for-byte.

Never hand-edit `src/snapshots/**` or the root copies — not even to apply a
review fix in lockstep. Route the fix upstream first (see #197/#199 for how
that went wrong).

## Security non-negotiables

- The local server must not bind to `0.0.0.0`.
- The session token must be required on every state-changing RPC.
- Secret values entered through the UI must never touch disk or logs — they are piped directly to `gh secret set` stdin.
- File writes must validate paths against the chosen project root. No `..` traversal.
