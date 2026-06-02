# Handoff: fresh-repo wizard lane (post #36)

> **For the next agent/human picking up archon-setup.** Captures what shipped, the
> one outstanding cleanup task, and what remains for the existing-repo flow (#34).
> Author: Claude (Opus 4.8), 2026-05-30.

## What shipped (lane complete)

The fresh-repo wizard is finished and on `main`. Tracking issue **#36 is closed**.
See [DESIGN-fresh-repo-wizard.md](DESIGN-fresh-repo-wizard.md) for the full design
and decision log (D1–D11).

| PR    | Title                                                                                               | Merge     |
| ----- | --------------------------------------------------------------------------------------------------- | --------- |
| [#37] | Native folder picker (`folder.pick` RPC + Browse button)                                            | `695ae35` |
| [#38] | repo-template baseline parity (7 foundation features + SHA-pinned snapshots + hooks-path preflight) | `2926ab9` |
| [#41] | Manifest accuracy + self-CI + docs + end-to-end smoke test                                          | `0a6086f` |

State on `main` after the lane: `node --test` → **69/69 pass**; archon-setup now
runs its own CI (`.github/workflows/node-ci.yml`, a `@v1` caller — first real
check on this repo's PRs).

The wizard IS the fresh-repo process: `npx`/`node bin/archon-setup.mjs` →
doctor → location (Browse or type a path) → features → review → execute. It now
generates a repo baseline-equivalent to `ArchonVII/repo-template`.

## OUTSTANDING — must be done to fully close out

**Five throwaway smoke-test repos still exist and need deletion.** They are all
private under `ArchonVII`:

- `archon-setup-smoketest-manual-20260530`
- `archon-setup-smoketest-direct-20260530`
- `archon-setup-smoketest-createonly-20260530`
- `archon-setup-smoketest-e2e-20260530`
- `archon-setup-smoketest-e2e2-20260530`

They could not be deleted automatically: the `gh` session lacks the `delete_repo`
scope (`HTTP 403 ... needs the "delete_repo" scope`). Granting delete authority
is a human action. To finish:

```bash
# 1. Grant the scope (interactive — run yourself, e.g. via a `!` command):
gh auth refresh -h github.com -s delete_repo

# 2a. Preferred — the remediation helper (dry-run by default; deletes only with
#     --confirm AND the scope above):
node scripts/cleanup-smoketest-repos.mjs            # lists matches + commands
node scripts/cleanup-smoketest-repos.mjs --confirm  # actually deletes

# 2b. Or delete each by hand:
gh repo delete ArchonVII/archon-setup-smoketest-manual-20260530 --yes
gh repo delete ArchonVII/archon-setup-smoketest-direct-20260530 --yes
gh repo delete ArchonVII/archon-setup-smoketest-createonly-20260530 --yes
gh repo delete ArchonVII/archon-setup-smoketest-e2e-20260530 --yes
gh repo delete ArchonVII/archon-setup-smoketest-e2e2-20260530 --yes

# 3. Confirm none remain:
gh repo list ArchonVII --limit 200 | grep -i smoke   # expect no output
```

## Process lesson — now enforced as code

PR3's agent created **five** throwaway repos (iterative debugging of the remote
path) instead of one, and deleted none — it hit the `delete_repo` scope wall but
kept creating more rather than stopping. This is now fixed at the root rather
than by discipline: **smoke tests no longer create real GitHub repos**. The
fresh-repo remote path is exercised hermetically against a local bare repo via a
`gh` mock (`test/smokeFreshRepo.test.mjs`), so there is nothing to clean up. Any
opt-in live-GitHub smoke test must use exactly ONE throwaway repo and STOP +
report if it cannot delete it. See the no-remote smoke-test decision in
[ecosystem-status.md](ecosystem-status.md#decision-log).

## What remains — existing-repo flow (#34)

This lane only did the **fresh-repo** path and shared machinery toward #34. Still
open in [#34], per [ONBOARDING_EXISTING_REPO.md](ONBOARDING_EXISTING_REPO.md)
"Known gaps":

- Existing-repo **audit/plan/apply** mode (read `.github/archon-setup.json`,
  diff against baseline, apply only the gaps).
- **AGENTS.md / CLAUDE.md reconcile** step (fold in the standard contract without
  clobbering repo-specific sections — currently by-hand).
- **Workflows-without-repo-create** path (selecting `workflow.*` on an existing
  repo must not pull in `remote.github` → `gh repo create`).
- Existing-repo **no-clobber planning** surfaced in the wizard.
- **Branch-protection two-step** helper (baseline now, require named check after
  first gate run).

Note: hudson-bend was effectively the #34 path executed by hand — it's a useful
reference for what an existing-repo onboarding actually requires.

## Guardrails that still apply

- Repo-agnostic invariant: generated output must never name a sibling repo, a
  global board, or a machine path. Neutral baseline is `repo-template`, never
  hudson-bend. Only allowed cross-repo ref: `ArchonVII/github-workflows@v1`.
- Don't hand-edit `src/snapshots/` — extend via `npm run refresh-snapshots`.
- A branch ruleset may apply a `pull_request` rule to feature branches; if a push
  is rejected with "Changes must be made through a pull request", investigate —
  don't bypass.

[#34]: https://github.com/ArchonVII/archon-setup/issues/34
[#37]: https://github.com/ArchonVII/archon-setup/pull/37
[#38]: https://github.com/ArchonVII/archon-setup/pull/38
[#41]: https://github.com/ArchonVII/archon-setup/pull/41
