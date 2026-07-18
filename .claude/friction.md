<!-- Log non-bug workflow hiccups here; category = tooling | docs | skill | hook | ci | env; cost = rerun | blocked | context-burn | none. Keep each cell one line. -->
| date | category | what happened | cost | suggested fix |
|---|---|---|---|---|
| 2026-06-15 | hook | verified friction ledger append path during #238 rollout | none | keep hook allowlist synced with repo-template |
| 2026-07-10 | tooling | close:scan:complete requires an existing PR number although the generic lifecycle suggests running it before the first push | rerun | create the draft PR first, then run close scan with --repo and --pr |
| 2026-07-15 | tooling | GitHub review-thread helper decoded gh JSON with Windows cp1252 and crashed on Unicode review text | rerun | run the helper with PYTHONUTF8=1 or make the helper decode subprocess output as UTF-8 |
| 2026-07-15 | tooling | close:scan:complete has no help mode and treated --help as a real scan missing --repo | rerun | add a non-mutating help path that prints the required close-scan arguments |
| 2026-07-15 | tooling | A generic verification bullet failed PR contract despite an exact evidence block, and a semicolon-separated PowerShell command still created the draft after validation failed | rerun | make the lifecycle wrapper validate then create conditionally, and document that the lead verification item itself must name the command |
