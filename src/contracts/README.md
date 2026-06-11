# Contracts — the seams of the Agent OS v0.1 loop

These seven JSON-Schema files are the typed seams between the loop's stages (audit → decide → execute
→ verify) and the read-only skill-selection provenance record. They are validated by a
**zero-dependency, fail-closed** validator, and pinned to closed vocabularies so the JSON files cannot
drift silently. See [`../../docs/runtime-loop.md`](../../docs/runtime-loop.md) for how they connect at
runtime.

> **Orientation only — verify before relying on it.** Tags below are evidence aids from the
> 2026-06-11 audit and follow-up hardening work. `[V file:line]` means the claim was verified against
> the cited source when written; `[ASSUME]` marks inferred flow that should be re-checked before use.

## The validator

`validate.mjs` implements only the JSON-Schema keywords the contracts use and **throws on any
unsupported keyword** — statically (`assertSchemaSupported`, walks every node) and at validation time
— so a schema edit can never silently stop validating. Zero-dependency by repo policy (no ajv).
Tests and runtime share this one code path. `[V validate.mjs:1-28,55-61,139-161]`

`$ref` is restricted to local `#/$defs/<name>` pointers; the contracts are deliberately self-contained
with no cross-file resolution. `[V validate.mjs:45-53]`

## The schemas

| Schema | Represents | Produced by | Consumed by | Validated where |
| --- | --- | --- | --- | --- |
| `run-state-machine.schema.json` | shape of `run-states.json` (the 21-state machine) | hand-authored `run-states.json` | `runRecord.mjs` loads the data; enforces transitions | `test/contractSchemas.test.mjs` (semantics) `[V title]` |
| `run-report.schema.json` | rendered run status (state, results, verification, rollback cmd) | `buildRunReport` `[V rollback.mjs:193-230]` | UI/decision HTML face `[ASSUME]` | `validateRunReport` `[V rollback.mjs:185-191]` |
| `apply-set.schema.json` | the guarded execution plan for the PR lane | intake (M2) `[ASSUME]` | `runUpdate` `[V :208]`, `autoMergeGate` `[V :59]` | both consumers validate on entry |
| `decision-doc.schema.json` | canonical-JSON audit + per-item resolution | `decisionDoc.mjs` (M2) `[ASSUME]` | intake → ApplySet `[ASSUME]` | `[ASSUME]` decisionDoc reuses `validate.mjs` |
| `repo-refresh-report.schema.json` | one repo's per-category audit (Operation projections) | `refreshRepo` `[V refreshRepo.mjs:162-219]` | decision flow; `postApplyAuditClean` `[V runUpdate.mjs:124-134]` | `refreshRepo` validates before return `[V :214-218]` |
| `operation-mapping.schema.json` | shape of the `operation-mapping.json` golden table | hand-authored golden | `operationMapping.mjs` → `refreshRepo` | `test/operationMapping.test.mjs` `[V title]` |
| `skill-selection.schema.json` | read-only evidence for which active skills the operating agent selected | `buildSkillSelectionRecord` / operator-provided records | optional `runUpdate(..., skillSelection)` planned-ledger field | `validateSkillSelection`; fixture sweep in `test/contractSchemas.test.mjs` |

### Key invariant fields (read the schema files for the full shape)

- **`apply-set` `guards`** — the security surface: `allowAutoMerge` (bool), `allowedPathPatterns`
  (≥1), `requiredConfirmationPhraseHash` (sha256). The eligibility gate and `runUpdate` preflight both
  enforce these. `[V apply-set.schema.json:33-46]`
- **`apply-set` `applyItem`** — `category` ∈ {agents,hooks,callers,baseline,skills}; `resolution` ∈
  {apply-central,keep-local,merge-manual,defer}; `expectedFileSha256`/`expectedRegionInnerSha256`
  (optimistic-concurrency anchors); `writePlan.kind` ∈ {replace-region,create-file,append-region,
  record-ownership}. `[V apply-set.schema.json:51-88]`
- **`run-report` `state`** — the 21-state enum, mirroring `run-states.json`. `[V run-report.schema.json:52-76]`
- **`run-report` `verification`** — `{local, postMerge}` gates, each `status` ∈
  {passed,failed,pending,skipped}. `[V run-report.schema.json:88-96,134-142]`
- **`decision-doc` `recommendationReason`** — closed enum incl. the verbatim
  `blocked-conflict-requires-human-resolution`. `[V decision-doc.schema.json:143-153]`
- **`skill-selection` `selections[]`** — records `name`, catalog-derived relative `SKILL.md` path,
  LF-normalized `skillSha256`, and an authored `whySelected`; discovery failures such as
  `repo-missing`, `status-unreadable` (cleanliness could not be established — corrupt or
  inaccessible index), `catalog-unreadable`, `catalog-ambiguous` (a selected name cataloged at
  multiple distinct paths), `skill-unreadable` (cataloged file missing/unreadable), and `repo-dirty`
  are represented in-band instead of blocking the mechanical PR lane.
