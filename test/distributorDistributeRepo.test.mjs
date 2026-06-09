import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { distributeRepo } from "../src/distributor/distribute.mjs";

// Distributor per-repo behavior (design §9-§10, amendments A1/A2/A5/A6).
// The same function backs dry-run audit, apply, and the globalUpdates
// delegation, so these tests pin the full status matrix.

const GU_BLOCK_ID = "2026-01-01-test-block";

function guEntry(overrides = {}) {
  // Shape produced by globalUpdatesCatalogEntries — legacy marker, eof anchor.
  return {
    id: GU_BLOCK_ID,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath: "AGENTS.md",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner: "## Test Block\n\n- Managed guidance line.",
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
    ...overrides,
  };
}

function guBlock(inner = "## Test Block\n\n- Managed guidance line.") {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${GU_BLOCK_ID} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${GU_BLOCK_ID} -->`,
    "",
  ].join("\n");
}

function catalogOf(...entries) {
  return { entries, knownIds: new Set(entries.map((e) => e.id)) };
}

async function makeRepo(files = {}) {
  const path = await mkdtemp(join(tmpdir(), "archon-distribute-"));
  for (const [relpath, body] of Object.entries(files)) {
    const full = join(path, relpath);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  return { name: "fixture-repo", path, branch: "agent/test/1-fixture", dirty: false };
}

test("region present with differing inner reconciles to clean_apply changed:true (dry-run, no writes)", async () => {
  const before = `# Agents\n\n${guBlock("stale content")}`;
  const repo = await makeRepo({ "AGENTS.md": before });

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.status, "ok");
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].status, "clean_apply");
  assert.equal(result.files[0].changed, true);
  // DL12: dry-run writes nothing into the consumer repo.
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), before);
});

test("region present and already equal is clean_apply changed:false", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock()}` });

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.files[0].status, "clean_apply");
  assert.equal(result.files[0].changed, false);
});

test("region absent in an existing file is adoption_needed, never silently inserted", async () => {
  const repo = await makeRepo({ "AGENTS.md": "# Agents\n\nLocal-only content.\n" });

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.files[0].status, "adoption_needed");
  assert.equal(result.files[0].changed, false);
});

test("a consumer region whose id is missing from the full catalog is a conflict (A1/DL5)", async () => {
  const stray = [
    "<!-- BEGIN ARCHONVII GLOBAL UPDATE: 2020-01-01-removed-update -->",
    "orphaned",
    "<!-- END ARCHONVII GLOBAL UPDATE: 2020-01-01-removed-update -->",
    "",
  ].join("\n");
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${stray}${guBlock()}` });

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.files[0].status, "conflict");
  const conflictRegion = result.files[0].regions.find((r) => r.id === "2020-01-01-removed-update");
  assert.equal(conflictRegion.status, "conflict");
  assert.equal(conflictRegion.reason, "unknown-id");
});

test("malformed markers (missing END) are a conflict", async () => {
  const repo = await makeRepo({
    "AGENTS.md": `# Agents\n\n<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${GU_BLOCK_ID} -->\nno end\n`,
  });

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.files[0].status, "conflict");
  assert.ok(result.files[0].diagnostics.some((d) => d.kind === "missing-end"));
});

test("absent target file outside the profile is a skip (not-applicable, A5)", async () => {
  const repo = await makeRepo({});

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.files[0].status, "skip");
  assert.equal(result.files[0].reason, "not-applicable");
});

test("absent target file inside the profile creates from a fully marked snapshot (A5)", async () => {
  const snapshotBody = [
    "<!-- BEGIN ARCHONVII MANAGED: agents.whole-file -->",
    "# Managed File",
    "",
    "Entire body is managed.",
    "<!-- END ARCHONVII MANAGED: agents.whole-file -->",
    "",
  ].join("\n");
  const entry = guEntry({
    id: "agents.whole-file",
    appliesToDefault: "always",
    wholeFile: true,
    markerShape: "managed",
    anchor: null,
    targetRelpath: "docs/managed.md",
    inner: "# Managed File\n\nEntire body is managed.",
    snapshotBody,
  });
  const repo = await makeRepo({});

  const dry = await distributeRepo({ repo, catalog: catalogOf(entry), mode: "dry-run" });
  assert.equal(dry.files[0].status, "clean_apply");
  assert.equal(dry.files[0].changed, true);
  assert.equal(existsSync(join(repo.path, "docs/managed.md")), false);

  const applied = await distributeRepo({ repo, catalog: catalogOf(entry), mode: "apply" });
  assert.equal(applied.files[0].status, "clean_apply");
  assert.equal(applied.files[0].written, true);
  assert.equal(await readFile(join(repo.path, "docs/managed.md"), "utf8"), snapshotBody);
});

