<!-- title: test: repo-required-gate maps changed paths to expected checks -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:workflow -->
<!-- prompt: prompts/general.md -->

## Context

This test exercises the path-routing logic inside repo-required-gate on `archon-setup-lab-pr-contract`. The gate consults `.agent/check-map.yml` to decide which downstream checks are required for a given changeset: docs-only changes take the low-cost path with no additional required checks, code/test changes require `language-ci`, and workflow or `.githooks` changes require `workflow-validation`. Each routing path must produce a stable `repo-required-gate / decision` result that matches the check-map. Any observed mismatch must be logged separately rather than resolved by editing the check-map.

## Acceptance Criteria

- [ ] Open a PR containing only changes under `docs/**` or `**/*.md`; confirm routing takes the low-cost path (`requires: []`) and `repo-required-gate / decision` reports green.
- [ ] Open a PR containing a change to a code/test file (`src/`, `lib/`, `bin/`, `scripts/`, `test/`, or a `*.js`/`*.mjs`/`*.ts`/`*.py` file); confirm routing requires `language-ci` and `repo-required-gate / decision` reports accordingly.
- [ ] Open a PR containing a change under `.github/workflows/**` or `.githooks/**`; confirm routing requires `workflow-validation` and `repo-required-gate / decision` reports accordingly.
- [ ] Confirm `repo-required-gate / decision` reports stably across multiple runs on the same PR.
- [ ] Confirm the observed routing agrees with `.agent/check-map.yml`; if a mismatch is found, log it separately and do not edit the check-map.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
