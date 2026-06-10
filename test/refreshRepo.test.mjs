import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshExitCodeFor, refreshRepo, refreshTarget } from "../src/server/refresh/refreshRepo.mjs";
import { ONBOARDING_MANAGED_IDS } from "../src/distributor/catalogSource.mjs";
import { listGlobalUpdates } from "../src/server/globalUpdates.mjs";
import { validate } from "../src/contracts/validate.mjs";

// M1 refresh audit engine (#157): fixture repo per golden-table state, exact
// Operation-mapping assertions, schema-valid output, stable no-op on a clean
// repo, audit-mode repo gates, and CLI exit-code parity (A6).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "archon-setup.mjs");
const REPORT_SCHEMA = JSON.parse(
  readFileSync(join(ROOT, "src", "contracts", "schemas", "repo-refresh-report.schema.json"), "utf8"),
);

const ENTRY_ID = "2026-01-01-refresh-block";
const NOW = "2026-06-09T12:00:00.000Z";

function guEntry(overrides = {}) {
  return {
    id: ENTRY_ID,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath: "AGENTS.md",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner: "## Refresh Block\n\n- Managed guidance line.",
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
    ...overrides,
  };
}

function guBlock(inner = "## Refresh Block\n\n- Managed guidance line.", id = ENTRY_ID) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${id} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${id} -->`,
    "",
  ].join("\n");
}

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
  const path = await mkdtemp(join(tmpdir(), "archon-refresh-"));
  for (const [relpath, body] of Object.entries(files)) {
    const full = join(path, relpath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  return { name: "refresh-repo", path, branch: "main", dirty: false };
}

function soleItem(report) {
  assert.equal(report.categories.length, 1);
  assert.equal(report.categories[0].items.length, 1);
  return report.categories[0].items[0];
}

// ---- one fixture repo per golden-table state (acceptance criterion 4) ----

const STATE_SCENARIOS = [
  {
    name: "already-current region",
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock()}` }),
    expect: {
      raw: { status: "clean_apply", changed: false },
      action: "skip",
      currentState: "present",
      recommended: null,
      recommendationReason: "already-current",
      hasDiff: false,
      exit: 0,
    },
  },
  {
    name: "drifted region",
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock("stale content")}` }),
    expect: {
      raw: { status: "clean_apply", changed: true },
      action: "merge",
      currentState: "drifted",
      recommended: "apply-central",
      recommendationReason: "managed-region-clean-update",
      hasDiff: true,
      exit: 10,
    },
  },
  {
    name: "absent file with whole-file create source",
    catalog: () => catalogOf(createEntry()),
    repo: () => makeRepo({}),
    expect: {
      raw: { status: "clean_apply", changed: true, created: true },
      action: "create",
      currentState: "missing",
      recommended: "apply-central",
      recommendationReason: "managed-region-create",
      hasDiff: false,
      exit: 10,
    },
  },
  {
    name: "adoption needed",
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({ "AGENTS.md": "# Agents\n\nLocal content only.\n" }),
    expect: {
      raw: { status: "adoption_needed", changed: false },
      action: "needs_review",
      currentState: "missing",
      recommended: "apply-central",
      recommendationReason: "adoption-needs-confirmation",
      requiresConfirmation: true,
      hasDiff: false,
      exit: 20,
    },
  },
  {
    name: "malformed markers (file-level conflict verdict)",
    catalog: () => catalogOf(guEntry()),
    repo: () =>
      makeRepo({
        "AGENTS.md": `# Agents\n\n<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${ENTRY_ID} -->\nno end marker\n`,
      }),
    expect: {
      raw: { status: "conflict", reason: "malformed-markers", changed: false },
      action: "blocked",
      currentState: "unknown",
      recommended: null,
      recommendationReason: "blocked-conflict-requires-human-resolution",
      regionId: null,
      hasDiff: false,
      exit: 20,
    },
  },
  {
    name: "not applicable (absent file, existing-file-only)",
    catalog: () => catalogOf(guEntry()),
    repo: () => makeRepo({}),
    expect: {
      raw: { status: "skip", reason: "not-applicable", changed: false, created: true },
      action: "skip",
      currentState: "missing",
      recommended: null,
      recommendationReason: "not-applicable",
      regionId: null,
      hasDiff: false,
      exit: 0,
    },
  },
  {
    name: "operational failure (directory at target path)",
    catalog: () => catalogOf(guEntry()),
    repo: async () => {
      const repo = await makeRepo({});
      await mkdir(join(repo.path, "AGENTS.md"));
      return repo;
    },
    expect: {
      raw: { status: "failed", reason: "read-failed", changed: false },
      action: "blocked",
      currentState: "unknown",
      recommended: null,
      recommendationReason: "blocked-operational-failure",
      regionId: null,
      hasDiff: false,
      exit: 1,
    },
  },
];

