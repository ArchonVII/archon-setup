# Granular marker-based distributor — design spec

- **Date:** 2026-06-09
- **Author:** Claude (Opus 4.8), via owner brainstorm (this session).
- **Status:** DRAFT — for owner review. This doc is the review gate before implementation.
- **Tracking issue:** [archon-setup #145](https://github.com/ArchonVII/archon-setup/issues/145).
- **Branch / worktree:** `agent/claude/145-granular-distributor` at `C:\GitHub\archon-setup-145-granular-distributor`.
- **Supersedes (in part):** DECISION **C1** of `docs/superpowers/specs/2026-06-01-distribution-lifecycle-rollout-design.md` ("`--upgrade` discards non-budget customizations — acceptable").

---

## 1. Problem

`archon-setup update --upgrade` replaces drifted managed workflow callers with the snapshot body and **discards customizations beyond budget defaults by design** (`src/updater/updateManagedFiles.mjs`, spec DECISION C1). A 2026-06-09 audit of the active consumer repos found the detected drift is **intentional per-repo customization, not staleness**:

| Repo | Caller | Drift is actually… |
| --- | --- | --- |
| `archon` | `repo-required-gate.yml` | active `stack: node` + typecheck, `run-dependency-review: false`, dependabot `run-pr-contract` expr, explicit least-priv `permissions:` block the template lacks |
| `hudson-bend` | `repo-required-gate.yml` | active `stack: node` + zero-dep rationale, `run-dependency-review: false` |
| `pigafetta` | `dependency-review.yml` | `DEPENDENCY_REVIEW_ENABLED` enablement gate (private repo, no GHAS) |
| `archon` | `branch-naming`, `semantic-pr-title`, `pr-policy`, `anomaly-triage` | cosmetic header diffs or intentional config (e.g. dependabot skip) |

A blind `--upgrade` sweep would revert `archon`/`hudson-bend` to `stack: minimal` (disabling node CI in the required gate) and strip dependency-review/dependabot settings. **The updater assumes too much ownership.** This spec inverts that assumption.

## 2. Understanding summary

- **What:** a marker-based, **repo-owned-by-default** distributor that updates only ArchonVII-managed regions in consumer files, preserves everything else, and surfaces `conflict`/`adoption_needed` instead of overwriting.
- **Why:** eliminate the clobber failure mode; let central language be added/updated while repo-specific language stays intact; surface true conflicts for human decision.
- **Who:** the ecosystem owner running rollouts; consumers are the active registry repos (`src/server/ecosystem/repoRegistry.json`).
- **Integration:** a new `distribute` capability that reuses the existing `globalUpdates.mjs` discipline (confirmation-gated, dry-run, skip dirty/protected, per-repo run-log); `globalUpdates.mjs` is refactored to delegate into the shared engine.
- **Non-goals:** semantic/AST merging; per-file-group ownership policy (v1); checksums; forcing markers into commentless JSON; touching any unmarked content; auto-push/PR.

## 3. Decision log

| # | Decision | Alternatives rejected | Why |
| --- | --- | --- | --- |
| DL1 | Merge model = managed-region **markers** | 3-way merge (needs the per-repo merge-base lock spec DECISION C2 deferred; in-file conflict markers break YAML/shell); structured per-type merge (a parser per type; YAML round-trip drops comments) | Generalizes the existing `managedMarkdownBlock` primitive; deterministic; no base-tracking |
| DL2 | Scope = all four groups (callers, AGENTS, hooks, wider baseline) | YAGNI-minimal subset | Owner chose breadth |
| DL3 | **Repo-owned by default**; unmarked never touched; fully-managed file = one large region; per-group policy deferred | managed-by-default (recreates the clobber); per-group policy (too much surface too early) | Directly matches the failure being fixed |
| DL4 | Status model: `clean_apply` (+`changed`) / `adoption_needed` / `conflict` / `skip`; never silently own; never guess | auto-resolve | Surfaces decisions |
| DL5 | Conflict rule: stop + human-readable diff on duplicate YAML key, repo-owned-intent override, unknown/deprecated marker ID, or adjacent collision | guess/merge | Safety |
| DL6 | "Boring" engine: replace-by-stable-block-ID, exact region; parsers detect danger only | semantic merge engine | *Markers define ownership; parsers detect danger; humans resolve ambiguity* |
| DL7 | Marker `BEGIN/END ARCHONVII MANAGED: <stable.dotted.id>` in native comment syntax; stable IDs; **no checksums** in v1 (advisory at most) | line/heading/path-derived anchors; mandatory checksums | Stable IDs are the ownership boundary; checksums get noisy during legitimate adoption edits |
| DL8 | Internal phasing engine → md/AGENTS → hooks → callers → baseline | big-bang | Risk order |
| DL9 | Caller managed scope = `uses: …@v1` pin + specific least-priv permission **keys** inside an existing `permissions:` mapping (region `workflow.*.permissions.base`); never whole-block; `with:` fully repo-owned | own whole `permissions:` block; own `with:` | Repo permission keys must coexist; ties to F15; Go adoption stays a human PR |
| DL10 | Entry point = new `distribute` subcommand over a shared engine; `globalUpdates.mjs` delegates (kept as catalog adapter) | extend `globalUpdates.mjs` in place | Capability is broader than "global updates" |
| DL11 | Snapshot-driven markers (authored in provider templates) + a marker-ID **manifest/lint** | hand-authored catalog for everything | Scales to 4 groups; lint prevents silent ID dup/rename/drop |
| DL12 | **Dry-run writes nothing** to consumer repos (no preview files); `--write-preview` emits `.archon/distribute-preview/`; `--apply` writes only `clean_apply` | preview-by-default | Dry-run must not dirty the worktrees it also skips |
| DL13 | Commentless JSON stays out of the engine; existing whole-file handling persists only for already-classified centrally-owned + safety-gated files, else `skip`/`adoption_needed` | "keep whole-file managed handling" unqualified | Avoids smuggling managed-by-default back via JSON |
| DL14 | NFRs (see §10) | — | Owner-added guardrails |

## 4. Architecture

Three layers, bottom-up. New code under `src/distributor/`.

```
bin/archon-setup.mjs  distribute …          ← CLI
        │
        ▼
src/distributor/distribute.mjs              (3) repo iteration, profile gating,
        │                                       dry-run/apply/preview, run-log,
        │                                       skip dirty/protected, confirmation
        ├── src/distributor/adapters/*.mjs   (2) per file-type: comment style,
        │                                       danger detection, metadata preserve
        └── src/distributor/regionEngine.mjs (1) pure string ops: parse/replace/
                                                 reconcile managed regions
src/server/globalUpdates.mjs  ──delegates──▶ (3) via a catalog source-adapter
```

1. **Region engine** (`regionEngine.mjs`) — pure, fs-free, repo-free, operates on strings. The only thing that understands markers.
2. **Adapters** (`adapters/{markdown,yaml,shell}.mjs`) — pick comment style, run danger detectors, preserve file metadata.
3. **Distributor** (`distribute.mjs`) — orchestration; reuses `collectRepos`, the registry, `redact.mjs`, `writeAtomic.mjs`, `safeJoin`.

> Does the layering look right? (Engine pure / adapters thin / distributor owns all fs + repo policy.)

## 5. Region engine API (layer 1)

Marker line shapes (chosen by comment style, not file extension):

```
markdown:  <!-- BEGIN ARCHONVII MANAGED: <id> -->  …  <!-- END ARCHONVII MANAGED: <id> -->
hash:      # BEGIN ARCHONVII MANAGED: <id>          …  # END ARCHONVII MANAGED: <id>
```

```js
// id = stable dotted slug, e.g. "workflow.required-gate.permissions.base"
parseRegions(body, style) -> { regions: [{id, innerStart, innerEnd, inner}], diagnostics: [...] }
//   diagnostics: missing-end, duplicate-id, nested, malformed-marker

replaceRegionInner(body, id, newInner, style) -> { body, changed } | throws on malformed

reconcile(consumerBody, desired /* [{id, inner}] */, style) ->
  { status: 'clean_apply'|'adoption_needed'|'conflict',
    changed: boolean, result: string|null, regions: [{id, status, diff}] }
```

Per-region resolution inside `reconcile`:

| Consumer state for region `id` | Region status | Engine action |
| --- | --- | --- |
| exactly one well-formed region, inner differs | `clean_apply` (changed) | replace inner |
| exactly one well-formed region, inner equal | `clean_apply` (unchanged) | none |
| region absent (file exists) | `adoption_needed` | propose; **never** insert silently |
| region malformed (missing END / dup / nested) | `conflict` | manual migration |
| consumer has a managed `id` not in `desired` (deprecated/unknown) | `conflict` | report; never auto-remove |

File-level status = max severity across regions (`conflict` > `adoption_needed` > `clean_apply`). `changed:true/false` distinguishes idempotent no-ops without a new status (DL14).

> Confirm the per-region table — especially "absent region ⇒ adoption_needed, never silent insert".

## 6. Adapters (layer 2)

| Adapter | Comment style | Danger detection | Metadata preserved |
| --- | --- | --- | --- |
| `markdown` | `<!-- -->` | none (prose) | trailing newline, EOL |
| `yaml` | `#` | **duplicate-key** at same mapping level; **conflict-key** (a managed key the repo also sets outside the region, e.g. managed `contents: read` vs repo `contents: write`) | EOL |
| `shell` | `#` | none | **exec bit**, **shebang stays line 1**, EOL |

YAML danger detection is a tolerant **line scanner**, not a YAML library (DL6 — libraries drop/relocate comments). It only *flags*; it never rewrites. On any flag → file `conflict`.

> Confirm YAML detection is scan-and-flag only (no parse-rewrite).

## 7. Caller managed-region boundary (DL9)

Because `@v1` is a **moving tag**, reusable-workflow body changes (incl. the Go lane) already reach consumers with no caller edit. So callers carry only two small managed regions:

```yaml
# .github/workflows/repo-required-gate.yml  (consumer)
jobs:
  decision:
    # BEGIN ARCHONVII MANAGED: workflow.required-gate.uses
    uses: ArchonVII/github-workflows/.github/workflows/repo-required-gate.yml@v1
    # END ARCHONVII MANAGED: workflow.required-gate.uses
    permissions:
      # BEGIN ARCHONVII MANAGED: workflow.required-gate.permissions.base
      contents: read
      pull-requests: read
      # END ARCHONVII MANAGED: workflow.required-gate.permissions.base
      issues: write          # repo-owned — outside the region, preserved
    with:
      stack: node            # entire with: block repo-owned, never touched
      run-dependency-review: false
```

- **No `permissions:` mapping** → `adoption_needed` (propose adding the mapping with the managed region inside).
- **`permissions:` mapping exists, no managed region** → `adoption_needed`; if a repo-owned `contents:`/`pull-requests:` key already exists → `conflict` (adoption would duplicate the key).
- **`uses:` pin** rarely changes (rides the moving tag); the region exists so a future `@v2`/SHA cutover can propagate.

**Consequence:** the caller group's ongoing value is low (pins ride `@v1`); its real one-time win is standardizing least-priv permissions across callers (**F15** / github-workflows #14). Go-lane adoption in `archon` remains a human `with:` PR. Phased last accordingly.

> Confirm: this delivers F15 and nothing forces Go inputs onto any repo.

## 8. Source model + marker lint (DL11)

- Markers are authored **in the provider source files** (`repo-template`, `github-workflows` example callers). They are comments, so they do not change runtime behavior. `npm run refresh-snapshots` captures them into `src/snapshots/` unchanged (no refresh-mechanism change).
- `src/snapshots/managed-regions.json` (generated by the lint step) enumerates every region id → `{sourceFile, style, group, wholeFile?}`.
- `scripts/lint-managed-regions.mjs` (wired into archon-setup CI) validates: ids globally unique; every BEGIN has a matching END; no nesting; comment style matches file type; **snapshot ids match the manifest** (detects silent rename/drop/dup, DL11). CI fails otherwise.
- The hand-authored `globalUpdates` catalog becomes a **source adapter** producing regions of group `agents` for cross-cutting guidance that has no 1:1 template file.

> Confirm the manifest+lint approach and that provider markup is comments-only (no behavior change).

## 9. Entry point, run modes, integration (DL10, DL12)

```
node bin/archon-setup.mjs distribute [--target <path> | --all]
     [--group callers|agents|hooks|baseline|all] [--id <region-id>]
     [--apply] [--confirm "<phrase>"] [--write-preview]
     [--log <path-outside-consumer-worktrees>]
```

- **Default = dry-run.** Read-only on consumer repos. Prints a per-file status table + unified diffs to stdout; appends a JSON run-log **outside** any consumer worktree (default `~/.claude/archon-distribute-log.jsonl`). Writes nothing into consumer repos (DL12).
- **`--apply`** writes only files whose status is `clean_apply` & `changed`, atomically (tmp+rename), preserving exec bit / newline / shebang. `adoption_needed` / `conflict` / `skip` are never written. `--all` requires `--confirm "<phrase>"` (reusing the `globalUpdates` confirmation gate).
- **`--write-preview`** is the *only* way to emit into a consumer repo without `--apply`: for `adoption_needed`, write `.archon/distribute-preview/<relpath>.patch` for human review. Explicit-flag only (it dirties the worktree).
- **Skips:** dirty worktree, protected branch (`main`/`master`), file/group not in the repo's applicability profile (§10), unsupported file type, path-safety violation.
- **`globalUpdates.distributeGlobalUpdate`** is refactored to build `desired` regions from the catalog adapter and call `distribute`; existing confirmation phrases and per-repo result shapes are preserved (regression-tested).

Exit codes (stable, for automation, DL14): `0` no changes needed · `10` changes available (dry-run found clean_apply work) · `20` adoption_needed/conflict present · `1` operational failure.

> Confirm the flag surface, the run-log default location, and the exit-code map.

## 10. Non-functional requirements (DL14)

| Area | Requirement |
| --- | --- |
| No dry-run writes | Dry-run must not modify consumer repos (incl. preview files) without `--write-preview`. |
| Idempotency | Re-run after `--apply` ⇒ all `clean_apply`, `changed:false`. |
| Status detail | `status` + `changed:true/false`. |
| Exit codes | Stable `0/10/20/1` as above. |
| Applicability gating | The engine does **not** decide if a file belongs in a repo. A higher-level profile/predicate (`appliesTo(repo)`, seeded from `.github/archon-setup.json` / detected stacks / explicit per-repo profile) decides. **New-file creation is profile-gated**: absent file + in profile ⇒ create; absent file + not in profile ⇒ `skip` (not-applicable). |
| File metadata | Preserve exec bits (hooks), newline style, shebang placement. |
| Path safety | Allowlisted repo-relative paths only; reject symlink traversal + path escape (reuse `lib/paths.mjs safeJoin`). |
| No auto-push | `--apply` writes local changes only; no `git`/PR side effects. |
| YAML safety | Duplicate-key + conflict-key detection; no semantic YAML merge. |
| Marker linting | missing END, duplicate ID, nested, unsupported comment syntax, deprecated/unknown ID. |
| Secret safety | Run-log content passes through `redact.mjs` before write. |
| Atomic writes | tmp+rename (reuse `writeAtomic.mjs` / `safeWriteFile`). |

## 11. Testing strategy

- **Engine (pure):** parse (well-formed / missing-END / dup-ID / nested / unknown-id), replace (changed/unchanged), reconcile status precedence, both comment styles, EOL preservation.
- **Adapters:** YAML duplicate-key + conflict-key flags; shell shebang+exec-bit preservation; markdown trailing newline.
- **Distributor (temp fixture repo tree + fake registry):** dry-run leaves worktree clean (asserted via status); `--apply` writes only `clean_apply`; `adoption_needed`/`conflict` never written; skip dirty/protected/not-applicable; idempotency; exit codes; `--write-preview` emits a patch; run-log lands outside the worktree; path-safety rejection.
- **Lint:** snapshot ids match `managed-regions.json`; CI fails on dup/rename/drop.
- **Back-compat:** existing `globalUpdates` confirmation phrases still distribute the same AGENTS blocks via the adapter (golden).
- **Golden end-to-end:** a fixture `repo-required-gate.yml` with active `stack: node` → `distribute --group callers` proposes `permissions.base` adoption, leaves `with:` untouched, preserves `stack: node`.

## 12. Build order (one PR per slice, all under #145)

| PR | Slice | Touches | Upstream dep |
| --- | --- | --- | --- |
| 1 | Region engine + adapters + lint + `managed-regions.json` + tests | `src/distributor/**`, `scripts/lint-managed-regions.mjs` | — |
| 2 | `distribute` subcommand + distributor (dry-run/apply/preview/log/skip/profile); **AGENTS/Markdown group**; refactor `globalUpdates` to delegate | `bin/`, `src/distributor/distribute.mjs`, `src/server/globalUpdates.mjs` | — |
| 3 | **Hooks group** + provider markup | `repo-template/.githooks/**` (upstream PR) → snapshot refresh | repo-template PR + refresh |
| 4 | **Callers group** + provider markup (uses pin + `permissions.base` → F15) | `github-workflows` example callers (upstream PR) → snapshot refresh | github-workflows PR + `v1`? |
| 5 | **Other baseline** (commentable files only) + ROADMAP/status reconciliation | repo-template (upstream) → refresh | repo-template PR + refresh |

Provider-markup PRs (3–5) are **separate upstream PRs** that land + snapshot-refresh before the matching consumer group works. PR4's permission standardization is the F15 win.

## 13. Risks

- **Provider markup churn** — marking up source templates touches source-of-truth files; markers are comments (no behavior change) and the lint guards ids. Verify caller YAML still `actionlint`-clean after markup.
- **Adoption friction (expected)** — the first reconcile of the 4 customized repos will mostly report `adoption_needed`/`conflict`. That is the point: it surfaces decisions instead of clobbering. `--write-preview` patches are the human resolution path.
- **YAML comment fragility** — markers are line comments (safe); duplicate-key detection must be a tolerant scanner, detection-only.
- **globalUpdates regression** — back-compat must be exact (confirmation phrases, result shapes); covered by golden tests.
- **Low caller ROI** — pins ride `@v1`; document so we don't over-invest in the callers group beyond the one-time F15 standardization.

## 14. Open items / follow-ups (deferred)

- Per-file-group ownership policy as explicit metadata (DL3 deferral).
- Sidecar ownership manifest for commentless JSON (DL13 deferral).
- Advisory checksums on managed regions (DL7 deferral).
- A `distribute --all` PR-opening workflow (DL14 keeps `--apply` push-free; a separate authorized PR lane is future work).
