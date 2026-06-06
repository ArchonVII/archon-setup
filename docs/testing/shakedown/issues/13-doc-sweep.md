<!-- title: test: doc-sweep recovers safe stranded docs and leaves unsafe files alone -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:docs -->
<!-- prompt: prompts/general.md -->

## Context

This shakedown exercises the doc-sweep capability end-to-end: the CLI identifies stranded documentation files that are safe to commit (add-only, under allowed paths) and leaves unsafe or ambiguous files untouched. Apply mode is lane-aware — it commits only when running in a worktree with an open PR or on primary with `--owner` — and fails closed if `gitleaks` is not installed. The `isSweepable` allow-list explicitly excludes code, scripts, `.github`, governance, manifests, Docusaurus, CI/hooks/AGENTS/README/package/tool directories, ensuring those are never swept.

## Acceptance Criteria

- [ ] Confirm `gitleaks` is installed before attempting apply (apply fails closed without it)
- [ ] Seed both safe add-only docs under allowed paths AND unsafe/ambiguous files in the target repo
- [ ] Run report mode (`node scripts/doc-sweep/sweep.mjs --repo <path>`) and confirm the `eligible`, `leaveLog`, `skip`, and `surfaceOnly` buckets are correct
- [ ] Run apply in a worktree with an open PR (or on primary with `--owner --allow-main-commit`) and confirm it commits ONLY allow-listed safe docs
- [ ] Confirm unsafe files and files in code/CI/hooks/AGENTS/README/package/tool dirs are left untouched (matching the `isSweepable` exclusions)

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