for (const scenario of STATE_SCENARIOS) {
  test(`refreshRepo: ${scenario.name}`, async () => {
    const repo = await scenario.repo();
    const report = await refreshRepo({ repo, catalog: scenario.catalog(), now: NOW });

    assert.equal(report.status, "ok");
    const item = soleItem(report);
    const e = scenario.expect;

    assert.equal(item.raw.status, e.raw.status, "raw status");
    assert.equal(item.raw.changed, e.raw.changed, "raw changed");
    if (e.raw.reason) assert.equal(item.raw.reason, e.raw.reason, "raw reason");
    if (e.raw.created !== undefined) assert.equal(item.raw.created, e.raw.created, "raw created");
    assert.equal(item.operation.action, e.action, "operation action");
    assert.equal(item.operation.currentState, e.currentState, "currentState");
    assert.equal(item.recommended, e.recommended, "recommended");
    assert.equal(item.recommendationReason, e.recommendationReason, "recommendationReason");
    if (e.requiresConfirmation) assert.equal(item.operation.requiresConfirmation, true);
    if (e.regionId === null) assert.equal(item.regionId, null);
    assert.equal(typeof item.operation.diff === "string" && item.operation.diff.length > 0, e.hasDiff, "diff presence");
    assert.equal(refreshExitCodeFor(report), e.exit, "exit code");

    // Every engine output is schema-valid (also enforced inside the engine).
    assert.deepEqual(validate(REPORT_SCHEMA, report).errors, []);
  });
}

// ---- per-region granularity for the unknown-id conflict case ----

test("unknown-id conflict keeps per-region items: the rogue region blocks, the known sibling stays honest", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock()}${guBlock("rogue", "mystery-block")}` });

  const report = await refreshRepo({ repo, catalog: catalogOf(guEntry()), now: NOW });

  const items = report.categories[0].items;
  assert.deepEqual(
    items.map((i) => i.itemId),
    [`agents/AGENTS.md#${ENTRY_ID}`, "agents/AGENTS.md#mystery-block"],
  );
  const [known, rogue] = items;
  assert.equal(known.operation.action, "skip");
  assert.equal(known.recommendationReason, "already-current");
  assert.equal(rogue.operation.action, "blocked");
  assert.equal(rogue.raw.reason, "unknown-id");
  assert.equal(rogue.operation.blockerReason, "unknown-id");
  assert.equal(rogue.recommended, null);
  assert.equal(refreshExitCodeFor(report), 20);
});

// ---- stability + no-op (acceptance criterion 3) ----

test("clean repo: repeated audits are byte-identical and a no-op (exit 0)", async () => {
  const body = `# Agents\n\n${guBlock()}${guBlock("local block", "mystery-block")}`;
  const repo = await makeRepo({ "AGENTS.md": body });
  const catalog = catalogOf(guEntry());

  const first = await refreshRepo({ repo, catalog, now: NOW });
  const second = await refreshRepo({ repo, catalog, now: NOW });

  assert.equal(JSON.stringify(first), JSON.stringify(second), "repeated audits must be stable");
  // The unknown/local-only finding is stable too — same item, same verdict.
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), body, "audit writes nothing");

  const clean = await refreshRepo({ repo: await makeRepo({ "AGENTS.md": `# A\n\n${guBlock()}` }), catalog, now: NOW });
  assert.equal(refreshExitCodeFor(clean), 0);
});

// ---- audit-mode repo gates ----

test("a repo on main is audited; an unavailable target reports skipped and exits 1", async () => {
  const onMain = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock("stale")}` });
  assert.equal(onMain.branch, "main");
  const audited = await refreshRepo({ repo: onMain, catalog: catalogOf(guEntry()), now: NOW });
  assert.equal(audited.status, "ok");

  const dirty = { ...(await makeRepo({ "AGENTS.md": `# A\n\n${guBlock()}` })), dirty: true };
  const dirtyReport = await refreshRepo({ repo: dirty, catalog: catalogOf(guEntry()), now: NOW });
  assert.equal(dirtyReport.status, "ok");

  const unavailable = { ...(await makeRepo({})), available: false };
  const skipped = await refreshRepo({ repo: unavailable, catalog: catalogOf(guEntry()), now: NOW });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.reason, "repo-unavailable");
  assert.deepEqual(skipped.categories, []);
  assert.deepEqual(validate(REPORT_SCHEMA, skipped).errors, []);
  assert.equal(refreshExitCodeFor(skipped), 1);
});

