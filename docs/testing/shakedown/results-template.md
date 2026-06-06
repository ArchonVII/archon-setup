# Shakedown Run — Results

- **Run date:** <fill>
- **archon-setup commit:** <sha>
- **Operator / agent:** <fill>
- **Lab repos:** ArchonVII/archon-setup-lab-{fresh,lived-in,pr-contract}

| # | Capability | Repo | Expected signal | Observed | Pass/Fail | Evidence (cmd / run URL / check) | Cleanup | Follow-ups |
|---|-----------|------|-----------------|----------|-----------|----------------------------------|---------|-----------|
| 0 | Fresh repo created by onboard | fresh | repo exists + manifest | | | | | |
| 1 | Fresh install baseline | fresh | files+labels+protection; gate appears | | | | | |
| 2 | Existing audit | lived-in | present/missing/drifted; no writes | | | | | |
| 3 | Existing apply/reconcile | lived-in | facts kept, stale replaced | | | | | |
| 4 | pre-commit guard | pr-contract | primary feature commit blocked | | | | | |
| 5 | Lifecycle scripts | pr-contract | start/status/prune correct | | | | | |
| 6 | branch-naming | pr-contract | bad→red, fixed→green | | | | | |
| 7 | semantic-pr-title | pr-contract | bad→red, fixed→green | | | | | |
| 8 | pr-policy body | pr-contract | missing→red, fixed→green | | | | | |
| 9 | autoinject | pr-contract | empty body at open→injected | | | | | |
| 10 | required-gate routing | pr-contract | docs/code/workflow route correctly | | | | | |
| 11 | anomaly (related) | pr-contract | sticky PR comment, idempotent | | | | | |
| 12 | anomaly (unrelated) | pr-contract | new issue, no dupes | | | | | |
| 13 | doc-sweep | pr-contract | safe docs swept, unsafe left | | | | | |
| 14 | close-preflight | pr-contract | malformed blocked, fixed→ready | | | | | |
| 15 | update drift | pr-contract | check flags, upgrade repairs | | | | | |

**Definition of done:** every row Pass with evidence, and publish still deferred.