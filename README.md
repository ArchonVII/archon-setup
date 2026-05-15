# archon-setup

Plug-and-play repo bootstrapper for the ArchonVII ecosystem.

A local browser wizard that scaffolds a new repository — files, git init, `gh` remote, labels, branch protection — driven by a dependency-aware feature registry.

## Quickstart

```bash
npx @archonvii/archon-setup
```

Your default browser opens to a local URL. The wizard walks you through:

0. **Doctor** — confirms `git`, `gh`, network, and write permissions are good.
1. **Location** — where to scaffold, repo name, public/private.
2. **Features** — checkbox tree (Foundations, GitHub remote, PR contract, …).
3. **Review** — exactly what files will be created and commands run.
4. **Execute** — streaming progress.

Nothing leaves your machine except the `git` / `gh` calls you approve.

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

## What this is

Today, bootstrapping an ArchonVII repo is a 5-step manual recipe (clone template → customize → run setup script → tick required checks → commit). This tool wraps that recipe behind a UI that:

- Non-developers can use (no terminal).
- Makes feature dependencies explicit (you can't enable the CHANGELOG fragment gate unless you've picked Fragment mode).
- Records exactly what got installed (`.github/archon-setup.json` in every generated repo).
- Stays decoupled from the artifacts it scaffolds — it consumes `ArchonVII/.github`, `github-workflows`, and `repo-template` as read-only snapshots.

## Status

Pre-v0.1, scaffolding in progress. Not yet `npx`-runnable.

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
