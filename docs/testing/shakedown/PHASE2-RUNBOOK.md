# Phase 2 — Shakedown Operational Runbook

> Companion to [`README.md`](./README.md) and the [design spec](../../superpowers/specs/2026-06-05-archon-setup-shakedown-design.md).
> This is **not** an archon-setup PR — it is the operator runbook that *uses* the merged harness to run
> the shakedown against three throwaway lab repos, capture evidence, and gate the 0.1.0 re-cut.
> PowerShell throughout. Every step past Step 0 hits real GitHub + Actions minutes, so it is operator-paced.

## Phase 2 start gate — do not run until all checked

```text
[ ] Multiline commands use backticks (`) or are single-line.
[ ] C:\GitHub\_scratch exists.
[ ] No remote ArchonVII/archon-setup-lab-* repos already exist (collision check passed).
[ ] gh auth user is ArchonVII; delete_repo NOT yet granted (added only at teardown).
[ ] actionlint installed.
[ ] gitleaks decision recorded: full install (preferred) OR scoped #13.
[ ] If #13 scoped -> publish-gate impact recorded (publish stays deferred unless explicitly accepted).
[ ] lab-pr-contract seed includes package-lock.json + single-file test script.
[ ] Case IDs (1-15) are treated as harness IDs, NOT GitHub issue numbers.
[ ] issue-map-<date>.json will be written after filing.
[ ] Headless remote-create failure cannot be marked green via wizard fallback.
[ ] Local-mode remote.* behavior is expected as skip/warn/no-op (any GitHub mutation in 8.1/8.2 = FAIL).
```

## Step 0 — Preflight (least-privilege; no delete_repo yet)

```powershell
$ErrorActionPreference = 'Stop'
gh auth status                 # ArchonVII
node --version                 # >= 20
actionlint --version
gitleaks version               # may be ABSENT — see decision below

New-Item -ItemType Directory -Force C:\GitHub\_scratch | Out-Null

$LabRepos = @('archon-setup-lab-fresh','archon-setup-lab-pr-contract','archon-setup-lab-lived-in')
foreach ($r in $LabRepos) {
  gh repo view "ArchonVII/$r" *> $null
  if ($LASTEXITCODE -eq 0) {
    throw "Remote repo already exists: ArchonVII/$r. Archive/delete or use a fresh suffix before Phase 2."
  }
}
```

**gitleaks decision (gates Case #13 only).** *Recommended:* install gitleaks now if this run is meant to
**unblock publish** — doc-sweep *apply* fails closed without it. If you instead run report-mode, record
Case #13 as **scoped/partial** (the apply-commit acceptance criterion is not exercised) and keep publish
**deferred** unless you explicitly accept report-mode coverage for this release.

## Step 1 — Create the three lab repos

The full feature set (spec §2.1, expanded to the real registry IDs in `src/registry/features.json` —
`foundation.*` is not a glob the CLI accepts, so it is enumerated):

```powershell
cd C:\GitHub\archon-setup
$FEATURES = @(
  'foundation.actionlint','foundation.agents','foundation.changelog','foundation.claude-md',
  'foundation.codeowners','foundation.coordination','foundation.dependabot','foundation.gemini-md',
  'foundation.git-init','foundation.gitattributes','foundation.gitignore','foundation.hooks',
  'foundation.license','foundation.pr-template','foundation.readme',
  'remote.github','remote.labels','remote.branch-protection',
  'agent-workflow.check-map','agent-workflow.coordination-board','agent-workflow.anomaly-triage',
  'workflow.pr-policy','workflow.semantic-pr-title','workflow.pr-body-autoinject','workflow.branch-naming',
  'workflow.required-gate','workflow.node-ci',
  'agent-lifecycle.baseline','agent-workflow.doc-sweep','agent-workflow.doc-orphan-detector'
) -join ','
```

### 1a. `archon-setup-lab-fresh` — golden happy-path, Test #0 (spec §8.1–8.3)

```powershell
# 8.1 local dry-run (no --owner => no remote). Review the resolved plan + dependency warnings.
npm run onboard -- C:\GitHub\_scratch\lab-fresh --features $FEATURES --dry-run --json

# 8.2 local real write (no --owner => no remote). Confirm files, .githooks, .github/archon-setup.json manifest.
npm run onboard -- C:\GitHub\_scratch\lab-fresh-write --features $FEATURES --json

# 8.3 create the REAL remote (this IS Test #0):
npm run onboard -- C:\GitHub\_scratch\lab-fresh-remote `
  --owner ArchonVII `
  --repo archon-setup-lab-fresh `
  --visibility private `
  --features $FEATURES
