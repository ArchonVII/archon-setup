### Fixed

- Refreshed the repo-template snapshot to
  `318fb1c6612a1bc89c33e1f0661d31e4c6eef74f` so onboarding and repair
  install verified `agent:start-task -- --carry <path...>` handling: every dirty
  path must be explicitly covered, copied destinations are hash-verified before
  only the named sources are cleaned, and unrelated dirt still blocks startup.
- Distributed PR-contract guidance now validates a real temporary body file
  through the npm wrapper on PowerShell instead of documenting stdin piped into
  bare npm.
- Charter line budgets remain reported by doc-health but are advisory rather
  than absolute merge blockers.
- Documentation command ownership and the required startup baseline now include
  the provider-owned `scripts/docs/**` runtime instead of advertising commands
  whose implementation can be absent.

### Changed

- Registered the carry module in the agent-lifecycle installer and feature
  inventory, self-applied the five-fix provider batch after #383's integrator
  behavior landed, and updated the startup and strict-PR global update records.
  Full-ecosystem distribution remains owner-gated and was not run. (#385)
