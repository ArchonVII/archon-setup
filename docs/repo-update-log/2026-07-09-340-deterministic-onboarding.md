# 2026-07-09 - #340 Deterministic onboarding contract

- **Issue/PR:** #340 / pending
- **Branch:** `agent/codex/340-docs-onboarding-define-deterministic-onboarding-contract`
- **Changed paths:** `docs/agent-process/deterministic-onboarding.md`, `README.md`, `docs/ONBOARDING_EXISTING_REPO.md`, `docs/REPO_ONBOARDING_WALKTHROUGH.md`, `.changelog/unreleased/340-deterministic-onboarding.md`, this fragment.
- **What changed:** Added a direct contract that defines "fully onboarded" as a default-branch, post-merge-audited state, separates automatable onboarding work from explicit human/agent decisions, and lays out the hardening plan for required-gate safety and structured manual decisions.
- **Verification:** `git diff --check` -> clean; `npm test` -> 659 tests / 657 pass / 0 fail / 2 skipped.
- **Propagation:** This is `archon-setup` process guidance only. Follow-up tooling issues should implement the default-branch completion gate and `tighten-required-gate` preflight before repairing affected consumers such as `ArchonVII/sales`.
