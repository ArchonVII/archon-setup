# AGENTS.md

Cross-tool contract for AI agents (Claude, Codex, Copilot, Gemini, etc.) working in this repo.

> Per-tool addenda live in `CLAUDE.md`, `GEMINI.md` etc. when they exist. This file holds the rules every agent must follow.

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
5. **PR body must include** `## Verification` and `### Verification Notes`, at least one `- [x]` checkbox, and `Closes #N`. Doc-only PRs (every file matches `*.md`, `*.txt`, an image extension, or `.changelog/**`) skip the ceremony.

## Verification

Before marking a PR ready:

- Run `node --test test/` and record the exact command output in `### Verification Notes`.
- For UI changes, launch `npm run dev`, exercise the wizard end-to-end with `ARCHON_SETUP_E2E=1`, and record what you exercised.
- Tick a `- [x]` box **only after** the command actually passed.
- Adversarial check: re-run the same plan twice — assert no duplicate state.

## CHANGELOG

Mode 1 (direct edit) until concurrent PRs cause merge conflicts on `CHANGELOG.md`. Then switch to Mode 2 (`.changelog/unreleased/`) and wire `changelog-fragment.yml` from `github-workflows`.

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

## Security non-negotiables

- The local server must not bind to `0.0.0.0`.
- The session token must be required on every state-changing RPC.
- Secret values entered through the UI must never touch disk or logs — they are piped directly to `gh secret set` stdin.
- File writes must validate paths against the chosen project root. No `..` traversal.