- **`skill-selection` semantic invariants** — the zero-dep schema cannot express conditionals, so
  `validateSkillSelection` layers them on top, and every consumer (the builder and `runUpdate`) goes
  through that one chokepoint: every `discovery.status` except `repo-missing` requires a pinned
  40-hex `source.commit` (`repo-missing` must use `null` because no commit could be read);
  `fallback` must match the status (`ok` -> `null`, `repo-dirty` -> `recorded-dirty-provenance`,
  discovery failures -> `proceeded-without-skills`); a usable record must either carry selections or
  set `noRelevantSkill: true` (an empty "ok" record claims nothing); `noRelevantSkill: true` cannot
  coexist with selections; `status` and `dirtyPaths` must agree (`ok` cannot carry dirty paths,
  `repo-dirty` must list them); selection names must be unique (duplicates would smuggle catalog
  ambiguity inside an accepted record); and `whySelected` must contain non-whitespace rationale text.

## Skill-selection truth boundary

The `skill-selection` contract is **provenance, not proof of compliance**. CI can validate the record
shape, fixture coverage, LF-normalized hashing behavior in local unit tests, and that `runUpdate`
attaches a supplied record only to the initial `planned` ledger entry. CI cannot truthfully prove that
an operator read the skill, followed it, or that the skill causally improved the work. The record pins
the skills-repo commit and `SKILL.md` hash so later review can detect what guidance was selected and
whether the consulted file changed.

## Closed vocabularies (`vocab.mjs`)

The single source the schemas, the operation-mapping golden, and the M1–M3 runtime must agree on;
`test/contractSchemas.test.mjs` pins each schema enum to these exports so the JSON cannot drift.
`[V vocab.mjs:1-47]`

- `RESOLUTION_OPTIONS` = apply-central, keep-local, merge-manual, defer
- `OPERATION_ACTIONS` = create, overwrite, merge, skip, blocked, needs_review *(the "atom of trust")*
- `CURRENT_STATES` = missing, present, drifted, unknown
- `RAW_FILE_STATUSES` = clean_apply, adoption_needed, conflict, skip, failed
- `RAW_REPO_STATUSES` = ok, skipped · `REPO_SKIP_REASONS` = missing-path, repo-unavailable,
  unknown-branch, dirty-worktree, protected-main
- `RECOMMENDATION_REASONS` = 7 closed reasons (clean-update, create, already-current,
  adoption-needs-confirmation, not-applicable, blocked-conflict…, blocked-operational-failure)
- `CATEGORIES` = agents, hooks, callers, baseline, skills *(only `agents` is auto-merge-allowed today
  `[V autoMergeGate.mjs:11-14]`; hooks/callers/baseline/skills are later milestones per the vocab
  comments)*

## Stability tiers

Post-Fable hardening established the current v0.1 tiers. Tiers: (1) freeze · (2) stable core with
replaceable adapter fields · (3) provisional · (4) out of v0.1 scope.

| Schema | Tier | Compatibility rule |
| --- | --- | --- |
| `run-state-machine` / `run-states.json` | **1 freeze** | Additive transitions only; never remove a state; `requires` may only grow optional context. The manual-merge and revert-PR gaps found by the audit were closed in #186. |
| `apply-set` | **1 freeze** | The `guards` trio is immutable. New fields must be optional; `expectedFileSha256` and `expectedRegionInnerSha256` are required item fields and are re-checked in the execution worktree before writes. |
| `operation-mapping` | **1 freeze** | Rows may be added only for new raw statuses; all enums stay pinned to `vocab.mjs`. |
| `repo-refresh-report` | **2 stable core** | `raw`, `operation`, and recommendation fields are stable; repo metadata and presentation fields may gain optional fields. |
| `decision-doc` | **2 stable core** | `items[].fingerprints` and `items[].resolution` are stable; evidence/provenance blocks may gain optional adapter fields as the decision UI evolves. |
| `run-report` | **2 stable core** | `state`, `results`, `verification`, and `rollbackCommand` are core. `repoState` and `copyable` remain optional presentation adapters; #187 fixed the result-bucket semantics before this tier was accepted. |
| `skill-selection` | **2 stable core** | The record is provenance, not compliance proof. Additive discovery statuses and optional evidence fields are allowed; selected-skill identity must remain pinned by source commit, relative path, and content hash. |

## Future or non-schema contracts

- **File claims** remain a markdown coordination convention, not a v0.1 JSON contract.
- **Role authority** is documented in [`../../docs/authority-model.md`](../../docs/authority-model.md);
  the `gh` token and branch protection are the trust anchors, not a schema.
- **Model/API usage** is not part of the runtime loop today. If a future loop step calls a model, it
  needs its own cost, retention, and fallback note.
- **Skill promotion/install events** belong to future Skills Hub work; v0.1 only records read-only
  skill-selection provenance.
