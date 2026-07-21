### Fixed

- Refreshed only the repo-template provider through reviewed PRs #210 and #212
  at exact merge SHA `e413928c0d029b8d6f0d718b64ea939fe5033fbe`
  and self-applied its receipt-bound carry lifecycle. Changed or recreated task
  inputs are preserved with recovery details, while carried directories are
  staged and verified before their modes and destination are promoted; other
  provider pins and consumers remain unchanged in this lane. (#391)
