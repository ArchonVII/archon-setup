import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { distributeRepo } from "../src/distributor/distribute.mjs";
import { ONBOARDING_MANAGED_IDS } from "../src/distributor/catalogSource.mjs";
import { loadOperationMapping, mappingRowsFor, operationRowFor } from "../src/contracts/operationMapping.mjs";
import { RAW_FILE_STATUSES } from "../src/contracts/vocab.mjs";

// M0.5 (#156) acceptance criterion: every raw AGENTS-group distributor state
// maps to exactly one Operation action. This test does not trust a hand-kept
// status list — it DRIVES distributeRepo through fixture repos that produce
// every file-level status (recipes from test/distributorReviewFixes.test.mjs)
// and asserts each observed state matches exactly one golden row, and that no
// golden row is dead.

const ENTRY_ID = "2026-01-01-review-block";

function guEntry(overrides = {}) {
  return {
    id: ENTRY_ID,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath: "AGENTS.md",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner: "## Review Block\n\n- Managed guidance line.",
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
    ...overrides,
  };
}

function guBlock(inner = "## Review Block\n\n- Managed guidance line.", id = ENTRY_ID) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${id} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${id} -->`,
    "",
  ].join("\n");
}

// Whole-file snapshot entry: the one shape the distributor will CREATE an
// absent file from (distribute.mjs absent-file branch).
const CREATE_ID = "agents.core";
const CREATE_SNAPSHOT = [
  "# AGENTS",
  "",
  `<!-- BEGIN ARCHONVII MANAGED: ${CREATE_ID} -->`,
  "Managed core guidance.",
  `<!-- END ARCHONVII MANAGED: ${CREATE_ID} -->`,
  "",
].join("\n");

function createEntry() {
  return guEntry({
    id: CREATE_ID,
    markerShape: "managed",
    anchor: null,
    wholeFile: true,
    appliesToDefault: "always",
    inner: "Managed core guidance.",
    snapshotBody: CREATE_SNAPSHOT,
  });
}

function catalogOf(...entries) {
  return { entries, knownIds: new Set([...entries.map((e) => e.id), ...ONBOARDING_MANAGED_IDS]) };
}

async function makeRepo(files = {}) {
  const path = await mkdtemp(join(tmpdir(), "archon-opmap-"));
  for (const [relpath, body] of Object.entries(files)) {
    const full = join(path, relpath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  return { name: "opmap-repo", path, branch: "agent/test/1-opmap", dirty: false };
}

// One scenario per golden row: how to produce the state with a real
// distributeRepo dry-run, plus the existence knowledge (`created`) the M1
// refresh engine supplies from its own pre-reconcile probe.
const SCENARIOS = [
  {
    name: "region equals catalog inner",
    expectRowId: "already-current",
    expectAction: "skip",
    expectStatus: { status: "clean_apply", changed: false },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock()}` }),
  },
  {
    name: "region drifted from catalog inner",
    expectRowId: "managed-drift",
    expectAction: "merge",
    expectStatus: { status: "clean_apply", changed: true },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock("stale content")}` }),
  },
  {
    name: "absent file with whole-file create source",
    expectRowId: "managed-create",
    expectAction: "create",
    expectStatus: { status: "clean_apply", changed: true },
    created: true,
    catalog: () => catalogOf(createEntry()),
    repo: () => makeRepo({}),
  },
  {
    name: "file present, managed region absent",
    expectRowId: "adoption",
    expectAction: "needs_review",
    expectStatus: { status: "adoption_needed", changed: false },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": "# Agents\n\nLocal content only.\n" }),
  },
  {
    name: "unknown region id in consumer file",
    expectRowId: "conflict",
    expectAction: "blocked",
    expectStatus: { status: "conflict", changed: false },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock()}${guBlock("rogue", "mystery-block")}` }),
  },
  {
    name: "malformed markers (BEGIN without END)",
    expectRowId: "conflict",
    expectAction: "blocked",
    expectStatus: { status: "conflict", changed: false },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: () =>
      makeRepo({
        "AGENTS.md": `# Agents\n\n<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${ENTRY_ID} -->\nno end marker\n`,
      }),
  },
  {
    name: "absent file, existing-file-only entry",
    expectRowId: "not-applicable",
    expectAction: "skip",
    expectStatus: { status: "skip", changed: false },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({}),
  },
  {
    name: "unreadable target (directory at file path)",
    expectRowId: "operational-failure",
    expectAction: "blocked",
    expectStatus: { status: "failed", changed: false },
    created: false,
    catalog: () => catalogOf(guEntry()),
    repo: async () => {
      const repo = await makeRepo({});
      await mkdir(join(repo.path, "AGENTS.md"));
      return repo;
    },
  },
];

test("every AGENTS-group distributor file state maps to exactly one golden row, and no row is dead", async () => {
  const mapping = loadOperationMapping();
  const matchedRowIds = new Set();

  for (const scenario of SCENARIOS) {
    const repo = await scenario.repo();
    const result = await distributeRepo({ repo, catalog: scenario.catalog(), mode: "dry-run" });
    assert.equal(result.status, "ok", scenario.name);
    assert.equal(result.files.length, 1, scenario.name);
    const file = result.files[0];

    assert.equal(file.status, scenario.expectStatus.status, `${scenario.name}: raw status`);
    assert.equal(file.changed, scenario.expectStatus.changed, `${scenario.name}: raw changed`);

    const rawState = { status: file.status, changed: file.changed, created: scenario.created };
    const rows = mappingRowsFor(mapping, rawState);
    assert.equal(rows.length, 1, `${scenario.name}: expected exactly one row for ${JSON.stringify(rawState)}`);
    assert.equal(rows[0].rowId, scenario.expectRowId, scenario.name);
    assert.equal(rows[0].operation.action, scenario.expectAction, scenario.name);
    matchedRowIds.add(rows[0].rowId);
  }

  const allRowIds = mapping.rows.map((row) => row.rowId).sort();
  assert.deepEqual([...matchedRowIds].sort(), allRowIds, "every golden row must be exercised by a scenario");
});

test("the golden table covers every raw file status the distributor can emit", () => {
  const mapping = loadOperationMapping();
  const coveredStatuses = [...new Set(mapping.rows.map((row) => row.when.status))].sort();
  assert.deepEqual(coveredStatuses, [...RAW_FILE_STATUSES].sort());
});

test("operationRowFor fails closed on unmapped or under-specified states", () => {
  const mapping = loadOperationMapping();

  // Unknown status: no row may match.
  assert.throws(() => operationRowFor(mapping, { status: "bogus" }), /exactly one row/);

  // A changed clean_apply without existence knowledge is ambiguous between
  // managed-drift and managed-create; M1 must supply `created`.
  assert.throws(
    () => operationRowFor(mapping, { status: "clean_apply", changed: true }),
    /exactly one row/,
  );
  assert.equal(
    operationRowFor(mapping, { status: "clean_apply", changed: true, created: false }).rowId,
    "managed-drift",
  );
  assert.equal(
    operationRowFor(mapping, { status: "clean_apply", changed: true, created: true }).rowId,
    "managed-create",
  );
});

test("conflict rows pin the plan's DL4 literals: recommended null with the human-resolution reason", () => {
  const mapping = loadOperationMapping();
  const conflict = operationRowFor(mapping, { status: "conflict" });
  assert.equal(conflict.recommended, null);
  assert.equal(conflict.recommendationReason, "blocked-conflict-requires-human-resolution");
  assert.deepEqual(conflict.options, ["apply-central", "keep-local", "merge-manual", "defer"]);
});
