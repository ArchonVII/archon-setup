### Fixed

- Startup readiness now validates customized `AGENTS.md` managed blocks against
  the same resolved feature selection used by onboarding, so valid docs-min and
  agent-standard Start Maps are not reported stale for omitting uninstalled
  tooling pointers.
