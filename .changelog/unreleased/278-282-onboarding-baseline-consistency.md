### Fixed

- Onboarding now produces a repo that satisfies its own baseline contract and
  passes its own required gate out of the box, closing a cluster of
  internal-consistency gaps surfaced while onboarding a fresh repo:
  - `foundation.agents` (`writeAgentsMd`) distributes
    `docs/agent-process/message-protocol.md` — the charter `AGENTS.md`'s
    `## Message protocol` section links to — so onboarded repos no longer ship a
    dangling relative link that `doc-health` flags on every run. (#278)
  - `agent-lifecycle.baseline` (`writeAgentLifecycle`) installs the strict
    closeout wrappers `scripts/agent-{close-preflight,pr-ready}.mjs` and wires
    their `agent:close-preflight` / `agent:pr-ready` npm entries, so the closeout
    commands `AGENTS.md` mandates resolve instead of failing with "missing
    script". (#282)
  - `foundation.friction-ledger` (`writeFrictionLedger`) re-includes the
    documented `.claude/noticed.md` and `.claude/napkin.md` append-log ledgers,
    so `git add` works on them without `-f`. (#282)
  - `foundation.gitignore` (`writeGitignore`) ignores the generated
    `.agent/current-task.json` runtime state, so a worktree stays clean after
    `npm run agent:start-task`. (#282)

### Changed

- Updated the `github-workflows` and `repo-template` snapshots so the installed
  `repo-required-gate.yml` scaffold defaults to `stack: node` with
  `run-dependency-review: false` (a freshly onboarded repo's first PR passes
  `repo-required-gate / decision` without manual edits and without assuming
  GitHub Dependency Graph is enabled — #280, #281), and the snapshot of
  `scripts/close/scan-complete.mjs` skips `node-test` when the repo has no
  `test` script (#282). `refresh-snapshots` now mirrors
  `docs/agent-process/message-protocol.md` into the `repo-template` snapshot.
