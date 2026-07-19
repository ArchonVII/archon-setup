import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCatalog,
  globalUpdatesCatalogEntries,
  manifestCatalogEntries,
} from "../src/distributor/catalogSource.mjs";
import { listGlobalUpdates } from "../src/server/globalUpdates.mjs";

test("globalUpdatesCatalogEntries maps every agents-managed-block record to a runnable entry", () => {
  const updates = listGlobalUpdates();
  const entries = globalUpdatesCatalogEntries(updates);

  assert.equal(entries.length, updates.filter((update) => update.distribution?.kind === "agents-managed-block").length);
  const browser = entries.find((e) => e.id === "2026-05-31-browser-backend-preflight");
  assert.ok(browser);
  assert.equal(browser.group, "agents");
  assert.equal(browser.provider, "globalUpdates");
  assert.equal(browser.adapter, "markdown");
  assert.equal(browser.targetRelpath, "AGENTS.md");
  assert.equal(browser.wholeFile, false);
  assert.equal(browser.appliesToDefault, "existing-file-only");
  // The desired inner is exactly the catalog body — the engine reconciles inner
  // content; markers stay whatever shape the consumer file already uses (A8).
  const record = updates.find((u) => u.id === browser.id);
  assert.equal(browser.inner, record.distribution.body);
  // Legacy AGENTS blocks insert with the GLOBAL UPDATE marker shape so the
  // delegated globalUpdates path stays byte-compatible.
  assert.equal(browser.markerShape, "global-update");
  assert.deepEqual(browser.anchor, { kind: "eof-append" });
  assert.deepEqual(browser.protectedBranches, ["main", "master"]);
  assert.deepEqual(browser.capabilityIds, record.distribution.capabilityIds);
  const startup = entries.find((entry) => entry.id === "2026-06-09-agent-startup-baseline");
  assert.equal(startup.requireSelectedCapabilities, true);
});

test("global update catalog entries fail closed without valid capability manifest ids", () => {
  const base = {
    id: "future-update",
    distribution: {
      kind: "agents-managed-block",
      targetPath: "AGENTS.md",
      body: "Managed body",
    },
  };
  assert.throws(() => globalUpdatesCatalogEntries([base]), /capabilityIds/i);
  assert.throws(
    () => globalUpdatesCatalogEntries([{ ...base, distribution: { ...base.distribution, capabilityIds: ["not.a.feature"] } }]),
    /unknown capability id/i,
  );
});

test("manifestCatalogEntries extracts each region's desired inner from its snapshot source", () => {
  const manifest = {
    schemaVersion: 1,
    entries: [
      {
        id: "agents.sample-block",
        provider: "repo-template",
        snapshotFile: "fixtures/sample.md",
        targetRelpath: "AGENTS.md",
        adapter: "markdown",
        group: "agents",
        wholeFile: false,
        appliesToDefault: "existing-file-only",
        capabilityIds: ["foundation.agents"],
      },
    ],
  };
  const files = {
    "fixtures/sample.md": [
      "# Sample",
      "",
      "<!-- BEGIN ARCHONVII MANAGED: agents.sample-block -->",
      "Managed content line.",
      "<!-- END ARCHONVII MANAGED: agents.sample-block -->",
      "",
    ].join("\n"),
  };

  const entries = manifestCatalogEntries(manifest, (relpath) => {
    if (!(relpath in files)) throw new Error(`missing fixture: ${relpath}`);
    return files[relpath];
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "agents.sample-block");
  assert.equal(entries[0].inner, "Managed content line.");
  assert.equal(entries[0].markerShape, "managed");
  assert.equal(entries[0].anchor, null);
  assert.equal(entries[0].snapshotBody, files["fixtures/sample.md"]);
});

test("manifest catalog entries fail closed without valid capability manifest ids", () => {
  const base = {
    id: "agents.sample-block",
    provider: "repo-template",
    snapshotFile: "fixtures/sample.md",
    targetRelpath: "AGENTS.md",
    adapter: "markdown",
    group: "agents",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
  };
  const read = () =>
    "<!-- BEGIN ARCHONVII MANAGED: agents.sample-block -->\nx\n<!-- END ARCHONVII MANAGED: agents.sample-block -->\n";

  assert.throws(
    () => manifestCatalogEntries({ entries: [base] }, read),
    /capabilityIds/i,
  );
  assert.throws(
    () => manifestCatalogEntries({ entries: [{ ...base, capabilityIds: ["not.a.feature"] }] }, read),
    /unknown capability id/i,
  );
});

test("buildCatalog merges manifest and globalUpdates entries and exposes the full known-id set", () => {
  const manifest = {
    schemaVersion: 1,
    entries: [
      {
        id: "workflow.sample.uses",
        provider: "github-workflows",
        snapshotFile: "fixtures/sample.yml",
        targetRelpath: ".github/workflows/sample.yml",
        adapter: "yaml",
        group: "callers",
        wholeFile: false,
        appliesToDefault: "existing-file-only",
        capabilityIds: ["workflow.required-gate"],
      },
    ],
  };
  const files = {
    "fixtures/sample.yml": [
      "jobs:",
      "  decision:",
      "    # BEGIN ARCHONVII MANAGED: workflow.sample.uses",
      "    uses: ArchonVII/github-workflows/.github/workflows/sample.yml@v1",
      "    # END ARCHONVII MANAGED: workflow.sample.uses",
      "",
    ].join("\n"),
  };

  const catalog = buildCatalog({
    manifest,
    read: (relpath) => files[relpath],
    globalUpdates: listGlobalUpdates(),
  });

  const ids = catalog.entries.map((e) => e.id);
  assert.ok(ids.includes("workflow.sample.uses"));
  assert.ok(ids.includes("2026-05-31-browser-backend-preflight"));
  // A1: the unknown/deprecated check runs against the FULL catalog independent
  // of any --group/--id filter, so knownIds must cover every source.
  for (const id of ids) assert.ok(catalog.knownIds.has(id));
});

test("buildCatalog rejects an id that appears in both sources", () => {
  const manifest = {
    schemaVersion: 1,
    entries: [
      {
        id: "2026-05-31-browser-backend-preflight",
        provider: "repo-template",
        snapshotFile: "fixtures/dup.md",
        targetRelpath: "AGENTS.md",
        adapter: "markdown",
        group: "agents",
        wholeFile: false,
        appliesToDefault: "existing-file-only",
        capabilityIds: ["foundation.agents"],
      },
    ],
  };
  const files = {
    "fixtures/dup.md": [
      "<!-- BEGIN ARCHONVII MANAGED: 2026-05-31-browser-backend-preflight -->",
      "x",
      "<!-- END ARCHONVII MANAGED: 2026-05-31-browser-backend-preflight -->",
      "",
    ].join("\n"),
  };

  assert.throws(
    () =>
      buildCatalog({
        manifest,
        read: (relpath) => files[relpath],
        globalUpdates: listGlobalUpdates(),
      }),
    /duplicate catalog id/,
  );
});
