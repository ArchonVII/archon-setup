# Roadmap

Last updated: 2026-06-05.

This roadmap tracks the `archon-setup` product surface: the local wizard and
update tooling that scaffold ArchonVII repositories.

## Built

- **Source-runnable CLI** - `node bin/archon-setup.mjs`, `npm start`, and
  `npm run dev` launch the local server from a checkout.
- **Windows `npx` bootstrap** - `install.ps1` checks Node >= 20 + `gh` and
  launches `npx @archonvii/archon-setup` (with a `-DryRun` switch). Ships in the
  package; see `docs/WINDOWS_INSTALL.md`. Native installers stay deferred.
- **Events stream** - a best-effort append-only `.archon/events.jsonl` per repo
  (`{ts,type,actor,ref,detail}`); the executor emits plan/task lifecycle events
  and the ecosystem snapshot renders a "Recent events" section. See
  `docs/archon-events-convention.md`.
- **Update command** - `node bin/archon-setup.mjs update --target <repo>`
  refreshes managed workflow callers that reference
  `ArchonVII/github-workflows@v1`.
- **Workflow drift detection + upgrade** - `update --check` classifies each
  managed caller as current / drifted / unmanaged against the recorded snapshot
  (exits non-zero on drift, so it gates CI / pre-push); `update --upgrade`
  rewrites drifted callers to the snapshot, re-injecting budget defaults. Both
  honor `--dry-run`. Customizations beyond budget defaults are discarded on
  upgrade — use plain `update` to preserve custom inputs.
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
- **Agent lifecycle baseline (#64)** - the default `agent-lifecycle.baseline`
  feature installs the four `scripts/agent/*` lifecycle scripts and merges the
  three `agent:*` npm entries into the target `package.json`; existing-repo
  audit reports them via the `entries` comparison (present/missing/drifted).

## In Progress

- **Granular marker-based distributor (#145)** - a repo-owned-by-default
  `distribute` capability that updates only ArchonVII-managed regions
  (`BEGIN`/`END ARCHONVII MANAGED: <id>` markers) and surfaces conflict/adoption
  instead of the `update --upgrade` clobber (which discards intentional repo
  customization). PR1 shipped the pure layer (region engine, file adapters,
  marker lint/manifest); the `distribute` subcommand and per-group provider
  markup follow. Design:
  `docs/superpowers/specs/2026-06-09-granular-distributor-design.md`.

- **npm publication** - the publication prep merged (#82/#83): `npx` quickstart,
  a `prepublishOnly` gate, the `npm pack` tarball guard, and a manual-dispatch
  `publish.yml`. The actual `npm publish` stays owner-gated (NPM_TOKEN + version
  bump).
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
- **Roadmap/status reconciliation** - `docs/ecosystem-status.md` remains the
  cross-repo ecosystem status file; this roadmap is the product roadmap for this
  repo. Reconciled with the distribution/lifecycle rollout 2026-06-02.
- **Test guidance cleanup** - `docs/FEATURE_REGISTRY.md` still references a
  future `test/golden/` pattern while current tests live under `test/*.test.mjs`.

## Planned / Deferred

- **Copilot and secret setup** - **staged disabled for v0.4.** The
  `enableCopilot` (org-only + manual checklist) and `setRepoSecrets` tasks are
  registered (`disabled: true`) and tested; secrets ride `gh secret set` stdin
  and never touch disk, argv, or logs. Activation (flip `disabled`, org billing,
  real secret values) is owner-gated.
- **Packaged distribution** - publish the npm package and then make `npx` the
  primary quickstart.
- **Native Windows installer** - winget/scoop submission is deferred until
  archon-setup ships a standalone binary; design-only stubs live in
  `docs/installer/`. The thin `npx` bootstrap (`install.ps1`, shipped) is the
  supported Windows path until then.

## Pre-Launch Backlog

Owner-gated work to run through before the first public release; the npm publish
in **In Progress** is the gate these feed. Tracked as issues #114-#121.

1. **Template cohesion audit** (#114) - Review every shipped template (foundation
   files, provider snapshots, `_partials`, agent docs) end-to-end for cohesion and
   consistency. Produce a punch list of fixes so source templates and generated
   output agree on both ends.
2. **Test repos / real-repo onboarding** (#115) - Stand up the planned test
   repositories and run full fresh-repo and existing-repo onboarding against them.
   Builds on the hermetic smoke (#43) and shakedown harness (#109); broaden to
   real-repo validation.
3. **Skill-bundle sessions ("skill profiles")** (#116) - Launch a session (local
   terminal, cloud harness, or Codex harness) preloaded with a curated skill set
   (e.g. all wiki skills) without manual install/uninstall each time. Research the
   mechanism: per-session skill manifests, skill/plugin groups, marketplace
   profiles, or harness config. Feasibility TBD - research + prototype.
4. **Per-component cost/time evaluation** (#117) - Measure token cost and added
   latency per part (skills, hooks, workflows, templates, generated docs); cut
   what isn't worth its weight.
5. **Incorporate the LLM wiki schema** (#118) - Fold in the LLM wiki schema built
   in `pigafetta-history` (jma-history). Open: pin the artifact - the only tracked
   schema there (`canon/narrative-events.schema.json`) is a vendored narrative
   canon, not a wiki schema; the "wiki" is the Librarian brief system. Confirm
   referent before starting.
6. **Document-architecture research** (#119) - Survey current best practice for
   the MD doc stack - memory, instructions, guidelines, policies, repo
   function/structure (AGENTS/CLAUDE/GEMINI, memory, policy docs) - and find where
   to improve and innovate.
7. **Confirm LLM gateway** (#120) - Verify the LLM gateway is available and working
   (availability + smoke test). Open: identify the referent - no `llm-gateway`
   repo exists; candidates are the vision-gateway MCP, the gemini/codex/
   pigafetta-manager MCP servers, or a local service on ports 7878/8765.
8. **Conciseness pass** (#121) - Trim character count and unnecessary language
   across everything (templates, docs, skills, generated files).

## Operating Rules

- Provider artifacts stay upstream: workflows in `github-workflows`, AGENTS
  template content in `repo-template`, and org defaults in `.github`.
- `archon-setup` consumes provider snapshots; do not hand-edit snapshot copies.
- `AGENTS.md` is the generated cross-tool authority. `CLAUDE.md` and `GEMINI.md`
  are pointer addenda, not independent policy sources.