```

**Local-mode expectation (8.1/8.2).** `remote.github` / `remote.labels` / `remote.branch-protection` must
NOT mutate GitHub without `--owner`/`--repo` — they should surface as skipped/warned plan entries. **Any
attempted remote mutation during 8.1/8.2 is a FAIL.** (We are deliberately testing that `remote.*` degrade
safely in local mode — that behavior has value, so we assert it rather than stripping those features.)

**Headless remote-create — row-0 evidence rule (do not let the wizard mask a CLI bug):**

```text
PASS         = `npm run onboard --owner/--repo` created remote + labels + branch protection.
PARTIAL/FAIL = browser-wizard fallback (npm run dev) was used to create the repo.
```

The wizard fallback is operationally legitimate to keep the matrix moving, but it is **not** proof the CLI
path works. Record which path created the repo in row 0. (Memory flags `archon-setup#46` as the
headless-onboard-CLI follow-up.)

### 1b. `archon-setup-lab-pr-contract` — tiny onboarded Node repo (spec §2.3)

Seed first (lockfile + single-file test script to avoid Windows glob ambiguity), then onboard:

```powershell
$pc = 'C:\GitHub\_scratch\lab-pr-contract'
New-Item -ItemType Directory -Force "$pc\src","$pc\test","$pc\docs" | Out-Null
# Seed package.json scripts:  "lint": "node --check src/math.js" ,  "test": "node --test test/math.test.mjs"
# plus src/math.js, test/math.test.mjs, docs/usage.md, README.md
cd $pc
npm install --package-lock-only     # seed package-lock.json (defensive — see verify-point on node-ci install)
cd C:\GitHub\archon-setup
npm run onboard -- $pc `
  --owner ArchonVII `
  --repo archon-setup-lab-pr-contract `
  --visibility private `
  --features $FEATURES
```

Ensure the **lockfile is committed/pushed before the first CI-gated PR test**.

### 1c. `archon-setup-lab-lived-in` — deliberately messy EXISTING repo, NOT onboarded (spec §2.2)

