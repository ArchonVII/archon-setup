## feat(onboard): render the AGENTS Start Map per resolved selection

- Start Map bullets that point at feature-installed tooling (check-map, PR template, agent/close scripts, doc-sweep, doc-health, friction ledger, coordination) are dropped at emit time when their providing feature is not in the resolved selection, and the prose feature-caveat bullet never ships; apply, check, verify, reconcile, and audit all share the same filtered rendering, keyed to the recorded selection (as#372, found on pigafetta#1814).
