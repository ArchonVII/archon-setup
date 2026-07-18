# Lane C design — baseline profiles + capability manifest (steps 3–4)

> **Status:** ACTIVE — C1, C2, and C4 are complete; C3 is in [repo-template #167](https://github.com/ArchonVII/repo-template/pull/167), C5 is in [archon-setup #358](https://github.com/ArchonVII/archon-setup/pull/358), and C6 remains. Consumer convergence is paused until the owner selects target repositories.
> **Date:** 2026-07-11
> **Scope:** closes promise-matrix phantom rows 3/4/5/6 (`C:\GitHub\repo-template\docs\research\2026-07-11-doc-system-promise-matrix.md`)
> **Evidence:** read-only 8-agent sweep (782k tokens, 172 tool calls) over archon-setup, repo-template, 3 consumers, and the GitHub issue record; critic-verified; residual gaps closed by hand. All claims below carry file:line evidence in the sweep reports.

## 1. The disease, precisely

The ecosystem's capability facts — *which feature installs which files, and what a repo must therefore contain* — are hand-spelled in **at least 14 independent places across 6 list families**, with no generator and no cross-check:

| # | Family | Artifact | Size | Evidence |
|---|--------|----------|------|----------|
| 1 | feature→files | `features.json` `creates[]` per feature | ~29 features | `C:\GitHub\archon-setup\src\registry\features.json` |
| 2 | feature→files | per-task hardcoded path constants (`SCRIPT_FILES` 11, `HOOK_FILES` 8, `TEMPLATE_LIBRARY_FILES` 28, `writeAgentsMd` 6…) | ≥4 modules | `src\server\tasks\writeAgentLifecycle.mjs:25-45`, `writeGithooks.mjs:12-21`, `writeTemplateLibrary.mjs:8-38`, `writeAgentsMd.mjs:20-84` |
| 3 | provider→snapshot | `refresh-snapshots.mjs` `SOURCES[].copyFiles/copyDirs` | ~55 files + 6 dirs | `scripts\refresh-snapshots.mjs:18-125` (hand-justified per entry; `manifest.json` is only a 3-row pin ledger) |
| 4 | required floor | `.agent/startup-baseline.json` `required[23]/expectedDirectories[6]/legacy[1]` | **5 physical/textual copies** (repo-template source, snapshot, archon-setup self-copy, 2 inline test duplicates) | `repo-template\.agent\startup-baseline.json`, `test\startup-baseline.test.mjs:12-38` ×2 |
| 5 | required floor | `doc-map.yml` `required.base` | 5 paths, **zero programmatic consumers**; only `AGENTS.md` overlaps the 23 | `repo-template\.agent\doc-map.yml:90-96` |
| 6 | audit expectations | `auditPlan.mjs` `FULL_STARTUP_FEATURE_IDS[7]`, `MINIMAL_STARTUP_PATHS[7]`, + drifted test twin `FULL_STARTUP_FEATURES[8]` | 3 lists | `src\server\onboard\auditPlan.mjs:28-46`, `test\onboardAudit.test.mjs:27-36` (already drifted from source) |
| — | narrative | AGENTS.md Start Map / Checkout Role, document-policy command citations, `globalUpdates.mjs` STARTUP_BASELINE managed-block body (~13-path inline list) | 3+ docs | snapshot `AGENTS.md:22-33,95-99`, `document-policy.md:165-167`, `src\server\globalUpdates.mjs:138-166` |

### Confirmed failure mechanics (rows 3/4/5/6)

- **Row 6 (sharpest live harm):** `foundation.agents` is locked/always-on and copies `startup-baseline.json` **verbatim, never trimmed** (`writeAgentsMd.mjs:284-319`). The shipped repo-local checker `checkStartupReadiness()` (`repo-template\scripts\agent\lib.mjs:215-226`) reads all 23+6 entries **unconditionally**. A default-profile repo is born self-reporting ~19 missing paths. The integrator's own `--audit` is smarter (binary full/minimal, `auditPlan.mjs:449-452`) — the asymmetry is confirmed.
- **The binary trigger is itself broken:** selecting **any one** of 7 trigger features flips audit to "full," demanding all 23 paths. Real case: **hudson-bend** (manifest = 3 features incl. `doc-sweep`) → audit profile "full" → permanently failing audit for paths its features never installed (no `scripts/doc-health/`, missing `agent:close-preflight`/`agent:pr-ready`).
- **Rows 3/4/5:** snapshot AGENTS.md Start Map bullets and `npm run agent:*` / `docs:changelog` / `pr:contract` citations are unconditional, while the default profile installs no `package.json`, no scripts, no check-map, no PR template.
- **The doc floor is uninstallable:** `docs/CANON.md`, `docs/INDEX.md`, `docs/agent-process/doc-system.md`, `.agent/doc-map.yml` are vendored into the snapshot (`refresh-snapshots.mjs:64,70,71,86`) but appear in **no feature's `creates[]`** — onboarding cannot install the very floor `required.base` declares (the still-live #290-class residue).
- **The frozen snapshot ships known lies:** the pinned `doc-map.yml` still asserts the baseline is "GENERATED from this list" — the claim Lane B downgraded to "PLANNED, not yet built" on repo-template main. Every repo onboarded today receives the stale untruth (pin frozen by design until the step-5 promotion gate; this lane makes unfreezing worthwhile).
- **Manifests under-report reality:** hudson-bend's disk has check-map, PR template, coordination board, extra workflows — all added by later manual commits, invisible to `selectedFeatures`. A generator can only reconcile existing repos through audit-based decisioned repair (exactly what PR #349 just automated — good timing, we build on it).

### Issue-record position

- `repo-template#124` lane **T1** ratifies only the narrow slice ("derive startup-baseline `required` from doc-map, fixes #290") — unstarted, queued behind P1.
- **Neither step 3 (profiles) nor step 4 (manifest) has any tracking issue in either repo.** Three open archon-setup symptom issues would be superseded/folded: **#239** (snapshot/audit/check-map drift), **#257** (copyFiles vs baseline drift breaking pin bumps), **#247** (distributor can't propagate baseline additions).
- Matrix erratum: its "repo-template#290" cite is dangling — the real closed issue is `archon-setup#290`; repo-template's twin is `#131`.

## 2. Step 3 — named baseline profiles

New file `src/registry/profiles.json` (sibling of features.json; schema-validated like it):

```json
{
  "schemaVersion": 1,
  "profiles": [
    { "id": "docs-min",       "label": "Docs-only minimum",
      "features": ["<the 9 current default:true foundations>"],
      "guarantees": "AGENTS.md bundle + coordination contract + git init; no npm, no scripts, no CI" },
    { "id": "agent-standard", "label": "Agent lifecycle standard",
      "extends": "docs-min",
      "features": ["agent-lifecycle.baseline", "agent-workflow.check-map", "agent-workflow.anomaly-triage",
                   "agent-workflow.doc-sweep", "agent-workflow.doc-health", "foundation.pr-template",
                   "workflow.required-gate", "foundation.hooks"],
      "guarantees": "everything AGENTS.md's Start Map / Checkout Role references exists" },
    { "id": "flagship",       "label": "Full governance",
      "extends": "agent-standard",
      "features": ["foundation.friction-ledger", "foundation.changelog", "foundation.codeowners",
                   "foundation.dependabot", "agent-workflow.template-library",
                   "agent-workflow.coordination-board", "remote.labels", "remote.branch-protection"] }
  ]
}
```

- Empirical fit: the three live consumers are almost exactly these three shapes (hudson-bend ≈ drifted docs-min+, sales ≈ agent-standard, lifeloot ≈ flagship).
- Ad-hoc feature picks stay legal (UI checkboxes unchanged) — but readiness claims attach to the **resolved selection**, never to a name the repo didn't earn. `startupReadinessProfile()`'s any-of-7 heuristic is deleted; the recorded selection is the profile.
- The chosen profile id + resolved feature set are recorded in `.github/archon-setup.json` (field exists conceptually already: `selectedFeatures`; add `profile`).

## 3. Step 4 — one capability manifest

**Home (recommended):** extend `features.json` in place — it is already the registry; add per-feature `installs[]` detail and let every other list become a generated/validated projection. (Alternative: separate `capabilities.json`; rejected as a second home for the same facts.)

Per-feature manifest shape:

```json
{ "id": "agent-lifecycle.baseline",
  "installs": [
    { "path": "scripts/agent/lib.mjs", "source": "repo-template:scripts/agent/lib.mjs",
      "kind": "file", "contract": "required" },
    { "path": "package.json", "kind": "merge", "npmScripts": { "agent:status": "…", "…": "…" },
      "contract": "required" }
  ],
  "docFloor": false }
```

What each hand list becomes:

| Today (hand) | Tomorrow |
|---|---|
| `creates[]` | generated projection of `installs[].path` (or validated 1:1 by a registry test until the field is dropped) |
| `refresh-snapshots SOURCES.copyFiles` | generated: union of all `installs[].source` (+ explicit non-feature snapshot extras, declared in ONE `snapshotExtras` list with justifications) |
| per-task path constants (`SCRIPT_FILES`, `HOOK_FILES`, …) | task modules read the manifest; constants deleted |
| `.agent/startup-baseline.json` | **generated per selection at onboard time**: `required` = doc-floor (from doc-map `required.base`, see below) ∪ `installs[].path` where `contract=required` for selected features; `expectedDirectories` = derived parent dirs; `legacy` stays a single manifest field; `version` = manifest version + selection hash |
| `auditPlan` FULL/MINIMAL lists | deleted; expectations = selected features × manifest |
| repo-template's own `startup-baseline.json` | generated by `docs:render` from doc-map + repo-template's effective feature set (answers #124 T1 literally) |
| test inline duplicates | rewritten as manifest-driven invariants + ONE snapshot test pinning the manifest itself (drift stays reviewer-visible) |
| `globalUpdates` STARTUP_BASELINE block, distributor `managed-regions` entries | future bodies/entries sourced from the manifest; the 2026-06-09 inline list regenerated or retired in the same lane |

**The elegant fix for row 6:** the shipped repo-local checker stays dumb — no feature-awareness added to `status.mjs`/`lib.mjs`. Because the *baseline file it reads* is now generated per profile, the checker automatically demands exactly what was installed. Consumers need no code update to benefit (they need a regenerated baseline, delivered via #349 decisioned repair).

**G1 resolved (5-path vs 23-path):** they are different layers, not a derivation. `doc-map.required.base` = the provider's doc floor (input); per-feature `installs` = the capability layer (input); generated `startup-baseline.required` = their union filtered by selection (output). The doc floor also becomes installable: a new `foundation.doc-system` feature (or extension of `foundation.agents`) installs CANON/INDEX/doc-map/doc-system — closing the uninstallable-floor residue.

**Rows 3/4/5 (narrative):** AGENTS.md sections gated per feature — minimum-viable is caveat lines matching the existing wiki-bullet precedent ("Repos onboarded without X skip these"); fuller option is manifest-rendered managed blocks (the `delivery-workflow` block pattern, #306, already proves the mechanism). document-policy.md command citations get the same caveat treatment.

## 4. Migration lanes (each = issue → branch → PR; mirror-first, no big-bang)

- **C1 — manifest as checked mirror (archon-setup):** add `installs[]` data + a single verification test asserting features.json `creates[]`, `refresh-snapshots SOURCES`, and task constants all agree with it. Zero behavior change; drift becomes CI-visible. (Subsumes #239, #257's class.)
- **C2 — generate at onboard (archon-setup):** profiles.json; `writeAgentsMd` composes `startup-baseline.json` from manifest × selection instead of verbatim copy; `auditPlan` derives expectations from selection; delete FULL/MINIMAL lists; update the ~6 pinned test files.
- **C3 — provider generation (repo-template):** repo-template's own baseline generated via `docs:render`; doc-map comment updated to describe the now-true mechanism; startup-baseline test derives instead of pinning. (Lands behind the frozen pin; distributed at step 7.)
- **C4 — narrative gating:** feature-caveat the snapshot AGENTS.md Start Map / Checkout Role / document-policy commands (closes rows 3/4/5 textually even before consumers refresh).
- **C5 — doc-floor installability:** `foundation.doc-system` feature (closes the #290 residue).
- **C6 — fleet reconciliation:** regenerate/retire the `globalUpdates` STARTUP_BASELINE block body; require future distributor `managed-regions` entries to cite manifest ids.
- Consumers then converge via `onboard.mjs repair` (decisioned, draft-PR, #349) — hudson-bend is the perfect first patient; archon (dormant gen-2) stays the untouched before-specimen per the matrix's design-gifts note.
- Steps 5–7 (semantic promotion gate, snapshot refresh, distribution) follow per the already-ratified sequence — C1–C6 are what make the step-5 gate's assertions checkable at all.

## 5. Owner decisions — RESOLVED 2026-07-11

1. **Profile set & names:** 3 tiers — `docs-min` / `agent-standard` / `flagship` (owner-selected, recommended option).
2. **Manifest home:** extend `features.json` in place; `creates[]` becomes a generated/validated projection.
3. **Narrative fix depth for C4:** caveat lines now (wiki-bullet precedent); manifest-rendered managed blocks deferred.
4. **Tracking:** new archon-setup epic "Lane C: capability manifest + baseline profiles" with C1–C6 children; #239/#257/#247 folded as superseded symptoms; comment on repo-template#124 recording that T1 ships as lane C3.

## 6. Sweep provenance & corrections

8 subagents (7 readers + adversarial critic), 782,948 tokens, 172 tool calls, run `wf_e7062bb8-eb5`. Critic caught and I discounted: one reader fabricated file contents (`startupBaselineContract.mjs` misread as the data file) and mis-dated the baseline version; one reader wrongly called the snapshot doc-map "byte-identical" to source. Corrections verified against disk. New live contradiction found and carried forward: the matrix's claim that hudson-bend lacks the four `agent:*` npm scripts is stale — disk now shows all four present (`C:\jill\hudson-bend\package.json:17-20`); matrix needs an erratum row alongside the #290→#131 cite fix.