Hand-seed the cruft, then explicit git init + push (onboarding it *is* Cases #2 audit and #3 apply):

```powershell
# Seed (spec §2.2): README.md, stale CLAUDE.md/AGENTS.md, .github/workflows/ci.yml,
#   .github/PULL_REQUEST_TEMPLATE.md, .github/CODEOWNERS, .githooks/pre-commit,
#   .agent/check-map.yml, .claude/ + .codex/ notes, docs/runbook.md,
#   docs/process/old-agent-flow.md, package.json (real scripts)
cd C:\GitHub\_scratch\lab-lived-in
git init -b main
git add .
git commit -m "Seed lived-in repo fixture"
gh repo create ArchonVII/archon-setup-lab-lived-in `
  --private `
  --source . `
  --push
```

## Step 2 — Create labels (all three repos, before filing issues)

`gh issue create` fails on unknown labels, so this precedes filing.

```powershell
$labels = @{ 'type:test'='0075ca'; 'status:shakedown'='e4e669'; 'area:agent-contract'='d93f0b';
  'area:workflow'='0e8a16'; 'area:hooks'='1d76db'; 'area:onboarding'='5319e7';
  'area:docs'='f9d0c4'; 'area:triage'='c2e0c6' }   # colors illustrative
foreach ($r in $LabRepos) {
  foreach ($k in $labels.Keys) {
    gh label create $k --repo "ArchonVII/$r" --color $labels[$k] --force
  }
}
```

## Step 3 — File the 15 issues + write the case→issue map

The issue files carry **full `ArchonVII/...` repo names** in their `<!-- repo: ... -->` metadata, so
`--repo $repo` is used directly (no prefixing). Dry-preview first; uncomment the two filing lines once the
preview looks right:

```powershell
$dir = 'C:\GitHub\archon-setup\docs\testing\shakedown\issues'
$IssueMap = @()
Get-ChildItem $dir -Filter '*.md' | Where-Object { $_.Name -ne '00-template.md' } | Sort-Object Name | ForEach-Object {
  $m = Get-Content $_.FullName -TotalCount 4
  $title  = (($m -match '^<!-- title:')[0])  -replace '^<!-- title:\s*','' -replace '\s*-->$',''
  $repo   = (($m -match '^<!-- repo:')[0])   -replace '^<!-- repo:\s*','' -replace '\s*-->$',''
  $labels = ((($m -match '^<!-- labels:')[0]) -replace '^<!-- labels:\s*','' -replace '\s*-->$','') -split ',\s*'
  $labelArgs = $labels | ForEach-Object { '--label'; $_ }
  Write-Host "-> $repo | $title [$($labels -join ', ')]"
  # $url = gh issue create --repo $repo --title $title @labelArgs --body-file $_.FullName
  # $IssueMap += [pscustomobject]@{ caseFile = $_.Name; repo = $repo; title = $title; url = $url }
}
# $IssueMap | ConvertTo-Json -Depth 5 | Set-Content C:\GitHub\archon-setup\docs\testing\shakedown\issue-map-2026-06-06.json
```

**Case IDs ≠ GitHub issue numbers.** GitHub numbers are per-repo and span three repos, so the harness Case
IDs (1–15) will not match the filed issue numbers. The matrix below uses **Case IDs**; the real filed
numbers/URLs live in `issue-map-<date>.json`.

## Step 4 — Run the matrix in spec §8 order (Case IDs)

Each case = a fresh agent session seeded with the paired `prompts/<which>.md` + the filed issue body. The
single CI job name is **`ci-success`** (consistent across node/python/minimal templates); the required
branch-protection check is **`repo-required-gate / decision`**.

| §        | Step                                                                                 | Repo            | Cases                  | Prompt                       | Rows        |
| -------- | ------------------------------------------------------------------------------------ | --------------- | ---------------------- | ---------------------------- | ----------- |
| 8.1–8.3  | onboard dry-run → write → real remote                                                | lab-fresh       | 1                      | general                      | 0, 1        |
| 8.4      | first trivial PR ⇒ `repo-required-gate / decision` appears                           | lab-fresh       | (1)                    | general                      | 1           |
| 8.5      | `node bin/archon-setup.mjs tighten-required-gate --target <path>`                    | lab-fresh       | (1)                    | —                            | 1           |
| 8.6      | PR-contract negatives + autoinject + routing                                         | lab-pr-contract | 4, 6, 7, 8, 9, 10, 14  | negative-control / general   | 4,6–10,14   |
| 8.7      | audit (`npm run onboard -- <p> --audit`) → apply/reconcile                           | lab-lived-in    | 2, 3                   | general / reconciliation     | 2, 3        |
| 8.8      | update drift (`update --check` / `update` / `update --upgrade` / `--dry-run`)        | lab-fresh       | 15                     | general                      | 15          |
| 8.9      | doc-sweep + anomaly (related/unrelated)                                              | lab-pr-contract | 13, 11, 12             | general / off-task-anomaly   | 11,12,13    |
| 8.10     | lifecycle scripts (`agent:start-task/status/prune` in the *generated* repo)          | lab-pr-contract | 5                      | general                      | 5           |
| 8.11     | publish-readiness dry run — `npm test` + `node scripts/prepublish-check.mjs` — **DO NOT publish** | archon-setup | —              | —                            | DoD         |

Deliberate PR set for 8.6 (spec §5), each kept tiny: happy-path smoke, bad branch name, `update stuff`
title, missing body, empty body, docs-only typo, code-without-test-evidence.

## Step 5 — Capture results (expanded evidence schema)

```powershell
Copy-Item C:\GitHub\archon-setup\docs\testing\shakedown\results-template.md `
          C:\GitHub\archon-setup\docs\testing\shakedown\results-2026-06-06.md
```

Per row, capture (not just "CI green"):

```text
Case ID:
Repo:
Local path:
Branch:
Commit SHA before:
Commit SHA after:
archon-setup version/baseline:
Manifest path:
Files changed:
Workflow run URL(s):
Check name(s):
Check conclusion(s):
PR URL:
Issue/case URL (from issue-map):
Observed blocker/warning text (verbatim):
Cleanup status:
Follow-up issue URL (if failed):
```

For audit/update rows (2, 3, 15) also capture:

```text
Before manifest hash:
After manifest hash:
update --check output:
update --dry-run output:
git diff --stat:
git status --short:
```

A row passes only when observed behavior matches the spec §4 expected signal **with** captured evidence.
Generic "CI green" is not evidence — name the exact check and link the run.

## Step 6 — Teardown + re-cut gate (grant delete_repo HERE, not earlier)

```powershell
gh auth refresh -h github.com -s delete_repo
foreach ($r in $LabRepos) {
  gh repo archive "ArchonVII/$r" --yes
  gh repo delete  "ArchonVII/$r" --yes
}
```

Then:

1. Separate small PR: add an `archon-setup-lab-*` glob to `scripts/cleanup-smoketest-repos.mjs` so the lab
   repos are covered by the existing smoketest-cleanup helper.
2. Save the completed results matrix to a tracking issue (or attach to #109).
3. Update `.claude/HANDOFF.md` and the `project_deploy_readiness_sweep` memory with the verdict.
4. **All DoD rows Pass (with Case #13 fully exercised) →** publish unblocked: re-cut 0.1.0 (version bump +
   freshly-dated changelog fold + README status refresh) → dispatch `publish.yml`.
   **Any fail, or #13 only scoped →** publish stays deferred; open fix issues.

## Verify-points (resolve inline; don't block the whole run)

- **node-ci install command** — confirm the upstream reusable `node-ci.yml@v1` (runs `lint`/`typecheck`/`test`,
  default node 22) uses `npm ci` (needs the lockfile) vs `npm install`/no-op for depless repos; the seeded
  lockfile (1b) covers either way.
- **Headless remote-create (`archon-setup#46`)** — apply the row-0 PASS/PARTIAL/FAIL rule above.
- **gitleaks** — install vs scoped #13 (recorded in the start gate).
- **Feature dependencies** — the 8.1 dry-run surfaces registry dependency warnings; resolve before 8.2/8.3.
- **`update --dry-run`** — confirmed supported in `bin/archon-setup.mjs` (Case #15's "writes nothing" AC is real).
