# Authority model — what actually authorizes the loop to act

Companion to [`docs/runtime-loop.md`](./runtime-loop.md). Written for #187 from the
2026-06-11 audit RFC (finding D12): "trustworthy v0.1" is unfalsifiable unless the
trust anchor is stated explicitly. This is that statement.

## The trust anchor is the `gh` token

Every mutating step in the PR lane — branch push, PR creation, labeling, auto-merge
queueing, PR closure — executes through the `gh` CLI. **Whoever holds a `gh` token
with write access to the target repo holds the loop's entire authority.** There is
no second factor inside the loop. Branch protection on the target repo (required
checks, required reviews) is the only machine boundary above the token, and
configuring it is operator responsibility: the lane *verifies* protection exists
(`resolveRequiredChecks` fails closed and `auto` mode refuses on an empty required
set) but never creates it.

## The confirmation phrase is scope, not authentication

The phrase (`APPLY <repo> <runId>`, `src/server/decisions/intake.mjs`
`confirmationPhraseForRun`) is **derivable from public run facts**. Anyone — and any
model — that can read a run record can construct it. It exists to *bind a stated
intent to exactly one repo and run* so a pasted confirmation can never authorize a
different apply. It authenticates nothing and must never be treated as a secret or
listed as a security control.

## Who may do what

| Action | Authority |
|---|---|
| Execute `runUpdate` (any mode) | Operator with a writable `gh` token for the target; phrase scopes the run |
| Merge a lane PR | GitHub branch protection: required checks + any required review; `auto` mode only queues `gh pr merge --auto` behind the eligibility gate |
| Enable auto-merge for a category | Reviewed archon-setup PR widening `DEFAULT_GUARDS_CONFIG` (locked: `agents` only in v0.1) |
| Execute `rollback` / `cleanup` | Same operator token; rollback opens a revert PR — it never mutates `main` directly |
| Merge a revert PR | Always a human; the lane refuses to auto-merge its own rollbacks |

## Known interaction to decide explicitly (deferred)

`enforce-role-separation` exists in the repo-template's `pr-policy` but defaults
off. Its `role-protected-paths` include `AGENTS.md` — the very file the lane
distributes. Flipping it on for consumer repos would require non-author approval
for every lane PR, which conflicts with auto-merge. Do not enable it for a consumer
repo without deciding that interaction first; record the decision here when made.
