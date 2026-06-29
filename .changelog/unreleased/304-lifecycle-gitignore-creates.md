### Fixed

- The `agent-lifecycle.baseline` feature now declares `requires:
  foundation.gitignore`, so the `.gitignore` it writes is part of the resolved
  plan and `--dry-run`/plan output matches the files actually created during
  onboarding. (#304)
