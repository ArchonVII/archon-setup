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
  "default": true,
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

## Adding a feature

1. Add an entry to `features.json` (and validate against `schema.json`).
2. If it needs a new task, add `src/server/tasks/<taskId>.mjs` implementing `check / apply / verify / rollbackHint`.
3. Register the task in `src/server/executor/executePlan.mjs`'s `TASKS` map.
4. If it references a new workflow snapshot, run `npm run refresh-snapshots`.
5. Add a golden-file test under `test/golden/`.
