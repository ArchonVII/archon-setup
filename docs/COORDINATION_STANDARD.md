# Repo-Local Coordination Standard

> **Status:** Validated design (brainstorming complete 2026-05-29). Not yet implemented.
> **Owner surface:** `repo-template` (contract + scaffold) and `archon-setup` (registry feature). No reusable workflow required.

## Governing principle — context isolation

A repo coordinates **only itself**. Nothing machine-global is told about any specific
repo (pigafetta, skills, jma-history, or any sibling), and no repo assumes a sibling
exists unless it explicitly documents that dependency. Any dev, any machine, any repo —
setup output carries **zero** knowledge of another repo and **zero** machine-specific paths.

This standard replaces the prior arrangement where a machine-global
`~/.claude/CLAUDE.md` _Coordination Board_ directive caused every project on the
owner's machine to read/write a shared `~/.claude/coordination/board.md` that knew
about all sibling repos.

## Understanding summary

- "Set up a repo" = run the archon-setup feature registry (locked foundations +
  opt-in remote / agent-workflow / PR-contract / CI). The registry already ships **no**
  board / wiki / librarian feature — the tool was built on the
  tool-agnostic-capability principle.
- The only cross-repo leakage in **shipped** output was: cosmetic pigafetta name-drops
  in `repo-template/.githooks/pre-commit` and `github-workflows/.../pr-policy.yml`, plus
  a blank `AGENTS.md ## Coordination` placeholder.
- The real "every repo touches a shared board / knows about siblings" behavior lived in
  the owner's **personal** `~/.claude/CLAUDE.md` (_Coordination Board_ and
  _Cross-Repo Coordination_ sections) — not in the tool.

## Assumptions

- `.agent/` is the live in-repo convention (used by `pre-commit` bypass log and
  `.agent/check-map.yml`). Coordination lives under `.agent/coordination/`.
  (The `.archon/` path in older notes is superseded by `.agent/`.)
- `HANDOFF.md`, `ecosystem-status.md`, and `docs/` are internal to the tool and never
  shipped into a target repo — their pigafetta mentions are out of scope.
- Repos decide their own collaboration model; setup must not assume live coordination
  state is committed vs. ignored vs. handled via issues/PRs.

## Non-goals

- Not changing which features the wizard offers (beyond adding one opt-in feature).
- Not rewriting workflow logic or pigafetta's own working behavior.
- Not forcing active coordination machinery onto repos that have no coordination need.

## Decision log

| #   | Decision                                                                         | Alternatives                           | Why                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope = define contract + deep audit + scrub tool refs + reconcile global config | Tool-only; global-only                 | User selected all four                                                                                                                                         |
| D2  | Coordination is **repo-local and internal**; no machine-global board             | Keep shared board; conditional opt-in  | Context isolation — each repo coordinates only itself                                                                                                          |
| D3  | Relocate _Cross-Repo Coordination_ out of global into participating repos        | Keep global; delete entirely           | Context isolated to those who need it                                                                                                                          |
| D4  | Approach 1, **split**: locked contract/location, opt-in active board             | All-locked; contract-only; audit-first | A locked _contract_ gives a consistent "where would coordination live?" answer; an opt-in _board_ avoids forcing process machinery on repos that don't need it |
| D5  | Coordination is a **directory** `.agent/coordination/`, not a single file        | Single `.agent/coordination.md`        | Room to grow (claims/, handoffs/, references/) without redesign                                                                                                |
| D6  | Repo owns the **contract**; team owns whether live state is tracked              | Setup picks one model                  | Don't assume one collaboration model                                                                                                                           |

## Final design

### Target shape

```text
.agent/
  check-map.yml
  coordination/
    README.md          # LOCKED foundation — neutral contract (always present)
    board.md           # OPT-IN — created only when active coordination is enabled
    claims/            # OPT-IN — grows as needed
    handoffs/          # OPT-IN
    references/        # OPT-IN — documented cross-repo dependencies, if any
```

### Locked foundation (every repo)

`AGENTS.md` gains a real `## Coordination` section (replacing the blank placeholder),
and setup scaffolds `.agent/coordination/README.md` with the neutral contract:

```md
## Coordination

This repo is coordination-isolated.

Do not read from or write to machine-global coordination boards.
Do not assume sibling repositories exist.
Do not reference another repo unless this repo explicitly documents that dependency.

When coordination is needed, use this repo's local coordination area:

    .agent/coordination/

Active boards, claims, locks, or handoffs belong here or in another repo-local
location documented by this repo.
```

### Opt-in active board (registry feature)

A new opt-in registry feature (group `agent-workflow`) — e.g.
`agent-workflow.coordination-board` — scaffolds `.agent/coordination/board.md` from a
neutral template covering: claim format, high-contention files / sequencing, stale-claim
cleanup, and worktree rules. It does **not** name any repo or machine path.

### Tracked vs. untracked

```text
Tracked (committed):
  .agent/coordination/README.md          # the contract
  .agent/coordination/board.md           # template, only if the opt-in feature is enabled

Team's choice (may be gitignored):
  ephemeral locks
  local scratch
  temporary claim files
```

The repo owns the **contract**; the team decides whether live coordination state is
committed, ignored, or handled through issues/PRs.

### Global config cleanup (owner's machine)

Remove from `~/.claude/CLAUDE.md`:

- the **Coordination Board** section (the `~/.claude/coordination/board.md` read/write habit)
- the **Cross-Repo Coordination** section (auto-create `reference_<repo>.md` memory)

These are the only repo/ecosystem-coupled sections in global config; everything else is
genuinely cross-project and stays.

### Repo-local relocation

Repos that actually participated in the shared board (pigafetta, skills, jma-history, or
any other) carry their own coordination rules internally under `.agent/coordination/`
(or, for pigafetta, in its existing `AGENTS.md`, which already owns coordination — verify
before duplicating).

### Audit / scrub

- Remove pigafetta name-drops from shipped templates:
  `repo-template/.githooks/pre-commit:8`, `github-workflows/.../pr-policy.yml:31`
  (and the mirrored snapshot copies under `archon-setup/src/snapshots/`).
- Sweep every shipped artifact (AGENTS.md, all workflow callers, hooks, CLAUDE.md /
  GEMINI.md templates, check-map) to verify no setup output references another repo or a
  machine-specific path.

## Rollout sequence

No reusable workflow is involved, so this is lighter than the anomaly-triage rollout:

1. `repo-template` PR: new `AGENTS.md ## Coordination` contract + scaffolded
   `.agent/coordination/README.md` + scrub `.githooks/pre-commit:8`.
2. `github-workflows` PR: scrub `pr-policy.yml:31` comment (doc-only; no v1 tag move
   needed unless a workflow body changes).
3. `archon-setup` PR: add the opt-in `coordination-board` registry feature + neutral
   `board.md` template; `npm run refresh-snapshots`; re-run tests.
4. Owner-machine (not a repo PR): edit `~/.claude/CLAUDE.md`; relocate behavior into
   participating repos' own configs.
