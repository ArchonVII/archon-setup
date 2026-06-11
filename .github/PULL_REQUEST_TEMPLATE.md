<!--
  PULL_REQUEST_TEMPLATE for ArchonVII/archon-setup.

  Non-draft PRs are validated by the shared PR contract. Replace every
  placeholder before marking the PR ready for review.
-->

## Summary

TODO: What changed and why?

## Verification

- [ ] TODO: Replace with an exact command, CI check, or manual smoke test.

  ```evidence
  command: TODO
  location: local
  result: TODO
  timestamp: TODO
  ```

### Verification Notes

Each checked box above must be backed by exactly one fenced `evidence` block. The PR-policy parser reads them before promotion to ready-for-review.

Required fields: `command`, `location` (one of `local` / `ci` / `manual`), `result`, `timestamp`. Optional: `check` (used when `location: ci` and the check-run name differs from the command).

TODO: Summarize the exact verification evidence and any manual review.

## Docs / Changelog

TODO: Record the changelog fragment, direct CHANGELOG edit, docs update, or no-changelog label.

Plan/status artifacts: TODO: closed, narrowed to remaining scoped work, marked deprecated/superseded with the current source of truth, or not applicable because none were created or used by this lane.

## Linked Issue

TODO: Closes #___

## Risks

- Risk level:
- Rollback:
- Follow-ups:
