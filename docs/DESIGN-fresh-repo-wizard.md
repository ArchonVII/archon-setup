# Design: Finish the fresh-repo wizard (folder picker + baseline parity)

> **Status:** Implemented in PRs #37, #38, and #39. Pre-implementation design
> produced via structured brainstorming. Cross-references issue [#34].
> **Author:** Claude (Opus 4.8), 2026-05-30.

## Understanding summary

- **What:** Make the archon-setup browser wizard a complete _fresh-repo_ setup
  process by (1) adding a native folder picker to the Location screen and
  (2) making the wizard's generated repo **baseline-equivalent to
  `ArchonVII/repo-template`**, then validating end-to-end.
- **Why:** `archon-setup update` only syncs existing managed workflow callers; it
  does not scaffold. The wizard was built for fresh repos but its folder field is
  unusable text-entry and its `foundations` group is missing baseline files
  (hooks, actionlint, CODEOWNERS, dependabot, PR template, CHANGELOG,
  .gitattributes). So no working fresh-repo path actually existed.
- **Who for:** Developers and agents bootstrapping or standardizing repos using
  archon-setup. Must work without assuming any sibling repo, personal machine
  config, or project-specific context.
- **Key constraints:** preserve the existing security posture (token + Origin/Host
  pinning, POST-only state-changing RPCs); reuse the existing
  planner/executor/registry — no second scaffold engine; Windows-first picker;
  changes land via archon-setup's own issue→branch→PR contract.
- **Non-goals:** no headless `init` CLI; no Vite/React migration; no
  cross-platform picker; **not** taking on #34's existing-repo audit/reconcile/
  no-clobber mode (this lane only _shares machinery_ toward it).

## Repo-agnostic invariant (hard constraint)

Generated output must not name another repo, a global coordination board, or a
machine path. It must not reference hudson-bend, pigafetta, skills, jma-history,
or any sibling repo. The neutral baseline is **`repo-template`, not hudson-bend** —
hudson-bend is evidence that a gap exists, never the template.

The one allowed cross-repo reference is the **ecosystem dependency**:
`ArchonVII/github-workflows@v1` in workflow callers. That is the shared provider
this ecosystem depends on by design (see ecosystem-status.md topology), not a
consumer/sibling reference.

## How this fits the existing plans

Three planning layers exist and must not be conflated:

| Layer                                             | Scope                               | This lane                                                                                                                 |
| ------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **F-roadmap F1–F19** (`docs/ecosystem-status.md`) | cross-repo governance findings      | Closes the archon-setup half of **F18** (`.githooks/` baseline shipped in repo-template but never wired into the wizard). |
| **`ROADMAP.md`** (archon-setup product)           | the wizard/CLI itself               | This _is_ "End-to-end wizard hardening" (listed In Progress).                                                             |
| **Issue [#34]** (existing-repo flow)              | audit/plan/apply for lived-in repos | Shares machinery: `foundation.hooks`, manifest accuracy. This lane does **not** build #34's audit/reconcile.              |

Mapping of the two user sessions:

- **hudson-bend** (done, by hand) ≈ #34's existing-repo runbook
  (`docs/ONBOARDING_EXISTING_REPO.md`).
- **This effort** = the fresh-repo wizard finish.

## Decision log

| #   | Decision                                                                      | Alternatives                         | Why                                                                                                             |
| --- | ----------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| D1  | Finish the browser wizard as the fresh-repo process                           | headless CLI; manual runbook         | Wizard already exists (doctor→location→features→review→execute) with a real planner/executor; no second engine. |
| D2  | Native OS folder dialog for the picker                                        | in-page browser; text+validation     | Closest to "pull up a directory"; matches user ask. Windows-first.                                              |
| D3  | `folder.pick` is a hardened POST RPC, not a scaffold task                     | GET RPC; task module                 | It's UI assistance, not repo work. Reuses token+Origin/Host gate; POST via STATE_CHANGING.                      |
| D4  | Text field stays canonical fallback                                           | replace with picker                  | Headless/no-desktop safety; user decision. Browse only _populates_ targetPath.                                  |
| D5  | Neutral baseline = repo-template tracked files                                | hudson-bend shape                    | Repo-agnostic invariant; avoid accidental golden template.                                                      |
| D6  | Promote `actionlint.yml` to locked foundation                                 | keep under CI group                  | Hygiene for any repo with workflows; inert without a remote; no language assumption.                            |
| D7  | Auto-activate hooks (`core.hooksPath .githooks`) after git-init               | write-only + document                | Hooks are useless if copied-but-dormant. Guarded: don't overwrite a different existing hooksPath.               |
| D8  | CODEOWNERS only when a real owner is known; else record intentionally-skipped | always write `* @owner`; always skip | Avoids junk owner; stays honest via manifest/review.                                                            |
| D9  | Narrow manifest-accuracy fix rides along                                      | defer all to #34; full redesign      | Baseline tasks touch createdFiles accounting; fix the local already-done/createdFiles mismatch only.            |
| D10 | Extend SHA-pinned snapshots; no hand-copied files                             | hand-copy repo-template files        | Matches "don't hand-edit snapshots" operating rule.                                                             |
| D11 | One tracking issue → 3 staged PRs                                             | one big PR; doc-PR-first             | Reviewable, bisectable.                                                                                         |

## Design

### §1 Folder picker

- **RPC:** add `"folder.pick"` to `RPC` (rpc.mjs) and `STATE_CHANGING`.
- **Impl:** `src/server/lib/pickFolder.mjs` — `spawn` (not `exec`) PowerShell with a
  **fixed static script** (no user input interpolated). Windows
  `FolderBrowserDialog`/Vista folder dialog.
  - Returns `{ path }` (resolved absolute, normalized via `path.resolve` — no
    further validation), `{ cancelled: true }`, `{ unsupported: true }`
    (non-win32), or `{ error }`.
  - **Timeout** (~120s) via killable child; on timeout → `{ error: "dialog timed out" }`
    so a hung dialog never wedges the server.
  - Side-effect-free apart from opening the dialog: creates no folders, no git, no
    fs writes. Validation stays in `checkTargetPath`/planner.
- **UI** (`app.mjs renderLocation`): `[Browse…]` button beside the existing text
  input. `{path}`→set targetPath + re-render; `{cancelled}`→silent no-op;
  `{unsupported|error}`→small fallback toast, leave text field focused/editable.
- **Tests:** RPC behavior with the picker implementation **mocked** — never
  automate the real native dialog.

### §2 Baseline parity (additive to `foundations`)

New locked `foundation.*` features + tasks, sourced from **extended SHA-pinned
repo-template snapshots** (D10):

| Feature                    | Task                      | Writes                                                                                                         | Notes                                                                                                                                      |
| -------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `foundation.hooks`         | `writeGithooks`           | `.githooks/{commit-msg,pre-commit,scripts/install-githooks.sh,owner-maintenance.sh,test-owner-maintenance.sh}` | **Scrub** repo-template-internal refs (F18, repo-template#16, docs/phase2/…). Auto-activate post-init (D7) with the not-overwriting guard. |
| `foundation.gitattributes` | `writeGitattributes`      | `.gitattributes`                                                                                               | LF for `*.sh` + `.githooks/*`.                                                                                                             |
| `foundation.changelog`     | `writeChangelog`          | `CHANGELOG.md`, `.changelog/unreleased/README.md`                                                              | Mode 2 (fragments).                                                                                                                        |
| `foundation.actionlint`    | `installWorkflow` (reuse) | `.github/workflows/actionlint.yml`                                                                             | Promoted to locked foundation (D6). Verify it carries no stack assumption; if it does, demote + flag.                                      |
| `foundation.codeowners`    | `writeCodeowners`         | `.github/CODEOWNERS`                                                                                           | `* @<owner>`; **skip + record intentionally-skipped** when no owner (D8).                                                                  |
| `foundation.dependabot`    | `writeDependabot`         | `.github/dependabot.yml`                                                                                       | github-actions ecosystem, weekly. Inert until pushed.                                                                                      |
| `foundation.pr-template`   | `writePrTemplate`         | `.github/PULL_REQUEST_TEMPLATE.md`                                                                             | Inert until pushed.                                                                                                                        |

Tension resolutions (repo-agnostic rule): baseline workflow _files_ (actionlint)
write locally regardless of remote; _remote actions_ (repo create, labels, branch
protection) stay remote-gated. `@v1` is the allowed ecosystem dependency.

### §3 Hooks-path preflight (guardrail for D7)

New preflight check: if `core.hooksPath` is already set to a value other than
`.githooks`, surface a **warning** and do not silently overwrite; auto-activation
proceeds only on unset / `.githooks` / explicit user OK.

### §4 Manifest accuracy (narrow, D9)

Fix the `taskRunner` `already-done`/`createdFiles` mismatch: only push to
`manifest.createdFiles` when a task actually wrote. Add `manifest.skippedFiles[]`
(`{path, reason}`) surfaced on the Review screen (also carries D8's
intentionally-skipped CODEOWNERS). **Stop there** — no #34 manifest redesign.

## Validation strategy

1. **Local-only dry run** first: scaffold into a temp dir with remote features
   off; assert the tree matches the repo-template baseline file set; confirm no
   damage and no sibling-repo/machine-path strings in output.
2. **One real throwaway GitHub repo** smoke test (clearly named, cleaned up
   after): exercise repo create, labels, branch protection, workflow files,
   permissions. Code-read alone is insufficient for the remote path.
3. `node --test` green; new tests for picker RPC (mocked), each foundation task,
   hooks-path preflight, manifest accounting.

## Delivery (D11)

One tracking issue, then:

- **PR1:** `folder.pick` RPC + UI + mocked tests.
- **PR2:** snapshot subset extension + `refresh-snapshots` + `foundation.*`
  baseline tasks + hooks-path preflight + tests.
- **PR3:** manifest-accuracy fix + this design doc + ROADMAP/ONBOARDING updates;
  comment on #34 recording closed gaps (hooks, manifest accuracy, baseline
  parity) vs. left-open (audit/plan/apply, AGENTS reconcile, no-create path).

Each PR green before the next.

## Assumptions

- A desktop session is available for the native dialog (text field is the
  fallback otherwise).
- repo-template's `actionlint.yml` is a self-contained `@v1` caller with no stack
  assumption (to be verified in PR2; demote if false).
- The local-only dry run can skip `remote.github`-gated features cleanly.

## Risks

- **Native dialog environment variance** (no desktop, STA mode) → mitigated by
  timeout + fallback toast + text field.
- **Snapshot scrubbing** could miss an internal ref → tested by asserting no
  `F18`/`repo-template#`/`phase2` strings in generated hooks.
- **Scope creep toward #34** → explicitly bounded by D9 and non-goals.

[#34]: https://github.com/ArchonVII/archon-setup/issues/34
