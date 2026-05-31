# RPC contract

The UI talks to the local server via `POST /rpc/<method>` (or `GET` for read-only methods). Every request carries `Authorization: Bearer <session-token>`.

## Read-only (GET)

### `registry.load`

Returns `{ features, groups, schema }` from `src/registry/`.

### `snapshots.manifest`

Returns the contents of `src/snapshots/manifest.json` — source repo / ref / SHA for every embedded artifact.

### `ecosystem.snapshot`

Returns the redacted Ecosystem dashboard snapshot: ports, repositories, Amber,
and recent signal counts.

### `globalUpdates.list`

Returns `{ updates }` for recorded global/shared workflow fixes that can be
reviewed or distributed from the Ecosystem screen.

## State-changing (POST)

### `folder.pick`

Body: `{}`.
Returns one of `{ path }`, `{ cancelled: true }`, `{ unsupported: true }`, or
`{ error }`.

Opens the native OS folder picker on supported desktop platforms. The returned
path is only copied into the Location screen; target validation remains in
`preflight.run` / `checkTargetPath`.

### `preflight.run`

Body: `{ target?: string }`.
Returns `{ checks, summary, capabilities }` — see `docs/MANIFEST.md` for capability bits.

### `plan.build`

Body: `{ selection: string[], options: object, context: object }`.
Returns a normalized plan object: `{ context, selectedFeatureIds, files, commands, remoteMutations, postChecks, ordered, warnings }`.

The Review screen and the Execute screen consume the **same plan object** — never two sources of truth.

### `plan.execute`

Body: `{ plan }`.
Response is **SSE-style** chunked: each line is `data: <json>\n\n` with a final `event: done\ndata: <result>\n\n` or `event: error\ndata: <error>\n\n`.

Per-task event shape:

```json
{ "taskId": "writeReadme", "kind": "start" | "checked" | "applied" | "verified" | "done" | "error", "at": 0, "...": "..." }
```

### `globalUpdates.distribute`

Body:

```json
{ "updateId": "2026-05-31-browser-backend-preflight", "confirmation": "DISTRIBUTE 2026-05-31-browser-backend-preflight", "dryRun": true }
```

Requires the exact confirmation phrase from `globalUpdates.list`. Returns an
auditable result object with per-repo statuses: `applied`, `would-apply`,
`unchanged`, `skipped`, or `failed`, plus reason codes such as
`protected-main`, `dirty-worktree`, and `missing-agents`.
