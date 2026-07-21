---
summary: Ground truth for Archon Setup's integrator role, provider boundaries, generated-repo contract, and current repair state.
status: CANON
confidence: VERIFIED
updated: 2026-07-20
relates:
  - "[[INDEX]]"
depends-on: []
supersedes: []
superseded-by: []
contradicts: []
---

# CANON — Ground-Truth Register

## What this repo is — `CURRENT` / `VERIFIED`

`archon-setup` is the ArchonVII ecosystem integrator and onboarding product. It
turns selected capabilities into one plan, applies or audits that plan for new
and existing repositories, and records the effective selection and provider pins
in `.github/archon-setup.json`. It consumes SHA-pinned snapshots from
`ArchonVII/repo-template`, `ArchonVII/github-workflows`, and `ArchonVII/.github`;
it does not replace those providers as the source of their content.

## Current state vs. intended — `CURRENT`

- The repo-template snapshot is pinned at
  `e413928c0d029b8d6f0d718b64ea939fe5033fbe`; the github-workflows and
  org-default pins remain `f34893a3b67e5c17e59ca1413e92077833fdc571` and
  `fe48c2f5f9582e8344dbbc5c1ae7730268491daf`.
- The documentation floor is execution-closed: selection validation, audit,
  repair, package-script ownership, generated-consumer execution, and root
  self-apply describe the same installed runtime.
- Agent lifecycle onboarding includes receipt-bound explicit `--carry` inputs,
  including deletion-only changes, fail-closed cross-boundary rename handling,
  rejection of divergent index/worktree versions, and preservation with
  recovery details when a source changes or is recreated during startup. It
  stages and structurally verifies directory copies before restoring their
  modes and promoting them over a backed-up destination. It also installs the supported
  `npm run pr:contract -- --body-file <path>` wrapper.
- Generated repositories receive a deterministic LF text policy with explicit
  CRLF exceptions for Windows-native command files. Existing repo-specific
  `.gitattributes` files remain decisionable rather than being overwritten.
- Charter line budgets are advisory maintenance signals. Missing runtime,
  invalid ownership, stale generated blocks, and other doc-map contract failures
  remain blocking.
- Hudson Bend is the authorized consumer follow-up. Refresh the existing repair
  PR #383 in its isolated repair worktree after this integrator baseline lands;
  do not touch its canonical checkout at `C:\jill\hudson-bend` or the paused
  issue-370 feature lane.

## Locked decisions — `CANON`

- **2026-07-19 — provider content is mechanical.** Fix provider-owned files in
  the provider, refresh snapshots with `scripts/refresh-snapshots.mjs`, then run
  `npm run agent:self-apply`. Never hand-edit `src/snapshots/**` or its derived
  root twins. Source: `AGENTS.md` and issue #385.
- **2026-07-19 — selected capabilities must be executable.** A selection that
  installs `.agent/doc-map.yml` must also install its referenced imports,
  generator commands, caller inputs, and audit/repair ownership. Source: issue
  #383 and PR #386.
- **2026-07-19 — dirty task inputs are explicit and receipt-bound.** `--carry`
  accepts only named in-repo task artifacts, rejects ambiguous index/worktree
  states, and cleans only verified sources that still match their captured
  receipt; directory copies preserve captured modes through verified private
  staging and destination backup/promotion; unrelated dirt still blocks
  startup. Sources: repo-template PRs #193, #210, and #212.
- **2026-07-19 — wrapper commands are real dependencies.** Policy may document
  an npm command only when the owning capability installs both its runtime file
  and package-script entry. Source: repo-template PR #197 and issue #385.
- **Standing — distribution is owner-gated.** A provider or integrator fix does
  not authorize fleet-wide writes. Every approved consumer gets an auditable
  applied, unchanged, skipped, or failed disposition. Source: `AGENTS.md`.

## Open decisions — `PROPOSED`

- Hudson Bend's repair lane must decide each current audit difference, including
  whether its missing `LICENSE` is selected or explicitly declined and which
  repo-specific documentation bodies are preserved while managed contracts are
  reconciled.
- Broader consumer dissemination remains out of scope until the owner explicitly
  authorizes a named fleet boundary.
