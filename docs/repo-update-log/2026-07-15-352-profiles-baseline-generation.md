## 2026-07-15 - Generate startup baselines from named profiles

- **Issue/PR:** #352 / #356
- **Branch:** agent/claude/352-profiles-baseline-generation
- **Changed paths:** `bin/onboard.mjs`, `src/registry/profiles.json`, planner/executor/onboarding/task modules, focused tests, `README.md`, `docs/agent-process/deterministic-onboarding.md`, Lane C plan, changelog fragment
- **What changed:** Added three named onboarding profiles and generated startup contracts from the full resolved selection. Selective existing-repo repair now applies only approved features without narrowing the repository's baseline, manifest, or profile.
- **Verification:** Focused repair regressions pass; final full-suite and snapshot verification are recorded in PR #356 after all code and documentation changes.
- **Propagation:** pending C3/C5/C6 source lanes; no consumer repository changes until the owner selects targets
