This is a negative-control test. You must intentionally create the invalid condition described in the
issue, confirm the expected guard fails, then repair only the invalid condition and confirm the guard
passes. Do not bypass hooks, checks, wrappers, or branch protection (no --no-verify, no ALLOW_* env
overrides, no raw `gh pr ready`). Do not merge until the repaired state is green.
