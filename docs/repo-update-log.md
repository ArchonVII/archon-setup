# Repository Update Log

This log records agent-visible repository changes that should be easy to audit
later. It complements `CHANGELOG.md`: the changelog is user-facing release
history, while this file is the operational ledger for startup, process, and
repository-policy changes in `archon-setup`.

## Entry Template

```markdown
## YYYY-MM-DD - <short title>

- **Issue/PR:** #issue / #pr
- **Branch:** agent/<tool>/<issue>-<slug>
- **Changed paths:** path, path
- **What changed:** One or two sentences.
- **Verification:** Exact commands/results, or docs-only rationale.
- **Propagation:** none | pending <repo/path> | completed <repo/path>
```

## 2026-06-11 - Root startup baseline repair

- **Issue/PR:** #196 / pending
- **Branch:** agent/codex/196-bootstrap-lifecycle-baseline
- **Changed paths:** AGENTS.md, .agent/startup-baseline.json, .agent/check-map.yml, .agent/coordination/README.md, .github/PULL_REQUEST_TEMPLATE.md, docs/plans/README.md, docs/agent-process/doc-sweep.md, docs/repo-update-log.md, scripts/agent/**, scripts/doc-sweep/**, package.json, src/server/tasks/writeAgentLifecycle.mjs, src/server/onboard/auditPlan.mjs, src/registry/features.json, test/**
- **What changed:** Brought the `archon-setup` root checkout into the same startup/process baseline it audits and installs for consumers. The lifecycle installer now includes `agent:pr-body`, matching the current repo-template snapshot command surface.
- **Verification:** `node --test test/writeAgentLifecycle.test.mjs test/auditAgentLifecycle.test.mjs test/onboardAudit.test.mjs` passed (23/23); `npm test` passed (458 pass, 2 skip); `npm run agent:status` passed and reported issue #196; `npm run agent:prune -- --dry-run` passed and printed prune decisions; `npm run agent:pr-body -- 196` passed and filled `Closes #196`; `node bin/onboard.mjs C:\GitHub\archon-setup-196-bootstrap-lifecycle --audit --json` passed with no missing/stale startup files and `startupReadiness.status = warning` only because `docs/superpowers/plans/` remains as an intentional legacy archive; `git diff --check` passed; `node --check` passed for `scripts/agent/*.mjs`, `scripts/agent-close-preflight.mjs`, and `scripts/agent-pr-ready.mjs`.
- **Propagation:** audit only for sibling repos under `C:\GitHub`; no broad apply without owner confirmation. Initial read-only audit found `.github`, `archon`, `github-workflows`, `jma-ui`, and `repo-template` also report incomplete startup readiness.
