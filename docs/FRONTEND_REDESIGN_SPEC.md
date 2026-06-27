# Front-End Redesign — Design Outline & Behavioral Spec

> **Status:** Design outline. No implementation. This document is the agreed
> target the mockups (via the `html-output` skill) and then the real build
> follow. It is a **behavioral spec**, not screen intent: it defines the data
> the UI reads, the rules it obeys, and the states it must render — before any
> pixels are drawn.
>
> **Build target (framing only):** React + Vite + Tailwind/shadcn, served by the
> existing local `node:http` server. The front end **evolves** the current
> 6-screen wizard; it does **not** replace the planner/executor/registry
> backend.
>
> **Audiences (co-equal):** a first-time user onboarding one repo, and the
> ecosystem owner managing many repos.

---

## 0. Reading guide — the one idea

The center of this product is **not** the tabs. It is a single canonical
object: the **plan/audit object** (`RepoSetupPlan` + its `Operation[]`).

- The tabs are navigation.
- The plan object is the **trust layer**.
- For a tool that edits other people's repositories, **trust is the product.**

Every screen in this spec is a *projection* of the canonical contracts in
[§4](#4-canonical-data-contracts-the-center). The UI never computes truth
(status, diffs, risk) on its own — the server computes it once, the UI renders
it everywhere. If you only read one section, read §4 and §8.

---

## 1. Product Principles

1. **Trust is the product.** The app's job is to make a repo mutation feel safe
   and legible. A vague Review screen makes the whole app feel dangerous; an
   excellent one earns the right to edit a repo.
2. **One plan object is the single trust layer.** Dashboard detail, Onboard
   review, Templates selection, Execute progress, and the Run Report all read
   the *same* object. No screen-specific truth.
3. **The registry is the single source of truth.** The UI renders
   `src/registry/features.json`; it never re-encodes feature data. Per-operation
   explanations are **derived** from the owning feature's
   `beginnerDescription` / `advancedDescription` (see §4 rule R3).
4. **Read-only by default; writing is explicit, idempotent, and legible.**
   Audits never write. Applying the same plan twice produces no duplicate state
   (locked foundation decision #4). Re-running shows already-current items as
   no-ops, not as new changes.
5. **No ambiguity.** Every proposed change is classified
   (create/overwrite/merge/skip/blocked/needs-review), explained in **both**
   plain English and developer terms, and — for anything touching existing
   content — shown as a diff *before* it happens.
6. **Fast to glance, deep on demand.** The Dashboard paints from cheap signals;
   the expensive file-by-file truth runs when the user asks.
7. **Never overpromise.** Status honesty is a hard rule: a bare "Current" is
   never shown from a cheap manifest check (see §5).
8. **Maturity honesty.** Planned ≠ available. Not-yet-wired surfaces are visible
   but clearly marked and kept out of the default install path (see §6).
9. **The local security model is inherited whole.** The redesign may not loosen
   any invariant in [§11](#11-security-invariants).

---

## 2. User Types & Primary Jobs

| User | Context | Primary job (JTBD) | What "good" feels like |
|------|---------|--------------------|------------------------|
| **Newcomer** | Onboarding one repo, possibly no terminal | "Get my repo onto the ArchonVII baseline safely without understanding the internals." | Walked through one tab; every checkbox explained in plain English; sees exactly what will change before it changes. |
| **Ecosystem owner** (primary you) | Managing many repos | "Tell me which repos need attention and the safest next action for each." | Dashboard answers at a glance; deep audit one click away; never has to guess whether a repo is current. |
| **Agent / headless** (parity, not a UI) | `npm run onboard` / `--audit` | "Build and apply the same plan without a browser." | The CLI and the UI consume the **same** plan object, so they can never drift. |

The third row is not a screen — it is a constraint. The canonical contracts in
§4 are exactly what the headless `onboard` path already produces, so the UI is a
view over a contract the backend already owns.

---

## 3. Top-Level Navigation (App Shell)

A **persistent tabbed shell**, not a locked linear wizard.

```text
┌─ archon-setup ───────────────────────────  [env: ✓ git ✓ gh · session ●] ─┐
│  Dashboard   Onboard   Templates   Doctor/Settings                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  (active tab body)                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Shell responsibilities (always present):**

- **Environment / session chip** (top-right): collapses the old Doctor *gate*
  into a persistent status — `git`, `gh`, auth, `actionlint`, network, write
  perms, and the live session-token state. Green when clear; click opens the
  Doctor/Settings tab. Doctor is no longer a wall you pass through; it's a chip
  you glance at.
- **Active-repo context:** the repo currently selected for Onboard (so deep
  links from Dashboard → Onboard carry the target).
- **Session token plumbing:** every RPC carries the bearer token (unchanged from
  today). Token loss surfaces as a shell-level banner (see §10).

**v1 tabs:** `Dashboard · Onboard · Templates · Doctor/Settings`.

**Later tabs (designed for, not built in v1):** `History`, `Global Updates`
(migrate today's confirmation-phrase distribution flow here intact),
`Bulk Audit`. These are reserved slots, not v1 work.

**Run Report** is reachable contextually (end of an Onboard run, and from a
repo's Dashboard detail) — not a top-level tab in v1.

---

## 4. Canonical Data Contracts (the center)

These shapes are computed **server-side** and are the only source of truth the
UI renders. Notation is TypeScript-ish for clarity; it is a contract, not code.

### 4.1 RepoSummary — the Dashboard fast row

Cheap to compute (no deep file reads beyond the manifest). One per repo under a
scan root.

```ts
RepoSummary {
  repoPath: string
  name: string
  identity: {
    branch: string
    defaultBranch: string
    dirty: boolean
    worktreeCount: number
    origin?: string            // owner/repo when detectable
    lastCommit?: { sha: string; subject: string; ts: string }
  }
  fastStatus: FastStatus       // see §5 — never the bare word "Current"
  baselineVersion?: string     // baseline the manifest claims
  currentBaselineVersion: string
  lastAudit?: {
    ts: string
    verifiedStatus: VerifiedStatus
    counts: { missing: number; drifted: number; blocked: number; needsReview: number }
    stale: boolean             // see §5 staleness rule
  }
  manifestPresent: boolean
}
```

> Source note: `identity` fields already exist in
> `src/server/ecosystem/collectRepos.mjs` (branch, dirty, worktrees,
> lastCommit). `fastStatus` / `baselineVersion` / `lastAudit` are the new joins
> this spec asks the backend to add.

### 4.2 AuditResult — the deep, on-demand truth

```ts
AuditResult {
  repoPath: string
  ts: string
  verifiedStatus: VerifiedStatus
  summary: { present: number; missing: number; drifted: number; blocked: number; needsReview: number }
  operations: Operation[]      // the audit expressed as operations (read-only)
}
```

> Source note: today's `src/server/onboard/auditPlan.mjs` already returns
> `{ items: [{status, path, feature, detail}], summary }` with
> `present | missing | drifted`. This spec **promotes** each `item` into the
> richer `Operation` shape below and adds `blocked` / `needsReview`.

### 4.3 RepoSetupPlan — the thing you apply

```ts
RepoSetupPlan {
  repoPath: string
  repoIdentity: RepoSummary["identity"]
  baselineVersion: string
  mode: "new-repo" | "existing-repo"
  selectedFeatureIds: string[]
  selectedTemplateIds: string[]
  operations: Operation[]      // the full, classified change set
  blockers: Blocker[]          // hard stops; apply disabled until empty/resolved
  warnings: Warning[]          // proceed-with-awareness
  auditSummary: AuditResult["summary"]
  remoteMutations: RemoteMutation[]   // labels, branch protection, repo create
  postChecks: PostCheck[]      // e.g. required-gate deferred until first run
}
```

> Source note: today's plan object
> (`{ context, selectedFeatureIds, files[], skippedFiles[], commands[],
> remoteMutations[], postChecks[], ordered[], warnings[] }` from
> `buildPlan.mjs`) becomes this. `files[]` + `skippedFiles[]` + the audit collapse
> into one `operations[]`; `warnings` split into `blockers` (hard) and
> `warnings` (soft).

### 4.4 Operation — the atom of trust

The single most important shape in the product.

```ts
Operation {
  id: string
  featureId: string            // owning registry feature (or template id)
  label: string                // e.g. "AGENTS.md"
  filePath: string             // e.g. "./AGENTS.md"  (relative to repoPath)
  action: "create" | "overwrite" | "merge" | "skip" | "blocked" | "needs_review"
  risk: "low" | "medium" | "high"
  currentState: "missing" | "present" | "drifted" | "unknown"
  maturity: "available" | "experimental" | "coming_soon"
  explanationPlain: string     // derived from feature.beginnerDescription (R3)
  explanationDeveloper: string // derived from feature.advancedDescription (R3)
  source?: string              // e.g. "pr-default@x.y.z" snapshot/template ref
  beforeContent?: string       // present file body, for overwrite/merge/drift
  afterContent?: string        // managed body that would be written
  diff?: UnifiedDiff           // computed server-side; UI never diffs
  blockerReason?: string       // when action === "blocked"
  remedies?: Remedy[]          // concrete fixes for a blocked op (see §9)
  requiresConfirmation?: boolean   // high-risk ops gate the Apply button
}
```

### 4.5 Blocker, Warning, Remedy, RunReport

```ts
Blocker {
  id: string
  operationId?: string
  kind: BlockerKind            // see §9 taxonomy
  title: string
  why: string                  // plain-English reason it is blocked
  remedies: Remedy[]
}

Warning {
  id: string
  operationId?: string
  message: string
  severity: "info" | "warn"
}

Remedy {
  label: string                // e.g. "Approve overwrite", "Skip this file", "Open diff"
  kind: "open_diff" | "approve_overwrite" | "skip" | "fix_outside" | "deselect" | "authenticate"
  destructive?: boolean
}

RunReport {
  repoPath: string
  ts: string
  baselineVersion: string
  results: { applied: Operation[]; skipped: Operation[]; blocked: Operation[]; failed: Operation[] }
  remoteActions: RemoteMutation[]
  postChecks: PostCheck[]
  manifestPath: string         // .github/archon-setup.json + .archon/SETUP.manifest.json
  repoState: { branch: string; dirty: boolean; commit?: string }
  copyable: string             // a plain-text run report the user can paste as proof
}
```

### 4.6 Contract rules (binding behavior)

- **R1 — One object, many views.** Dashboard detail, Onboard review, Templates
  selection, Execute progress, and Run Report are all projections of
  `RepoSetupPlan` / `AuditResult`. No screen invents fields.
- **R2 — Server computes truth.** `action`, `risk`, `currentState`, `diff`, and
  status are computed once on the server. The UI renders; it does not classify.
- **R3 — Explanations derive from the registry.** `explanationPlain` /
  `explanationDeveloper` come from the owning feature's `beginnerDescription` /
  `advancedDescription` (optionally specialized per file). They are **never**
  re-authored in the front end. This preserves the single-source-of-truth
  invariant.
- **R4 — An Operation is a join.** It is `planner(afterContent)` joined with
  `audit(currentState, beforeContent)` → `action` + `diff`. The audit and the
  plan are computed by the existing backend; the Operation is their union.
- **R5 — Templates are Operations.** A selected template produces ordinary
  `Operation`s in the same plan (see §7). There is exactly one install pipeline.

---

## 5. Status Taxonomy (two layers — honesty rule)

The biggest UX risk is a **"Current" badge that overpromises**. A repo with a
matching `archon-setup.json` may still have manually edited or deleted files.
So status has two layers, and the cheap layer may never claim verified truth.

### 5.1 Fast status (cheap — manifest + version check only)

```ts
type FastStatus =
  | "not_onboarded"     // no manifest
  | "manifest_current"  // manifest's baseline == current baseline
  | "manifest_outdated" // manifest exists, older baseline
  | "unknown_needs_audit"
```

### 5.2 Verified status (after a deep audit)

```ts
type VerifiedStatus =
  | "verified_current"
  | "drift_detected"
  | "missing_files"
  | "blocked"
  | "needs_review"
```

### 5.3 Rules

- **No bare "Current" from the fast path.** `manifest_current` renders as
  **"Manifest current"** with a subtle **"Run audit to verify"** action — never
  the unqualified word "Current."
- **Only an audit yields "Verified current."** The confident green badge is
  earned by a deep audit, not a manifest read.
- **Staleness.** Every audit carries a timestamp. The UI marks an audit *stale*
  after a configurable window (the window default is **deferred to Settings —
  not hardcoded here**, because no sourced value exists for it yet). A stale
  audit shows its last result greyed with "audited {relative time} ago · re-run."
- **Badge color mapping (proposed; confirm in mockups):** `not_onboarded` →
  neutral; `manifest_current` → blue (informational, not green);
  `manifest_outdated` → amber; `verified_current` → green; `drift_detected` /
  `missing_files` → amber; `blocked` / `needs_review` → red.

---

## 6. Feature / Category Taxonomy

User-facing grouping mirrors the registry groups but is organized for humans.
Each leaf is an installable that maps to one registry feature id.

```text
Repo Instructions          → group: foundations (agent-authority subset)
  AGENTS.md · CLAUDE.md · GEMINI.md · coordination contract
Foundations (locked)       → group: foundations
  README · LICENSE · .gitignore · .gitattributes · CHANGELOG · PR template · git-init
Automation Hooks           → group: foundations (.githooks)
  commit-msg · pre-commit · checkout-role guard · owner-maintenance
Agent Workflow             → group: agent-workflow
  check-map · coordination board · anomaly-triage · agent-lifecycle · doc-sweep
CI / GitHub Workflows      → group: workflows.ci + workflows.pr-contract
  repo-required-gate · node-ci · python-ci · minimal-ci (mutually exclusive)
  pr-policy · semantic-pr-title · branch-naming · pr-body-autoinject
Skills                     → (planned — no backend yet)
Security & hygiene         → group: workflows.security / workflows.hygiene (disabled)
Copilot / secrets          → group: copilot (disabled)
Templates                  → see §7
GitHub remote settings     → group: remote (labels, branch protection, repo create)
```

### 6.1 Required display fields per installable

Every leaf, wherever it appears (checkbox tree, Templates, Review), shows:

- **Plain English** (one sentence; from `beginnerDescription`).
- **Developer detail** (from `advancedDescription`: snapshot source, file refs).
- **Files affected** (`creates[]` / target paths).
- **Risk** (low/medium/high).
- **Action preview** (will it create / merge / overwrite / skip *in this repo*).
- **Maturity** (see §6.2).
- **Dependencies / conflicts** surfaced inline (e.g. "needs Fragment mode",
  "only one CI gate").

### 6.2 Maturity model (no clutter rule)

```ts
type Maturity = "available" | "experimental" | "coming_soon"
```

- Maps to the registry: a group/feature with `disabled: true` (today:
  `workflows.security`, `workflows.hygiene`, `copilot`) → `coming_soon`; Skills →
  `coming_soon` until its backend exists.
- **Default view shows `available` only.** A **"Show planned features"** toggle
  reveals `experimental` / `coming_soon` in a clearly-labelled section.
- **Coming-soon items never appear in the default install checklist** and can
  never be selected into a plan. They have a home in the UI without faking
  function.

---

## 7. Template Taxonomy

A template is just another installable — **previewable** in the Templates tab,
**selectable** into the same plan. This avoids two mental models ("templates
install here vs. features install there").

```ts
Template {
  id: string
  name: string
  category: "github" | "agent" | "operations" | "prompts" | "reports"
  purposePlain: string         // plain-English why-you'd-want-it
  detailDeveloper: string      // snapshot source + destination
  destinationPath: string
  maturity: Maturity
  variables?: string[]         // interpolation slots, if any
  partials?: string[]          // _partials/* this template composes
  body: string                 // for preview (read-only in v1)
}
```

**Categories** (sourced from `src/snapshots/repo-template/templates/`):

- **github** — PR template, Issue template.
- **agent** — final-response, handoff, progress-update, clarification-request,
  blocked-or-partial, presentation-message.
- **operations** — task intake.
- **prompts** — builder, review, run-request, run-report, spec.
- **reports** — decision-memo, findings.

**Behavior:** the Templates tab is **Preview library + selector + input to the
plan**. Previewing is read-only in v1 (in-app editing is explicitly *later*,
§12). Ticking a template adds it to `selectedTemplateIds`; on the next plan
build it becomes ordinary `Operation`s (R5). The write still happens through
Plan → Review → Execute.

---

## 8. Review Screen Rules (the screen to obsess over)

This is the trust center. Spec it precisely; mock it first.

### 8.1 Top summary (always visible)

```text
This plan will:
  Create        5 files
  Merge         2 files
  Overwrite     0 files
  Skip          3 files
  Blocked       1 item
  Needs review  1 item
```

### 8.2 Grouped sections, ordered by ascending safety risk

```text
1. Safe creates          (action: create)
2. Managed merges        (action: merge — managed block into existing file)
3. Potential overwrites  (action: overwrite — replaces existing content)
4. Skipped               (action: skip — already current, or deselected)
5. Blocked               (action: blocked — hard stop, with reason)
6. Needs human review    (action: needs_review — ambiguous, requires a call)
```

### 8.3 Row anatomy

```text
AGENTS.md
  Action: Create        Risk: Low        Path: ./AGENTS.md
  Why:  Adds the cross-tool agent contract so every agent follows the same rules.
  Dev:  Copied from snapshot ArchonVII/repo-template/AGENTS.md (+ repo-update-log).
  [ ▸ View diff ]   (collapsed by default for create; required for overwrite/merge/drift)
```

- **Diffs** are collapsible. For `overwrite` / `merge` / drifted `currentState`,
  the diff is the proof and must be one click away. The UI renders
  `operation.diff`; it never computes it.
- **Confirmation gating.** `overwrite` and `needs_review` ops carry
  `requiresConfirmation: true`; each must be explicitly acknowledged before the
  Apply button enables.

### 8.4 Blocker card anatomy

```text
⛔ Blocked: CLAUDE.md exists but has no managed block.
  Why blocked: The file already has local content and no ArchonVII managed
               marker, so we cannot merge without risking your data.
  How to fix:  [ Open diff ]  [ Approve overwrite ]  [ Skip this file ]
```

Each button maps to a `Remedy` (§9). Nothing about a blocker is silent.

### 8.5 Apply button copy (exact)

- No blockers: **"Apply 7 changes to this repo"** (the number is real).
- Unresolved blockers: **"Resolve blockers before applying"** (button disabled).
- The button never says "Continue" or "Next." It states exactly what it does.
- Existing-repo target confirmation (today's explicit confirm before
  write-capable steps) is **preserved** as a precondition of enabling Apply.

### 8.6 Idempotency surfacing

Re-running a plan that's already applied shows its items under **Skipped** as
"already current," not as fresh changes — the visible proof of locked decision
#4.

---

## 9. Blocking & Warning Rules

### 9.1 Action classification (decision table)

| File state | Managed block? | Capability/policy | → `action` |
|------------|----------------|-------------------|-----------|
| missing | n/a | ok | `create` |
| present, exact match | n/a | ok | `skip` (already current) |
| present, has managed marker | yes | ok | `merge` |
| present, no managed marker, content is ours-stale | n/a | ok | `overwrite` (medium risk) |
| present, no managed marker, **local content** | no | ok | `blocked` (unmanaged-existing) |
| drifted, ambiguous origin | n/a | ok | `needs_review` |
| any | n/a | capability missing (e.g. gh auth) | `blocked` (capability) |

### 9.2 Blocker kinds → reason → remedies

```ts
type BlockerKind =
  | "unmanaged_existing_file"   // file has local content, no managed marker
  | "capability_missing"        // gh not authed / repo-create not allowed
  | "dirty_worktree"            // uncommitted changes in target
  | "protected_main"            // target is a protected main/master checkout
  | "conflicting_selection"     // e.g. two CI gates chosen
  | "remote_unauthenticated"    // remote action without gh auth
  | "drift_needs_review"        // can't safely classify drift
```

| Kind | Default remedies |
|------|------------------|
| `unmanaged_existing_file` | Open diff · Approve overwrite · Skip |
| `capability_missing` | Authenticate (gh) · Skip remote steps |
| `dirty_worktree` | Open folder · (re-scan after commit) |
| `protected_main` | Use a branch/worktree lane · Skip |
| `conflicting_selection` | Deselect one option |
| `remote_unauthenticated` | Authenticate · Drop remote features |
| `drift_needs_review` | Open diff · Approve overwrite · Skip |

### 9.3 Warning vs Blocker

- **Warning** = proceed with awareness (does not gate Apply). e.g. "branch
  protection's named required check is deferred until the gate runs once."
- **Blocker** = hard stop; Apply stays disabled until every blocker is resolved
  (via a remedy) or its operation is removed.
- **A blocker is never auto-resolved silently.** Overwriting unmanaged content
  always requires an explicit human remedy click.

---

## 10. Empty / Loading / Error / Degraded States

Honesty rule: **unknown is shown as unknown, never as fine.**

| Surface | Empty | Loading | Error | Degraded |
|---------|-------|---------|-------|----------|
| **Dashboard** | "No repos found under your scan roots" + edit-roots CTA | skeleton rows while scanning root | "Couldn't scan {root}" + retry | a repo whose git calls timed out → row shows `unknown_needs_audit`, not green |
| **Repo audit** | — | inline spinner on the row + "auditing…" | "Audit failed: {reason}" + retry | partial audit (some files unreadable) → those ops `currentState: "unknown"` |
| **Onboard select** | "Pick a folder to begin" | folder-pick native dialog pending | "Not a git repo" / "No write permission" | — |
| **Plan build** | "Select at least one item" | "Building plan…" | "Plan failed: {reason}" | — |
| **Execute** | — | **streaming** task log (today's SSE preserved) | task failure halts run; failed op marked, rest paused | — |
| **Templates** | "No templates available" | loading library | "Couldn't load templates" | — |
| **Shell/session** | — | — | **session token expired/invalid** → full-width banner "Session ended — relaunch archon-setup" | — |

Every error state names the cause and offers a recovery action. No spinners
without timeouts; no green without proof.

---

## 11. Security Invariants (inherited — must not regress)

Carried forward verbatim from `AGENTS.md` "Security non-negotiables" and
`docs/SECURITY_MODEL.md`:

- Server binds to **`127.0.0.1`** on an ephemeral port — never `0.0.0.0`.
- A **per-launch session token** is required on **every** state-changing RPC.
- **Origin/Host pinning** stays; POST-only for state-changing methods.
- **Secret values never touch disk or logs** — piped straight to `gh secret set`
  stdin (relevant when Copilot/secrets land in v0.4).
- **No path traversal** — file writes validate against the chosen project root.
- **Read-only audit never writes.**

New constraints introduced by the Vite build (must hold):

- **N1.** The built front-end assets are served **same-origin and token-gated**
  by the local `node:http` server — the bundle is *prebuilt* and served by the
  existing server, not by a separate dev server, in normal runs. No asset path
  bypasses the token gate.
- **N2.** No external network calls from the app at runtime (no telemetry, no
  CDN-only critical assets that would dodge the gate). Tailwind/shadcn ship in
  the bundle.
- **N3.** The Vite dev server (`vite`, hot reload) is a **developer-only** mode
  and must not be the channel end users are pointed at; production launch serves
  the static build through the gated server.
- **N4.** A strict same-origin Content-Security-Policy is the default for the
  served document.

---

## 12. V1 / Later Split

### V1 (this redesign)

- **Shell** with env/session chip + 4 tabs.
- **Dashboard:** fast `RepoSummary` badges, filters (Not onboarded · Drifted ·
  Outdated · Blocked · Dirty · Needs audit · Current), per-repo **on-demand deep
  audit**, repo **detail drawer**.
- **Onboard:** single repo — folder pick → preflight → hierarchical checkbox
  tree (consequence-before-review) → **Review trust center** (§8) → streaming
  Apply → **Run Report**.
- **Templates:** preview library + select-into-plan.
- **Doctor/Settings:** env checks, **configurable scan roots**, gh/auth status,
  session/security status, defaults.
- **Maturity:** `available` only by default; "show planned" toggle.

### Later (designed-for, not built)

- **Bulk audit** (read-only across many repos).
- **History** tab (durable run history beyond a single Run Report).
- **Global Updates** tab — migrate today's confirmation-phrase distribution flow
  intact.
- **Bulk apply / update** — only after the single-repo Review model is proven.
- **Skills install** backend + UI activation.
- **Security/hygiene** workflows, **Copilot/secrets** (v0.4 security path).
- **In-app template editing.**

### Explicitly out of v1

- Bulk apply, in-app template editing, anything multi-tenant or networked.

---

## 13. Mockup Checklist (handoff to `html-output`)

The next session draws these, in priority order, each showing the named
contract fields. **Review screen states are highest priority** (the trust
center).

1. **Review — full grouped summary** with one row of *each* action type
   (create, merge, overwrite, skip, blocked, needs_review), the top summary
   counts, a **collapsed** diff and an **expanded** diff, and both Apply states
   (enabled "Apply N changes" vs. disabled "Resolve blockers before applying").
2. **Review — blocker card** with why + three remedy buttons.
3. **Dashboard — populated** with a mix of statuses (note-honest badges:
   "Manifest current · Run audit to verify" vs. "Verified current").
4. **Dashboard — repo detail drawer** post-audit (missing/drifted/blocked
   counts, last-audited, baseline version, primary action = Audit).
5. **Dashboard — empty** (no scan root) and **loading** (scanning skeleton).
6. **Onboard — folder select** + preflight chip.
7. **Onboard — checkbox tree** (collapsed groups; one item expanded showing
   plain + dev + files + risk + maturity + action preview) and the **"show
   planned"** toggle revealing a Coming-soon item.
8. **Run Report** — success summary with copyable proof block.
9. **Templates** — library grid + preview pane (plain / dev / destination /
   maturity) + a selected (ticked-into-plan) state.
10. **Doctor/Settings** — env checks + scan-roots editor.
11. **Global states** — session-expired banner; gh-not-authenticated error.

---

## Decision Log

| # | Decision | Alternatives considered | Why |
|---|----------|-------------------------|-----|
| D1 | Written design outline is this session's only deliverable | Jump to mockups; jump to build | User intent: outline → mockups → build, in that order. |
| D2 | Evolve the existing app on the same RPC backend | Greenfield front end | Lowest risk, fastest value; backend (registry/planner/executor) is sound. |
| D3 | React + Vite + Tailwind/shadcn build target | Zero-build vanilla; framework-agnostic | "Real front end" + rich multi-tab UI, diffs, previews; README already flags Vite as next. |
| D4 | Co-equal audiences (newcomer + ecosystem owner) | Owner-first; non-dev-first | User selection; drives dual-track explanations + tabbed shell. |
| D5 | Persistent tabbed shell; Doctor demoted to a status chip | Locked linear wizard | Power-user dashboard + newcomer flow can't both live in a linear wizard. |
| D6 | Fast badge + on-demand deep audit | Full audit every load; manifest-only | Dashboard must stay fast at scale; truth on demand. |
| D7 | **Plan/Audit object is the product center** | Tabs-first spec | Reviewer condition: trust is the product; the object is the trust layer. |
| D8 | Two-layer status; no bare "Current" from fast path | Single status badge | Prevents false confidence from a stale/edited manifest. |
| D9 | Templates feed the same Plan→Review→Execute pipeline | Separate template install flow | One mental model; one install pipeline (R5). |
| D10 | Maturity = available/experimental/coming_soon; planned hidden by default | Show disabled options inline | Avoids an unfinished feel; keeps the install path clean. |
| D11 | Run Report in v1; History as a *later* tab | History tab in v1 | Users need post-run proof immediately; durable history can follow. |
| D12 | Single-repo onboarding in v1; bulk **audit** ok, bulk **apply** later | Bulk apply in v1 | Reviewer guidance: prove the Review model before bulk mutation. |
| D13 | Operation explanations derive from registry descriptions | Author per-operation copy in UI | Preserves single-source-of-truth invariant. |
| D14 | Vite bundle served same-origin token-gated by the local server | Public CDN assets / standalone dev server in prod | Preserves the security model end-to-end. |

## Open Questions (low-stakes — none block mockups)

- **OQ1.** Staleness window for audits (when does a green audit go grey?) —
  deferred to Settings; no sourced default chosen, so left unset deliberately.
- **OQ2.** Exact badge palette — proposed in §5.3, to be finalized visually in
  mockups.
- **OQ3.** Does the Dashboard scan root support **multiple** roots in v1, or one
  configurable root? (Spec assumes "roots" plural-capable; v1 may ship single.)
- **OQ4.** Repo detail: drawer vs. dedicated route — proposed as a drawer;
  revisit if detail content outgrows it.

## Appendix — mapping to current code

| Spec concept | Lives today in | Evolution needed |
|--------------|----------------|------------------|
| `RepoSummary` | `src/server/ecosystem/collectRepos.mjs` | add fastStatus/baselineVersion/lastAudit joins |
| `AuditResult` / `Operation.currentState` | `src/server/onboard/auditPlan.mjs` | promote `items` → `Operation`; add blocked/needs_review |
| `RepoSetupPlan` | `src/server/planner/buildPlan.mjs` | merge files/skippedFiles/audit → `operations`; split warnings → blockers/warnings |
| explanations | `src/registry/features.json` (`beginner/advancedDescription`) | surface per-operation (R3); no new copy store |
| maturity | registry `disabled: true` groups | map disabled → coming_soon |
| Templates | `src/snapshots/repo-template/templates/**` + `agent-workflow.template-library` | add RPC to list/preview installed templates |
| Execute streaming | `plan.execute` SSE in `src/server/index.mjs` | preserve as-is |
| Security model | `src/server/security/**` | preserve + add Vite N1–N4 |
| Tabs/shell/screens | `src/ui/app.mjs` (980-line vanilla) | rebuild as React+Vite components |
