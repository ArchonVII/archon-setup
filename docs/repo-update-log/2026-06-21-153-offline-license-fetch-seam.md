# 2026-06-21 - Offline fresh-repo smoke fixture seam

- **Issue/PR:** #153 / #274
- **Branch:** agent/claude/153-offline-license-fetch-seam
- **Changed paths:** `src/server/tasks/writeGitignore.mjs`, `src/server/tasks/writeLicense.mjs`, `test/smokeFreshRepo.test.mjs`, `docs/repo-update-log/2026-06-21-153-offline-license-fetch-seam.md`.
- **What changed:** Fresh-repo smoke tests can inject license and gitignore response bodies through `ARCHON_LICENSE_BODY_JSON` and `ARCHON_GITIGNORE_BODY_JSON`, avoiding live unauthenticated GitHub fetches while preserving the production network path when fixtures are unset.
- **Verification:** `node --test test/smokeFreshRepo.test.mjs` passed 3/3; the same smoke suite passed with outbound `fetch` hard-blocked; `npm test` passed 581/583 with 2 pre-existing skips.
- **Propagation:** none required; the fixture seam is local to the archon-setup smoke path.
