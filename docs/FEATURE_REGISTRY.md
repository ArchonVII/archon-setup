# Feature registry

`src/registry/features.json` is the **single source of truth** for everything the wizard can install. The UI renders it, the planner consumes it, tests assert against it.

## Files

- `features.json` — the list of installable features.
- `groups.json` — group metadata (label, order, capability gates).
- `schema.json` — JSON schema for `features.json` entries.

## A feature entry

```json
{
  "id": "workflow.semantic-pr-title",
  "label": "Semantic PR title",
  "group": "workflows.pr-contract",
  "default": false,
  "locked": false,
  "requires": ["remote.github"],
  "capabilitiesNeeded": ["gh.repoCreateAllowed"],
  "creates": [".github/workflows/semantic-pr-title.yml"],
  "tasks": ["installWorkflow"],
  "options": {
    "workflowName": { "type": "constant", "value": "semantic-pr-title" }
  },
  "validations": ["workflowReferencesPinnedV1"],
  "beginnerDescription": "...",
  "advancedDescription": "..."
}
```

## Required fields

- `id` — dotted identifier, unique.
- `label` — human-readable name.
- `group` — references `groups.json[].id`.
- `tasks` — list of task module IDs to run (in order).

## Dependency types

- `requires` — feature IDs that must also be selected.
- `capabilitiesNeeded` — preflight capability bits (e.g. `gh.repoCreateAllowed`).
- `conflictsWith` — feature IDs that cannot be co-enabled.

## Default policy

Standard onboarding is intentionally minimal for solo-dev repos. `default: true`
is reserved for local, low-ceremony files needed to create a usable repository:
README, license, gitignore, agent pointers, neutral coordination docs,
`.gitattributes`, and the initial git commit.

Features that add local hooks, changelog ceremony, PR templates, CODEOWNERS,
Dependabot, GitHub labels, branch protection, runner-backed workflows, agent
lifecycle scripts, doc-health/doc-sweep runners, or template libraries stay
`default: false` unless the user explicitly selects them.

## Staged (disabled) features

Set `disabled: true` (and `default: false`) to register a capability that is
**not yet active** — the wizard hides it (the UI also hides any feature whose
group is disabled), and it stays out of default plans, but its tasks are wired
and tested so flipping `disabled` to `false` activates it. The `copilot` group
(`copilot.enable-repo`, `copilot.repo-secret`) is staged this way for v0.4;
secret values flow only through a runtime-only `gh secret set` stdin seam with
`--body` omitted, because current `gh` reads stdin only when `--body` is not
specified (see `SECURITY_MODEL.md`). `enableCopilot` is manual-only for now: it
classifies the owner with `gh api users/<owner>` and records the owner checklist,
but does not mutate Copilot settings until the API/billing/seat semantics are
proven. Note: the server-side planner has no `disabled` guard, so a disabled
feature can still be planned by passing its id explicitly (e.g. from a test or
the headless CLI) — the gate is in the UI.

## Adding a feature

1. Add an entry to `features.json` (and validate against `schema.json`).
2. If it needs a new task, add `src/server/tasks/<taskId>.mjs` implementing `check / apply / verify / rollbackHint`.
3. Register the task in `src/server/executor/executePlan.mjs`'s `TASKS` map.
4. If it references a new workflow snapshot, run `npm run refresh-snapshots`.
5. Add a golden-file test under `test/golden/`.

Optional foundation features may compose existing baseline tasks through
`requires`. For example, `foundation.friction-ledger` owns only
`.claude/friction.md`; it requires `foundation.agents`, `foundation.gitignore`,
and `foundation.hooks` because those tasks carry the AGENTS.md instruction,
ignore exception, and owner-maintenance append-log allowlist.
