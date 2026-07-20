### Fixed

- Startup readiness no longer treats `package.json` as current when a selected
  feature's required package scripts are missing but unrelated agent lifecycle
  scripts remain installed.
- Documentation execution tests now reject network access and provide the
  gitignore fixture they need locally.
- Refreshed carry tooling preserves deletion-only task inputs and rejects
  cross-boundary renames before creating a branch or worktree.

### Changed

- Refreshed the repo-template snapshot exactly to
  `efeba25a0fcd27a4f365d3768bc5d4750d21cdd4`, self-applied its managed root
  lifecycle files, and adopted deterministic LF text materialization with CRLF
  exceptions for Windows-native command files. Existing consumer
  `.gitattributes` files remain explicitly decisionable rather than being
  overwritten. (#389)
