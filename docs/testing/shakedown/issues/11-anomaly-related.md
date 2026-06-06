<!-- title: test: anomaly triage posts a related PR comment -->
<!-- repo: ArchonVII/archon-setup-lab-pr-contract -->
<!-- labels: type:test, status:shakedown, area:triage -->
<!-- prompt: prompts/off-task-anomaly.md -->

## Context

This shakedown exercises the anomaly-triage workflow's "related" path: when an agent appends an entry to `.archon/anomalies-thispr.md` whose `File:` field points to a file that appears in the PR's diff, the workflow must post a sticky PR review comment containing that entry body. On subsequent commits that update only the anomaly wording, the workflow must update the existing sticky comment rather than posting a second one, ensuring PR review threads stay uncluttered.

## Acceptance Criteria

- [ ] Add `.archon/anomalies-thispr.md` to the PR branch containing a **related** entry (using the canonical format below) whose `File:` value matches a file that is in the PR's diff
- [ ] After the workflow triggers (`[opened, ready_for_review, synchronize]`), a **sticky PR review comment** appears on the PR containing the entry body
- [ ] Make a second commit that edits only the anomaly wording in `.archon/anomalies-thispr.md`; confirm the workflow updates the **same** sticky comment and no duplicate comment is created

Canonical anomaly entry format (copy and fill in):

```markdown
## <Short title — what's wrong>

- **Severity:** low | medium | high | critical
- **File:** path/to/file.ext (optional; helps the classifier)
- **Related to PR:** yes | no | unknown (optional; default unknown)
- **Downstream repo:** owner/repo (optional; only when the root cause lives in another repo)

<One or two paragraphs explaining what's wrong, what you observed, and any fix hypothesis.>
```

An entry is classified **related** when its `File:` is in the PR diff OR it sets `Related to PR: yes`.

## Verification

Record exact commands, repo URL, workflow run names/URLs, and any deferred checks.
