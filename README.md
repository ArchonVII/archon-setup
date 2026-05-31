# archon-setup

Plug-and-play repo bootstrapper for the ArchonVII ecosystem.

A local browser wizard that scaffolds a new repository — files, git init, `gh` remote, labels, branch protection — driven by a dependency-aware feature registry.

## First End Goal

The first product end goal is a safe ArchonVII repo upgrade path:

> Given a fresh repository or an existing repository, `archon-setup` should be
> able to bring it onto the ArchonVII ecosystem baseline for GitHub workflow,
> CI, agent process, documentation, and repository governance while preserving
> repo-specific edits, local skills, memory files, custom workflows, and existing
> policy information unless the user explicitly approves a managed replacement.

That means the tool must be useful for both new projects and lived-in repos. It
should audit first, explain what it found, show an exact plan, apply only the
selected changes, and leave enough manifest/history data for a future agent or
human to understand what was installed and what was intentionally skipped.

## Quickstart

Current source checkout command:

```bash
npm start
```

Equivalent direct command:

```bash
node bin/archon-setup.mjs
```

The intended published command is:

```bash
npx @archonvii/archon-setup
```

As of 2026-05-28, the package is still pre-release and is not published to npm,
so use the source checkout commands above.

Your default browser opens to a local URL. The wizard walks you through:

0. **Doctor** — confirms `git`, `gh`, optional `actionlint`, network, and write permissions are good.
1. **Location** — where to scaffold, repo name, public/private.
2. **Features** — checkbox tree (Foundations, GitHub remote, PR contract, …).
3. **Review** — exactly what files will be created and commands run.
4. **Execute** — streaming progress.

Nothing leaves your machine except the `git` / `gh` calls you approve.

### Headless onboarding

For scripted / agent-driven onboarding (no browser), use the `onboard`
entrypoint. It reuses the **same planner and executor** the wizard drives, so
the two stay in lockstep:

```bash
npm run onboard -- <targetPath> [options]
```

| Option | Effect |
| --- | --- |
| `--features a,b,c` | Override the selection (default: the local baseline — every default feature that needs no GitHub remote) |
| `--owner <name>` | GitHub owner/account; enables `CODEOWNERS` and the manifest owner |
| `--repo <name>` | Repo name recorded in `.github/archon-setup.json` |
| `--visibility <v>` | `private` (default) or `public` |
| `--dry-run` | Print the plan and exit without writing |
| `--json` | Emit the result as JSON instead of human-readable text |

`--dry-run` shows exactly what the wizard's Review screen would, and onboarding
writes the same baseline — including the F19-scrubbed `.githooks/`. This is the
first-class version of the one-off script used to onboard existing repos during
the F19 rollout.

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
   `repo-required-gate / decision`.

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
- **Required gate plus check map** - `.agent/check-map.yml` and
  `repo-required-gate.yml` give agents and branch protection one shared map from
  changed paths to required verification.
- **Repo update log** - generated repos receive `docs/repo-update-log.md` so
  agents can leave durable operational history separate from user-facing release
  notes.
- **Owner / agent / default lanes** - the ecosystem policy distinguishes safe
  owner maintenance from agent-managed code changes and ordinary reviewed work.

Planned agent-facing capabilities:

- **Existing-repo audit agent** - inspect an existing repo's workflows, branch
  protection, docs, hooks, manifests, skills, memory files, and local policy
  before proposing any changes.
- **Managed merge planner** - classify every proposed update as create, refresh,
  preserve, skip, or needs-human-review, with clear diffs for AGENTS sections,
  workflows, check maps, and repo-local customizations.
- **Skills and memory preservation** - detect `.claude`, `.codex`, `.gemini`,
  skill directories, local memory/runbook files, and tool-specific notes; keep
  them unless the user chooses a managed migration.
- **Issue-Admiral / triage path** - formalize issue creation, dedupe, labeling,
  severity, and routing for new repos and upgraded repos.
- **Release / close path** - encode the finish flow for verification evidence,
  PR body updates, merge readiness, changelog fragments, and post-merge cleanup.
- **Status board agent** - render `.archon/events.jsonl`, manifests, PR state,
  and rollout status inside the local wizard once real event streams exist.
- **Security and dependency steward** - wire CodeQL, dependency review,
  Dependabot, auto-merge policy, least-privilege Actions permissions, and
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
- Baseline branch protection can require PRs immediately, but named required
  checks must wait until the check has run at least once.
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

`0.1.0-pre`. Source-runnable local wizard and update command exist. Public npm
publication and the final `npx` path are still pending.

See [ROADMAP.md](./ROADMAP.md) for what is already built and what remains in
progress.

## Roadmap

The roadmap is organized around getting from today's source-runnable wizard to a
safe, repeatable ecosystem upgrade tool for fresh and existing repositories.

### Phase 1: Fresh Repo Baseline

Built or actively hardening:

- Generate README, LICENSE, `.gitignore`, `AGENTS.md`, `CLAUDE.md`,
  `GEMINI.md`, `.agent/check-map.yml`, `docs/repo-update-log.md`, and
  `.github/archon-setup.json`.
- Initialize git, create the GitHub repo with `gh`, push the initial commit,
  apply standard labels, and apply baseline branch protection.
- Install one stable required branch-protection gate through
  `repo-required-gate.yml`, with Node, Python, and minimal CI options available
  as managed workflow callers.
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
- Preserve bespoke workflows, local AGENTS sections, CLAUDE/GEMINI addenda,
  `.claude`/`.codex`/`.gemini` state, local skills, and repo-specific process
  notes by default.
- Offer explicit managed sync paths for workflows, check maps, docs sections,
  hooks, labels, and branch protection instead of rewriting whole files.
- Produce a dry-run plan that separates creates, updates, skipped files,
  warnings, manual follow-ups, and commands that will call `gh`.

### Phase 3: GitHub Actions, CI, And Governance

Planned expansion:

- Make `repo-required-gate / decision` the preferred required check for new
  repos after its first successful run.
- Add security and dependency workflows: CodeQL, dependency review, Dependabot,
  and Dependabot auto-merge.
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
  update logs so agents can preserve existing context and avoid clobbering
  human-written policy.
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
