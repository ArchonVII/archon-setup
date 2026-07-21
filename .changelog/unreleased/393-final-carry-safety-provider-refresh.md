### Fixed

- Refreshed only the repo-template provider through reviewed PR #214 at exact
  merge SHA `e1cb10f0f4f0fefc85718d6be0a6230b49341bf4` and self-applied its final
  verified-carry safety fixes for hard-link isolation, POSIX source modes, large
  Windows path sets, recoverable destination backups, index stat refresh, and
  fail-fast Git compatibility. Other provider pins and consumers remain
  unchanged in this lane. (#393)
