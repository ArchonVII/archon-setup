# Ecosystem state contract

`bin/ecosystem-snapshot.mjs` (run via `npm run snapshot`) writes two artifacts to
`--out-dir` (default `~/.claude`):

- **`ecosystem-state.json`** — machine-readable; AI agents may read this to answer
  "is port N mine?", "what repos have dirty worktrees?", "is Amber online?" without
  guessing. Written atomically (tmp-then-rename), so a concurrent reader never sees a
  torn file. **All string values are passed through the secret redactor before writing
  — secrets never touch disk.**
- **`ecosystem.html`** — a self-contained "glance" view for a human.

## CLI flags

| Flag              | Default                        | Meaning                                                         |
| ----------------- | ------------------------------ | --------------------------------------------------------------- |
| `--out-dir`       | `~/.claude`                    | where both artifacts are written                                |
| `--github-root`   | `C:\GitHub`                    | root scanned for first-level git repos                          |
| `--port-registry` | `~/.claude/port-registry.json` | the port→pid→command registry                                   |
| `--anomalies`     | `~/.claude/anomalies.md`       | anomaly log                                                     |
| `--amber-node`    | `amber`                        | case-insensitive regex matched against tailscale peer HostNames |

## `ecosystem-state.json` schema (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "generatedAt": "ISO-8601 timestamp",
  "summary": { "green": 0, "yellow": 0, "red": 0 },
  "ports": [
    {
      "port": 5174,
      "pid": 49472,
      "process": "node.exe",
      "command": "…",
      "startedAt": "ISO",
      "recordedAt": "ISO",
      "live": true
    }
  ],
  "repos": [
    {
      "name": "archon-setup",
      "path": "C:\\GitHub\\archon-setup",
      "branch": "main",
      "dirty": false,
      "lastCommit": { "hash": "…", "committedAt": "ISO", "subject": "…" },
      "worktrees": [{ "path": "…", "branch": "…" }]
    }
  ],
  "amber": {
    "id": "amber",
    "status": "green|yellow|red",
    "detail": "…",
    "online": false,
    "lastSeen": "ISO|null"
  },
  "signals": {
    "id": "signals",
    "status": "green|yellow",
    "detail": "…",
    "anomalies": 0,
    "noticed": 0,
    "recent": ["…"]
  }
}
```

## Notes for consumers

- **`ports[].live`** is a fresh `process.kill(pid, 0)` liveness probe at snapshot time.
  `recordedAt` is when the registry entry was written — it may be stale. Treat port
  ownership as **timestamped evidence, not authority** (PIDs are reused; the registry
  can lag in both directions).
- **`summary`** counts collector statuses (ports, repos, amber, signals), not items.
- Regeneration is wired **outside this repo** (a `~/.claude` SessionStart hook or a
  Windows Task Scheduler entry calling `npm --prefix C:\GitHub\archon-setup run snapshot`),
  keeping `archon-setup` itself portable.
