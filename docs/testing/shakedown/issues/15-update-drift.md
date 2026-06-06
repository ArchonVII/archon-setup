<!-- title: test: update --check reports managed workflow drift and --upgrade repairs it -->
<!-- repo: ArchonVII/archon-setup-lab-fresh -->
<!-- labels: type:test, status:shakedown, area:workflow -->
<!-- prompt: prompts/general.md -->

## Context

This shakedown exercises the `archon-setup update` command's drift-detection and repair paths against a freshly onboarded repo. Starting from a clean baseline, a managed caller workflow is manually edited to simulate drift. The `--check` flag must detect the drift and exit non-zero. Plain `update` (no flag) must re-apply the managed callers while preserving any allowed custom inputs. The `--upgrade` flag must fully replace drifted callers without preserving customizations. The `--dry-run` flag must perform no writes in any of these modes.

## Acceptance Criteria

- [ ] Starting from an onboarded repo, edit one managed caller workflow to introduce drift
- [ ] `archon-setup update --check --target <repo>` reports the drift and exits non-zero
- [ ] Plain `archon-setup update --target <repo>` re-applies managed callers and preserves allowed custom inputs
- [ ] `archon-setup update --upgrade --target <repo>` fully replaces the drifted callers
- [ ] `--dry-run` writes nothing to the target repo in any of the above modes

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