// ---- refreshTarget + CLI (real default catalog, real git repos) ----

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(repoPath, ...args) {
  const result = spawnSync("git", ["-C", repoPath, ...args], { env: GIT_ENV, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

async function makeGitRepo(files) {
  const path = await mkdtemp(join(tmpdir(), "archon-refresh-cli-"));
  git(path, "init", "-b", "main");
  for (const [relpath, body] of Object.entries(files)) {
    await writeFile(join(path, relpath), body, "utf8");
  }
  git(path, "add", "-A");
  git(path, "commit", "-m", "chore: fixture");
  return path;
}

function runRefreshCli(...cliArgs) {
  return spawnSync(process.execPath, [BIN, "refresh", ...cliArgs], { env: GIT_ENV, encoding: "utf8" });
}

test("refreshTarget audits a real repo on main and records its baseSha", async () => {
  const path = await makeGitRepo({ "AGENTS.md": "# Agents\n\nLocal content.\n" });

  const report = await refreshTarget({ targetPath: path, now: NOW });

  assert.equal(report.status, "ok");
  assert.match(report.repo.baseSha, /^[0-9a-f]{40}$/);
  assert.equal(report.repo.branch, "main");
  // Real catalog entries are existing-file-only AGENTS blocks -> adoptions.
  assert.ok(report.categories[0].items.some((i) => i.operation.action === "needs_review"));
  assert.deepEqual(validate(REPORT_SCHEMA, report).errors, []);
});

test("CLI: adoption pending on main exits 20 and --json emits a schema-valid report", async () => {
  const path = await makeGitRepo({ "AGENTS.md": "# Agents\n\nLocal content.\n" });

  const result = runRefreshCli("--target", path, "--json");

  assert.equal(result.status, 20, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(validate(REPORT_SCHEMA, report).errors, []);
});

test("CLI: every real block current except one stale exits 10 with the merge item's diff", async () => {
  const records = listGlobalUpdates().filter((r) => r.distribution?.kind === "agents-managed-block");
  assert.ok(records.length > 0, "expected at least one agents-managed-block global update");
  // Every catalog block present and current except the first, which is stale —
  // the audit's only pending change is one clean update, the exit-10 state.
  const blocks = records
    .map((record, index) =>
      [
        `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
        index === 0 ? "stale inner" : record.distribution.body,
        `<!-- END ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
        "",
      ].join("\n"),
    )
    .join("\n");
  const path = await makeGitRepo({ "AGENTS.md": `# Agents\n\n${blocks}` });

  const result = runRefreshCli("--target", path, "--json");

  assert.equal(result.status, 10, result.stderr);
  const report = JSON.parse(result.stdout);
  const merge = report.categories[0].items.find((i) => i.itemId.endsWith(`#${records[0].id}`));
  assert.equal(merge.operation.action, "merge");
  assert.ok(typeof merge.operation.diff === "string" && merge.operation.diff.includes("stale inner"));
  assert.ok(
    report.categories[0].items
      .filter((i) => i !== merge)
      .every((i) => i.operation.action === "skip" && i.recommendationReason === "already-current"),
  );
});

test("CLI: nothing applicable exits 0; non-git target exits 1; missing --target exits 1", async () => {
  const nothing = await makeGitRepo({ "README.md": "# Readme\n" });
  const cleanRun = runRefreshCli("--target", nothing, "--json");
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  const cleanReport = JSON.parse(cleanRun.stdout);
  assert.ok(cleanReport.categories[0].items.every((i) => i.operation.action === "skip"));

  const nonGit = await mkdtemp(join(tmpdir(), "archon-refresh-nongit-"));
  const skippedRun = runRefreshCli("--target", nonGit, "--json");
  assert.equal(skippedRun.status, 1);
  assert.equal(JSON.parse(skippedRun.stdout).reason, "repo-unavailable");

  const missing = runRefreshCli("--json");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing value for --target/);
});
