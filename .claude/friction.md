<!-- Log non-bug workflow hiccups here; category = tooling | docs | skill | hook | ci | env; cost = rerun | blocked | context-burn | none. Keep each cell one line. -->
| date | category | what happened | cost | suggested fix |
|---|---|---|---|---|
| 2026-06-15 | hook | verified friction ledger append path during #238 rollout | none | keep hook allowlist synced with repo-template |
| 2026-07-10 | tooling | close:scan:complete requires an existing PR number although the generic lifecycle suggests running it before the first push | rerun | create the draft PR first, then run close scan with --repo and --pr |
