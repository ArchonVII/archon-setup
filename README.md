# archon-setup

Plug-and-play repo bootstrapper for the ArchonVII ecosystem.

A local browser wizard that scaffolds a new repository — files, git init, `gh` remote, labels, branch protection — driven by a dependency-aware feature registry.

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
