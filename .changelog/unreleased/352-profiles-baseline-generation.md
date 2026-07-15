## feat(onboarding): generate startup baselines from named profiles

- Add the `docs-min`, `agent-standard`, and `flagship` onboarding profiles and record the resolved profile in the setup manifest.
- Generate each repository's startup baseline from its full resolved selection, including during selective existing-repo repair.
- Accept `--profile` consistently for standard onboarding and read-only repair decisions.