test("dirty repos and protected branches are skipped at repo level", async () => {
  const dirty = { ...(await makeRepo({ "AGENTS.md": "# A\n" })), dirty: true };
  const onMain = { ...(await makeRepo({ "AGENTS.md": "# A\n" })), branch: "main" };

  const dirtyResult = await distributeRepo({ repo: dirty, catalog: catalogOf(guEntry()), mode: "apply" });
  assert.equal(dirtyResult.status, "skipped");
  assert.equal(dirtyResult.reason, "dirty-worktree");

  const mainResult = await distributeRepo({ repo: onMain, catalog: catalogOf(guEntry()), mode: "apply" });
  assert.equal(mainResult.status, "skipped");
  assert.equal(mainResult.reason, "protected-main");
});

test("apply writes only clean_apply files and is idempotent", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock("stale")}` });

  const first = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "apply" });
  assert.equal(first.files[0].written, true);
  const after = await readFile(join(repo.path, "AGENTS.md"), "utf8");
  assert.match(after, /Managed guidance line\./);
  assert.doesNotMatch(after, /stale/);

  const second = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "apply" });
  assert.equal(second.files[0].status, "clean_apply");
  assert.equal(second.files[0].changed, false);
  assert.equal(second.files[0].written, false);
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), after);
});

test("apply never writes adoption_needed or conflict files", async () => {
  const adoption = await makeRepo({ "AGENTS.md": "# Local\n" });
  const conflict = await makeRepo({
    "AGENTS.md": "# Agents\n\n<!-- BEGIN ARCHONVII GLOBAL UPDATE: 1999-01-01-unknown -->\nx\n<!-- END ARCHONVII GLOBAL UPDATE: 1999-01-01-unknown -->\n",
  });

  await distributeRepo({ repo: adoption, catalog: catalogOf(guEntry()), mode: "apply" });
  await distributeRepo({ repo: conflict, catalog: catalogOf(guEntry()), mode: "apply" });

  assert.equal(await readFile(join(adoption.path, "AGENTS.md"), "utf8"), "# Local\n");
  assert.match(await readFile(join(conflict.path, "AGENTS.md"), "utf8"), /1999-01-01-unknown/);
});

test("adoptAnchored applies an eof-append adoption byte-identically to the legacy path", async () => {
  const repo = await makeRepo({ "AGENTS.md": "# Agents\n\nLocal notes.\n" });

  const result = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry()),
    mode: "apply",
    adoptAnchored: true,
  });

  assert.equal(result.files[0].status, "clean_apply");
  assert.equal(result.files[0].written, true);
  // Exact legacy format: ensure trailing newline, blank line, then the block.
  assert.equal(
    await readFile(join(repo.path, "AGENTS.md"), "utf8"),
    `# Agents\n\nLocal notes.\n\n${guBlock()}`,
  );
});

test("ids filter scopes action, not validity (A1)", async () => {
  const otherId = "2026-02-02-other-block";
  const other = guEntry({ id: otherId, inner: "## Other\n\n- Different." });
  const otherBlock = [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${otherId} -->`,
    "old other content",
    `<!-- END ARCHONVII GLOBAL UPDATE: ${otherId} -->`,
    "",
  ].join("\n");
  const before = `# Agents\n\n${guBlock("stale")}${otherBlock}`;
  const repo = await makeRepo({ "AGENTS.md": before });

  const result = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry(), other),
    ids: [GU_BLOCK_ID],
    mode: "apply",
  });

  const body = await readFile(join(repo.path, "AGENTS.md"), "utf8");
  // Selected region updated…
  assert.match(body, /Managed guidance line\./);
  // …known-but-unselected region untouched and unflagged.
  assert.match(body, /old other content/);
  assert.ok(!result.files[0].regions.some((r) => r.id === otherId));
});

test("write-preview emits a proposal file for anchored adoptions only when enabled", async () => {
  const repo = await makeRepo({ "AGENTS.md": "# Local\n" });
  const previewPath = join(repo.path, ".archon", "distribute-preview", "AGENTS.md.patch");

  await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });
  assert.equal(existsSync(previewPath), false);

  const withPreview = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry()),
    mode: "dry-run",
    writePreview: true,
  });
  assert.equal(withPreview.files[0].status, "adoption_needed");
  assert.equal(withPreview.files[0].previewPath, previewPath);
  assert.match(await readFile(previewPath, "utf8"), /BEGIN ARCHONVII GLOBAL UPDATE: 2026-01-01-test-block/);
});

test("CRLF files keep their EOLs outside the replaced inner", async () => {
  const before = `# Agents\r\n\r\n${guBlock("stale").replaceAll("\n", "\r\n")}`;
  const repo = await makeRepo({ "AGENTS.md": before });

  await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "apply" });

  const after = await readFile(join(repo.path, "AGENTS.md"), "utf8");
  assert.match(after, /# Agents\r\n/);
  assert.match(after, /END ARCHONVII GLOBAL UPDATE: 2026-01-01-test-block -->\r\n/);
});
