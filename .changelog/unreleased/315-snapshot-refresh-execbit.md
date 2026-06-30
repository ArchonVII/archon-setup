### Fixed

- Vendored `repo-template` git hooks now ship executable (`100755`) in the
  snapshot, so onboarded repos get hooks git actually runs on Unix instead of
  silently-skipped `100644` no-ops (#314). `scripts/refresh-snapshots.mjs` stamps
  the exec bit (`git update-index --add --chmod=+x`) onto `.githooks/{commit-msg,
  pre-commit}` and `.githooks/scripts/*.sh` after copying, because the refresh
  runs on Windows where `core.filemode=false` drops the bit on `git add`. A
  regression test pins the `100755` index modes.
- archon-setup's own root close tooling (`scripts/close/scan-complete.mjs`) now
  distinguishes an ABSENT `package.json` (skip the local node-test green) from a
  PRESENT-BUT-UNPARSEABLE one (RUN `npm test` so the parse error surfaces as the
  required gate sees it) via `decideNodeTest`, brought current with the refreshed
  snapshot in lockstep (#286).

### Changed

- Re-vendored the `repo-template` snapshot from `896082d` to `4ddf930`,
  propagating the merged baseline fixes #290 (AGENTS.md), #292/#295
  (`start-task`/`lib`/`doc-sweep`/`pr-ready`), and #286.
