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
| `--repo-registry` | built-in active repo registry  | JSON registry for active/inactive repo health targets; `none` disables it |
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
      "live": true,
      "reservedBy": "repo-id | null",
      "conflict": false
    }
  ],
  "repos": [
    {
      "name": "archon-setup",
      "owner": "ArchonVII",
      "repo": "archon-setup",
      "role": "ecosystem-health-hub",
      "lifecycle": "active",
      "healthTarget": true,
      "path": "C:\\GitHub\\archon-setup",
      "available": true,
      "branch": "main",
      "dirty": false,
      "lastCommit": { "hash": "…", "committedAt": "ISO", "subject": "…" },
      "worktrees": [{ "path": "…", "branch": "…" }],
      "maintenance": {
        "status": "green|yellow|red",
        "basis": "fast|audited",
        "fastStatus": "not_onboarded|manifest_current|manifest_outdated|unknown_needs_audit|null",
        "reasons": [{ "code": "manifest-current-unaudited", "detail": "Manifest current · run audit to verify" }]
      },
      "friction": {
        "state": "present|no-ledger",
        "count": 0,
        "byCategory": { "tooling": 0, "docs": 0, "skill": 0, "hook": 0, "ci": 0, "env": 0 },
        "byCost": { "rerun": 0, "blocked": 0, "context-burn": 0, "none": 0 },
        "lastEntryAt": "YYYY-MM-DD|null",
        "unparsed": 0
      }
    }
  ],
  "repoRegistry": {
    "schemaVersion": 1,
    "updatedAt": "2026-06-09",
    "sourcePath": "…\\src\\server\\ecosystem\\repoRegistry.json",
    "active": 9,
    "inactive": 1,
    "total": 10,
    "repositories": [
      {
        "id": "skills-review",
        "name": "skills-review",
        "owner": "ArchonVII",
        "repo": "jma-skill-review",
        "path": "C:\\Users\\josep\\skills",
        "lifecycle": "active",
        "healthTarget": true,
        "role": "skill-source",
        "reason": null,
        "reservedPorts": [],
        "devServer": null
      }
    ]
  },
  "governance": {
    "id": "governance",
    "status": "green|yellow|red",
    "detail": "4 hub repos; 0 red, 1 unknown or incomplete",
    "repos": [
      {
        "owner": "ArchonVII",
        "name": "archon-setup",
        "fullName": "ArchonVII/archon-setup",
        "status": "green|yellow|red",
        "defaultBranch": "main",
        "permissions": { "status": "available|unknown|unavailable" },
        "classic": { "status": "present|absent|unavailable", "source": "classic" },
        "rulesets": { "status": "present|absent|unavailable", "source": "rulesets", "items": [] },
        "posture": {
          "prRequired": "required|not-required|unknown",
          "directPush": "blocked|restricted|allowed|unknown",
          "forcePush": "blocked|allowed|unknown",
          "deletion": "blocked|allowed|unknown",
          "requiredGate": "required|missing|unknown"
        }
      }
    ]
  },
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
  },
  "friction": {
    "id": "friction",
    "status": "green",
    "detail": "0 friction entries; 0 repos without ledgers; 0 unparsed rows",
    "count": 0,
    "byCategory": { "tooling": 0, "docs": 0, "skill": 0, "hook": 0, "ci": 0, "env": 0 },
    "byCost": { "rerun": 0, "blocked": 0, "context-burn": 0, "none": 0 },
    "lastEntryAt": null,
    "unparsed": 0,
    "noLedger": 0,
    "sources": []
  }
}
```

## Notes for consumers

- **`ports[].live`** is a fresh `process.kill(pid, 0)` liveness probe at snapshot time.
  `recordedAt` is when the registry entry was written — it may be stale. Treat port
  ownership as **timestamped evidence, not authority** (PIDs are reused; the registry
  can lag in both directions).
- **`ports[].reservedBy` / `ports[].conflict`** join the repo registry's
  `reservedPorts` onto the live port table (#215, spec §4.5). `reservedBy` is the
  non-removed registry entry holding the port. `conflict` is `true` for a live
  process on a forbidden port (5173) or a live process on a reserved port whose
  recorded command line does not mention the reserving repo's path — that
  attribution is command-string evidence, not authority, and fails closed (an
  unattributable live process on a reserved port counts as a conflict).
- **`repos[].maintenance`** is the per-repo maintenance assessment
  (`src/contracts/schemas/repo-maintenance-status.schema.json`; rules in
  [`docs/MAINTENANCE.md`](./MAINTENANCE.md)). `status` is the worst reason's
  severity; `basis: "fast"` means cheap manifest/git signals only — a fast green
  must always render as **"Manifest current · run audit to verify"** (the
  `manifest-current-unaudited` reason detail), never a bare "Current". Repos
  without a registry role (e.g. plain `--github-root` enumeration) carry
  `maintenance: null`.
- **`repos[].friction`** is the per-repo summary of `.claude/friction.md`
  (`src/contracts/schemas/repo-friction.schema.json`). `state: "present"` means
  the ledger was readable, even when `count` is zero. `state: "no-ledger"` means
  there is no readable ledger signal; consumers must not treat that as "no
  friction". Malformed table rows are counted in `unparsed` and never abort the
  snapshot. The top-level `friction` section aggregates counts across collected
  repo ledgers.
- **`repoRegistry`** is the canonical active/inactive repository list for this
  ecosystem health surface. The built-in registry lives at
  `src/server/ecosystem/repoRegistry.json`; active entries are collected into
  `repos[]`, inactive entries stay visible in `repoRegistry.repositories[]` but
  are not scanned as health targets. As of 2026-06-09, `jma-ui` is intentionally
  inactive, while `pigafetta`, `jma-history`, `skills-review`
  (`ArchonVII/jma-skill-review` at `C:\Users\josep\skills`), and `hudson-bend`
  are active alongside the core ArchonVII repos.
- **`governance`** queries GitHub through read-only `gh api` calls for the four hub
  repos: `ArchonVII/.github`, `ArchonVII/github-workflows`, `ArchonVII/repo-template`,
  and `ArchonVII/archon-setup`. `classic` is the default branch protection endpoint;
  `rulesets` is the repository rulesets endpoint. Missing permissions, missing
  `permissions` fields, and unavailable API data are recorded as `unknown` or
  `unavailable`; consumers must not infer a protected or unprotected state from those
  values.
- **`summary`** counts collector statuses (ports, repos, governance, amber,
  signals, events, friction when collected), not items.
- Regeneration is wired **outside this repo** (a `~/.claude` SessionStart hook or a
  Windows Task Scheduler entry calling `npm --prefix C:\GitHub\archon-setup run snapshot`),
  keeping `archon-setup` itself portable.
