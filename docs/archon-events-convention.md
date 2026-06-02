# `.archon/events.jsonl` convention

A lightweight, append-only event stream that an ArchonVII repo accumulates over
its lifetime. It is **best-effort telemetry**, not a system of record — readers
must tolerate missing files, partial writes, and malformed lines, and writers
must never let a failed append break the work that triggered it.

This is the **lane D** slice of the distribution/lifecycle rollout
(`docs/superpowers/specs/2026-06-01-distribution-lifecycle-rollout-design.md`).
It is intentionally conservative: ship the convention + a best-effort emitter +
a minimal read view, inert until events accumulate.

## Location

`<repo>/.archon/events.jsonl` — one stream per repo, alongside the existing
`.archon/anomalies-thispr.md` convention.

## Line schema

One JSON object per line (JSON Lines). Fields:

| Field    | Type   | Meaning |
|----------|--------|---------|
| `ts`     | string | ISO-8601 timestamp (`new Date().toISOString()`). |
| `type`   | string | Event type — e.g. `plan-start`, `task-applied`, `plan-end`. |
| `actor`  | string | Who emitted it. Defaults to `archon-setup`. |
| `ref`    | string | Subject, normally `<owner>/<repo>`. May be empty. |
| `detail` | string | Human-readable detail (e.g. a task id or a count). |

Example:

```json
{"ts":"2026-06-02T14:00:00.000Z","type":"plan-start","actor":"archon-setup","ref":"ArchonVII/demo","detail":"7 task(s) planned"}
{"ts":"2026-06-02T14:00:01.000Z","type":"task-applied","actor":"archon-setup","ref":"ArchonVII/demo","detail":"writeReadme"}
{"ts":"2026-06-02T14:00:03.000Z","type":"plan-end","actor":"archon-setup","ref":"ArchonVII/demo","detail":"7/7 task(s) ok"}
```

## Emitter contract (`src/server/lib/events.mjs`)

`appendEvent(targetPath, { type, actor?, ref?, detail? })`:

- Appends exactly one line to `<targetPath>/.archon/events.jsonl`, creating the
  directory if needed.
- **Never throws into the caller.** Any failure (bad path, permissions, full
  disk) is swallowed and reported as a falsy return value. Calls with no
  `targetPath` or no `type` are ignored.
- Stamps `ts` itself; callers supply only `type`/`actor`/`ref`/`detail`.

The executor (`executePlan.mjs`) emits `plan-start` once, a `task-applied` per
task that actually applied (`res.status === "applied"`), and `plan-end` once.

### Known timing note

`plan-end` fires on the **success path only**, after the setup manifest is
written — there is no skew between the manifest write and `plan-end`. A plan
that fails mid-way returns early and intentionally emits **no** `plan-end`; the
last `task-applied` (or its absence) marks where it stopped.

## Reader (`src/server/ecosystem/collectEvents.mjs`)

`collectEvents(eventsJsonlPaths, { recentN })` parses each repo's stream
(skipping blank/malformed/typeless lines) and returns the most-recent-N events
globally, sorted by `ts` descending. The ecosystem HTML snapshot renders these
under a **Recent events** section with a graceful empty state. Events are
informational, so the section is always green.

## Provider-side follow-ups (deferred)

- **repo-template companion (decision D2):** the provider-side schema should
  also be documented in `repo-template`'s `AGENTS.md`, and generated repos
  should gitignore `.archon/` (except `!anomalies-thispr.md`) so a repo's own
  event stream is not committed. Until that lands, an onboarded repo may carry
  its onboarding events in `.archon/events.jsonl`.
- **Additional event types:** the initial type set is deliberately small;
  extend it as real consumers (hooks, agents) start emitting.
