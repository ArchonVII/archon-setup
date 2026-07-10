# 2026-07-09 - #344 Byte-idempotent anomaly permission updates

- **Issue/PR:** #344 / pending
- **Branch:** `agent/codex/344-anomaly-permission-byte-idempotency`
- **Changed paths:** `src/updater/updateManagedFiles.mjs`, `test/updateManagedFiles.test.mjs`, `.changelog/unreleased/344-anomaly-permission-byte-idempotency.md`, this record.
- **What changed:** Added an exact-block fast path so mixed CRLF/LF callers that already grant the least-privilege anomaly scopes remain byte-identical and report unchanged.
- **Verification:** updater TDD red 10/11 then green 11/11; final `npm test` passed 672 with 2 platform skips after stale temp-fixture cleanup resolved an environmental `ENOSPC` failure.
- **Propagation:** required by the in-progress github-workflows#106 consumer lanes.
