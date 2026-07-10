# 2026-07-09 - #342 Anomaly-triage caller permission propagation

- **Issue/PR:** #342 / pending
- **Branch:** `agent/codex/342-anomaly-triage-write-permissions`
- **Changed paths:** `.github/workflows/anomaly-triage.yml`, `.github/workflows/repo-update-log-fragment.yml` (removed), `scripts/refresh-snapshots.mjs`, `scripts/agent-self-apply.mjs`, `src/registry/features.json`, `src/server/{onboard,tasks}/**`, `src/snapshots/**`, `test/**`, `README.md`, `docs/agent-process/**`, `docs/ecosystem-overview.md`.
- **What changed:** Canonically refreshed both providers, self-applied the exact anomaly-triage write-permission contract, and absorbed the provider's S3 fragment retirement so refresh, onboarding, audit, and self-apply remain coherent. Removed the root caller whose reusable workflow was retired at `github-workflows@v1`, while retaining its old feature ID as a disabled compatibility no-op.
- **Verification:** `npm run agent:self-apply -- --check` all already done; focused integration tests 127/127; `npm test` 670 pass / 0 fail / 2 platform skips; `npm run snapshots:verify` all providers current; ecosystem overview check current; scoped actionlint exit 0.
- **Propagation:** pending consumer updater lanes for all opted-in anomaly-triage callers.
