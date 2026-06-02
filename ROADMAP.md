# Roadmap

Last updated: 2026-05-31.

This roadmap tracks the `archon-setup` product surface: the local wizard and
update tooling that scaffold ArchonVII repositories.

## Built

- **Source-runnable CLI** - `node bin/archon-setup.mjs`, `npm start`, and
  `npm run dev` launch the local server from a checkout.
- **Update command** - `node bin/archon-setup.mjs update --target <repo>`
  refreshes managed workflow callers that reference
  `ArchonVII/github-workflows@v1`.
- **Token-gated local server** - binds to `127.0.0.1`, generates a per-launch
  session token, validates RPC Origin/Host, and requires POST for
  state-changing RPCs.
- **Browser wizard skeleton** - Doctor, Location, Features, Review, and Execute
  screens are wired through the local UI.
- **Native folder picker** - the Location screen can open a Windows folder
  dialog while keeping the text field as the canonical fallback.
- **Preflight checks** - git, GitHub CLI, GitHub auth, Node, network,
  `actionlint`, and target path checks are implemented.
- **Feature registry** - `src/registry/features.json` is the single source of
  truth for installable features, dependencies, conflicts, created files, and
  task mapping.
- **Planner and executor split** - the Review screen and Execute screen consume
  the same normalized plan; task execution streams progress events.
- **Foundation file tasks** - README, LICENSE, `.gitignore`, `AGENTS.md`,
  `CLAUDE.md`, `GEMINI.md`, `.agent/check-map.yml`, and
  `.github/archon-setup.json` can be generated.
- **Fresh-repo baseline parity** - the default foundation set also installs
  repo-template parity files: `.githooks/`, `.gitattributes`, changelog
  fragments, CODEOWNERS when an owner is known, Dependabot, PR template, and
  actionlint.
- **Remote setup tasks** - git init, initial commit, GitHub repo creation,
  initial push, standard labels, and baseline branch protection are implemented.
- **Workflow installation tasks** - managed caller workflows can be installed
  from snapshots of `ArchonVII/github-workflows`.
- **Snapshot refresh** - `npm run refresh-snapshots` refreshes provider snapshots
  from `.github`, `github-workflows`, and `repo-template`.
- **Self-CI** - `.github/workflows/node-ci.yml` runs the package test suite on
  PRs and `main` through `ArchonVII/github-workflows@v1`.
- **Tests** - Node tests cover registry invariants, safe paths, actionlint
  preflight discovery, managed-file updates, and AGENTS generation.
- **Headless existing-repo audit** - `npm run onboard -- <repo> --audit`
  reports planned baseline files as present, missing, or drifted without
  writing.
- **Existing-repo target decoupling** - workflow callers can be installed for an
  existing GitHub repo without selecting the repo-create task; labels and
  branch protection target explicit or detected `owner/repo`.
- **Managed agent-doc reconciliation** - existing `AGENTS.md` and `CLAUDE.md`
  files can receive ArchonVII managed blocks while preserving repo-specific
  content outside the blocks.
- **Required-gate tightening command** - `node bin/archon-setup.mjs
tighten-required-gate --target <repo>` marks `repo-required-gate / decision`
  required after GitHub has seen the check run.
- **Global update records** - the Ecosystem screen records shared
  agent/workflow fixes and can dry-run or distribute eligible updates with
  explicit confirmation and per-repo result logs.
- **Strict PR contract snapshots** - provider snapshots include the shared
  strict PR-ready contract, wrapper guidance, and updated PR templates from
  `github-workflows`, `repo-template`, and `.github`.

## In Progress

- **npm publication** - `npx @archonvii/archon-setup` is the intended launch
  command, but the package is not published to npm yet.
- **End-to-end wizard hardening** - the fresh-repo remote path now has a
  hermetic smoke test (`test/smokeFreshRepo.test.mjs`) that runs against a local
  bare repo via a `gh` mock, creating no real GitHub repo (#43). Policy: smoke
  tests never create persistent repos; a live-GitHub run is opt-in, one repo,
  and must stop if it cannot delete. Future remote changes should keep dry-run,
  execute, and rerun coverage on this hermetic harness.
- **Existing-repo browser UX** - headless/tooling support is built; issue #68
  tracks surfacing the same audit and existing-repo confirmation path in the
  browser wizard.
- **Branch protection/ruleset audit** - issue #65 tracks making hub repo
  protection and ruleset state visible in audit/status output.
- **Agent lifecycle baseline** - issue #64 tracks installing, updating, and
  auditing lifecycle files after the provider repos own the command surface.
- **Roadmap/status reconciliation** - `docs/ecosystem-status.md` remains the
  cross-repo ecosystem status file; this roadmap is the product roadmap for this
  repo.
- **Test guidance cleanup** - `docs/FEATURE_REGISTRY.md` still references a
  future `test/golden/` pattern while current tests live under `test/*.test.mjs`.

## Planned / Deferred

- **Workflow drift upgrades** - use recorded snapshot SHAs to identify and
  upgrade stale managed workflows.
- **Events stream support** - add `.archon/events.jsonl` conventions and a
  status-board view once real events accumulate.
- **Copilot and secret setup** - deferred until the v0.4 path; secrets must go
  directly to `gh secret set` and never touch disk or logs.
- **Packaged distribution** - publish the npm package and then make `npx` the
  primary quickstart.
- **Windows installer** - explicitly deferred beyond the initial `npx` releases.

## Operating Rules

- Provider artifacts stay upstream: workflows in `github-workflows`, AGENTS
  template content in `repo-template`, and org defaults in `.github`.
- `archon-setup` consumes provider snapshots; do not hand-edit snapshot copies.
- `AGENTS.md` is the generated cross-tool authority. `CLAUDE.md` and `GEMINI.md`
  are pointer addenda, not independent policy sources.
