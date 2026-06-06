<!-- title: test: anomaly triage opens an issue for an unrelated finding -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:triage -->
<!-- prompt: prompts/off-task-anomaly.md -->

## Context

This shakedown exercises the anomaly-triage workflow's "unrelated" path: when an entry in `.archon/anomalies-thispr.md` has a `File:` that is NOT in the PR's diff and does not set `Related to PR: yes`, the workflow must open a new GitHub issue with a back-link to the originating PR and the `auto-triaged` label. Re-running the workflow (via another commit or manual re-trigger) must not create a duplicate issue, confirming idempotent behavior for the unrelated path.

## Acceptance Criteria

- [ ] Add an **unrelated** entry to `.archon/anomalies-thispr.md` (canonical format; its `File:` is NOT in the PR diff and it does not set `Related to PR: yes`)
- [ ] After the workflow triggers, a **new GitHub issue** is opened with a back-link to the PR and the `auto-triaged` label
- [ ] Re-running (another commit or manual re-trigger) does NOT create a duplicate issue

Canonical anomaly entry format (copy and fill in):

```markdown
## <Short title — what's wrong>

- **Severity:** low | medium | high | critical
- **File:** path/to/file.ext (optional; helps the classifier)
- **Related to PR:** yes | no | unknown (optional; default unknown)
- **Downstream repo:** owner/repo (optional; only when the root cause lives in another repo)

<One or two paragraphs explaining what's wrong, what you observed, and any fix hypothesis.>
```

An entry is classified **unrelated** when its `File:` is NOT in the PR diff and it does not set `Related to PR: yes`. Such entries result in a new GitHub issue, not a PR comment.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
