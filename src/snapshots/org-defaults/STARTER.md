# Starting a New Repo — Document Policies

How I set up the canonical docs in a new project. Apply these as a checklist when bootstrapping a repo.

These conventions are **enforced** in some cases (CI gates `## Verification` and CHANGELOG fragments) and **recommended** in others (README structure). When the convention is enforced, the relevant workflow lives in [`ArchonVII/github-workflows`](https://github.com/ArchonVII/github-workflows).

---

## The doc set

| File                         | When to add                                                               | What it answers                                                                |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `README.md`                  | **Always**, on first commit                                               | What is this and how do I run it?                                              |
| `LICENSE`                    | **Always**, on first commit                                               | What can I do with this?                                                       |
| `.gitignore`                 | **Always**, on first commit                                               | What should never be committed?                                                |
| `AGENTS.md`                  | When AI agents (Claude, Codex, Copilot) will touch the repo               | How should AI agents work in this repo?                                        |
| `CLAUDE.md` / `GEMINI.md`    | When Claude- or Gemini-specific behavior needs codifying beyond AGENTS.md | Per-tool addenda                                                               |
| `ARCHITECTURE.md`            | When the directory layout stops being obvious from a glance               | Where does each subsystem live?                                                |
| `CONTRIBUTING.md`            | If you accept outside PRs                                                 | How do I propose a change?                                                     |
| `SECURITY.md`                | If the repo handles untrusted input or auth                               | How do I report a vulnerability? (Default inherited from `ArchonVII/.github`.) |
| `CODEOWNERS` (in `.github/`) | When reviewers should auto-assign on a PR                                 | Who reviews what?                                                              |
| `CHANGELOG.md`               | When something other than you needs to track history                      | What shipped, and when?                                                        |
| `TODO.md`                    | **Only** when GitHub issues are too heavy for your backlog                | What's queued that isn't on the issue tracker?                                 |
| `.changelog/unreleased/`     | When `CHANGELOG.md` is too high-contention for parallel PRs               | (See "CHANGELOG" below)                                                        |
| `docs/`                      | When the README starts to outgrow itself                                  | Deep references, tutorials, specs                                              |
| `docs/adr/NNN-*.md`          | When a decision needs a paper trail                                       | Why was X chosen over Y?                                                       |

---

## README.md

Goal: a stranger should be able to clone the repo, get it running, and understand what it does in under 5 minutes.

**Minimum sections:**

```markdown
# <Project Name>

One-sentence description: what this is and who it's for.

## Quickstart

\`\`\`bash
git clone https://github.com/<owner>/<repo>
cd <repo>
<install command>
<run command>
\`\`\`

## What this is

A paragraph or two of context. What problem does it solve? What's the
shape of the system?

## Status

Production / Active development / Maintenance / Experimental / Abandoned.
Date your last status update.

## License

<SPDX ID> — see LICENSE.
```

**Add as the project grows:**

- Architecture diagram or link to `ARCHITECTURE.md`
- Configuration / environment variables
- Common commands (test, lint, build, deploy)
- Contribution pointer → `CONTRIBUTING.md` or `AGENTS.md`
- Roadmap pointer → `TODO.md` or GitHub Projects

**Do not:**

- Pad with badges nobody reads. One CI badge + one license badge is plenty.
- Duplicate `ARCHITECTURE.md` content. Link to it.
- Write a marketing pitch. Be direct.

---

## CHANGELOG.md + `.changelog/unreleased/` fragments

Two modes — pick one per repo:

### Mode 1 — Simple: edit `CHANGELOG.md` directly

For solo repos with low PR concurrency. Use **Keep a Changelog** format:

```markdown
# Changelog

## [Unreleased]

### Added

- New thing

### Changed

- Behavior shift

### Fixed

- Bug fix

## [0.2.0] - 2026-05-13

### Added

- ...
```

### Mode 2 — Fragments: `.changelog/unreleased/<issue>-<slug>.md`

For repos with concurrent agents or parallel PRs. **`CHANGELOG.md` becomes high-contention shared state** — every PR wants to add to `## [Unreleased]`. Switch modes when you start hitting merge conflicts on it.

Each PR adds a uniquely-named fragment under `.changelog/unreleased/`. A periodic fold concatenates them into `CHANGELOG.md` and deletes the fragments in one atomic commit.

**To enforce:** wire in [`ArchonVII/github-workflows/.github/workflows/changelog-fragment.yml`](https://github.com/ArchonVII/github-workflows/blob/v1/examples/changelog-fragment.yml). It blocks any PR touching `src/` that doesn't add a fragment, unless labeled `no-changelog`.

**Pair with:** [`ArchonVII/.github/.github/release.yml`](https://github.com/ArchonVII/.github/blob/main/.github/release.yml) — auto-categorizes merged PRs by label when you run `gh release create --generate-notes`.

### What is "release-worthy"?

Add an entry (or fragment) when:

- ✅ User-visible behavior changed
- ✅ A public API or schema changed
- ✅ A dependency upgrade has user-facing implications
- ✅ A security fix landed

Skip:

- ❌ Internal refactors with no behavior change
- ❌ Test-only changes
- ❌ Pure docs / typo fixes
- ❌ CI / tooling tweaks

For repos using Mode 2, label these PRs `no-changelog` to bypass the CI gate.

---

## TODO.md

**Default: don't use TODO.md.** Use GitHub Issues. Issues get:

- Permanent URLs you can link from PRs, commits, and docs
- Labels, milestones, assignees
- Search, filters, dependencies
- Reactions and comments

**When TODO.md is the right tool:**

- The list is so trivial that creating issues feels heavier than the work
- The repo is pre-issue-tracker (private scratch, day-1 prototype)
- The list is a **structured snapshot** of priorities, not a backlog (e.g. "Wave 5 / Wave 6" planning, where each section is its own milestone)

If you keep a `TODO.md`:

- Group by priority or theme, not by date
- Archive completed items to `docs/archive/shipped/<date>-<slug>.md` rather than deleting them
- Sync to issues when something graduates from "rough idea" to "I'm about to work on this"

---

## ARCHITECTURE.md

**When to add:** Once the directory layout has more than ~6 top-level folders, or when a new contributor would have to read code to know where to look.

**Sections:**

```markdown
# Architecture

## Pipeline / data flow

<How data moves through the system, top to bottom.>

## Directory ownership

| Path           | Purpose          |
| -------------- | ---------------- |
| src/ui/        | All 2D UI        |
| src/rendering/ | All 3D rendering |
| ...            | ...              |

## Cross-boundary rules

<What can import what. Module layering. Forbidden dependencies.>

## Key files

<10–20 most-edited or most-load-bearing files, with one-line descriptions.>
```

**Anti-pattern:** Don't try to document every file. Document the _layering_ — once someone understands the layering, they can find a file by name.

---

## AGENTS.md / CLAUDE.md / GEMINI.md

**AGENTS.md** is the cross-tool contract. It's the **first thing** an AI agent should read when entering the repo. Cover:

- Repo-specific workflow (issue → branch → PR → merge)
- Lane discipline / parallel agent rules if applicable
- Commit convention
- Verification expectations before claiming done
- Where the canonical state lives (`ARCHITECTURE.md`, `README.md`, etc.)

**CLAUDE.md / GEMINI.md** are addenda — tool-specific quirks that don't belong in the cross-tool contract. Hooks, model-specific guardrails, etc.

If your repo doesn't have agents working in it, skip these. Don't pre-write them.

---

## ADRs (`docs/adr/`)

Architecture Decision Records. One markdown file per architecturally-significant decision.

**Add an ADR when:** the decision is non-obvious, costly to reverse, and someone six months from now would wonder why.

**Skip an ADR when:** the decision is obvious from the code, has a one-paragraph rationale that fits in a code comment, or is reversible in an afternoon.

**Format:** [MADR](https://adr.github.io/madr/) is fine. Minimum:

```markdown
# NNN. <Title>

Date: YYYY-MM-DD
Status: Proposed / Accepted / Superseded by NNN

## Context

<Why is this a decision worth recording?>

## Decision

<What did we decide?>

## Consequences

<What changes because of this? What new constraints exist?>
```

---

## Checklist for a new repo

- [ ] `README.md` — quickstart + what + status
- [ ] `LICENSE` — pick before first commit
- [ ] `.gitignore` — language-appropriate; copy from `github/gitignore` on GitHub
- [ ] Initial commit on `main`, then never commit to `main` again
- [ ] Run `node scripts/setup-repo.mjs ArchonVII/<repo> --solo` from `github-workflows` to apply labels + branch protection
- [ ] Add caller workflows from `github-workflows/examples/` as needed:
  - [ ] `pr-policy.yml` (always)
  - [ ] `pr-body-autoinject.yml` (if any bots author PRs)
  - [ ] `codeql.yml` (any non-trivial code)
  - [ ] `dependency-review.yml` (any dependencies)
  - [ ] `auto-merge-dependabot.yml` + `.github/dependabot.yml` (any dependencies)
  - [ ] `node-ci.yml` / `python-ci.yml` (run lint + typecheck + tests)
  - [ ] `stale.yml` + `lock-threads.yml` (after the repo accumulates issues)
  - [ ] `changelog-fragment.yml` (when you switch to fragment mode)
- [ ] Add `.github/CODEOWNERS` — minimum `* @<your-handle>`
- [ ] Decide CHANGELOG mode (direct edit vs fragments) and commit `CHANGELOG.md` and/or `.changelog/unreleased/README.md`
- [ ] Add `AGENTS.md` if AI agents will work here
- [ ] Add `ARCHITECTURE.md` once layout grows past obviousness

---

## Inheritance from `ArchonVII/.github`

Any of these files **auto-apply** to repos that don't ship their own copy:

- `PULL_REQUEST_TEMPLATE.md`
- All `ISSUE_TEMPLATE/*.yml` (task, bug, feature_request, chore, documentation)
- `SECURITY.md`
- `.github/release.yml` (auto-categorized release notes)

You only need to write these in a new repo if you want to **override** the default.
