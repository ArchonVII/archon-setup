import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BLOCK_START,
  BLOCK_END,
  renderEcosystemMapBlock,
  applyEcosystemMapBlock,
  extractEcosystemMapBlock,
} from "../src/server/ecosystem/ecosystemMap.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Strip every \r, not just \r\n pairs, so a lone trailing \r from a CRLF working
// tree (Windows autocrlf) cannot false-fail the comparison.
const norm = (s) => s.replace(/\r/g, "");

const FIXTURE_MAP = {
  repos: [
    {
      owner: "ArchonVII",
      repo: "github-workflows",
      remote: "https://example/gw",
      localPath: "C:/x/gw",
      role: "workflow-provider",
      owns: ["a", "b"],
      versioning: { publicRef: "v1" },
      snapshotKey: "githubWorkflows",
    },
    {
      owner: "ArchonVII",
      repo: "archon-setup",
      remote: "https://example/as",
      localPath: "C:/x/as",
      role: "ecosystem-health-hub",
      owns: [],
      snapshotKey: null,
    },
  ],
};
const FIXTURE_SNAPS = {
  githubWorkflows: { ref: "v1", sha: "c1ad03e6a5839", capturedAt: "2026-06-09T12:40:14.137Z" },
};

test("renderEcosystemMapBlock joins live snapshot refs and is deterministic", () => {
  const a = renderEcosystemMapBlock(FIXTURE_MAP, FIXTURE_SNAPS);
  const b = renderEcosystemMapBlock(FIXTURE_MAP, FIXTURE_SNAPS);
  assert.equal(a, b, "render must be byte-stable across runs");
  assert.match(a, /consumed @v1; snapshot v1@c1ad03e/);
  assert.match(a, /not snapshotted \(integrator\/source\)/);
  assert.match(a, /\| a; b \|/, "owns list renders semicolon-joined");
  assert.match(a, /\| — \|/, "empty owns renders an em dash");
});

test("applyEcosystemMapBlock replaces between markers and is idempotent", () => {
  const doc = `pre\n${BLOCK_START}\nOLD\n${BLOCK_END}\npost\n`;
  const body = renderEcosystemMapBlock(FIXTURE_MAP, FIXTURE_SNAPS);
  const once = applyEcosystemMapBlock(doc, body);
  const twice = applyEcosystemMapBlock(once, body);
  assert.equal(once, twice, "re-applying the same body must not change the doc");
  assert.ok(once.startsWith("pre\n"), "human prose before the block is preserved");
  assert.ok(once.endsWith("post\n"), "human prose after the block is preserved");
  assert.equal(extractEcosystemMapBlock(once), body, "round-trips through extract");
  assert.ok(!once.includes("OLD"), "stale content is gone");
});

test("applyEcosystemMapBlock throws on missing markers rather than appending", () => {
  assert.throws(() => applyEcosystemMapBlock("no markers here", "x"), /markers not found/);
});

// Regression for #151: a CRLF working tree (Windows autocrlf) must not false-fail
// the sync gate. Build the doc with LF, convert to CRLF as a checkout would, and
// assert extraction + normalized comparison still match the LF body. This runs on
// LF CI runners too, so the case is guarded everywhere — not just on Windows.
test("extract + compare tolerate a CRLF document (#151)", () => {
  const body = renderEcosystemMapBlock(FIXTURE_MAP, FIXTURE_SNAPS);
  const lfDoc = `pre\n${BLOCK_START}\n${body}\n${BLOCK_END}\npost\n`;
  const crlfDoc = lfDoc.replace(/\n/g, "\r\n");
  const extracted = extractEcosystemMapBlock(crlfDoc);
  assert.ok(!/\r$/.test(extracted), "extracted block must not end with an orphaned \\r");
  assert.equal(norm(extracted), norm(body), "CRLF extraction must match the LF body after normalization");
});

// The anti-staleness gate: the committed doc block must match what the current
// manifest + snapshot refs render to. Fails loudly with the fix command if stale.
test("committed ecosystem-overview.md block is in sync with the manifest", async () => {
  const map = JSON.parse(await readFile(join(repoRoot, "config", "ecosystem-map.json"), "utf8"));
  const manifest = JSON.parse(
    await readFile(join(repoRoot, map.snapshotManifestPath || "src/snapshots/manifest.json"), "utf8"),
  );
  const doc = await readFile(join(repoRoot, "docs", "ecosystem-overview.md"), "utf8");

  const expected = renderEcosystemMapBlock(map, manifest.snapshots || {});
  const actual = extractEcosystemMapBlock(doc);
  assert.equal(
    norm(actual),
    norm(expected),
    "docs/ecosystem-overview.md is stale — run: node bin/update-ecosystem-overview.mjs",
  );
});

// Guard the meta-only invariant in data, not just prose: the map must not list any
// application/consumer repo, or the coordination-isolation boundary has been crossed.
test("ecosystem-map.json lists only meta-layer repos", async () => {
  const map = JSON.parse(await readFile(join(repoRoot, "config", "ecosystem-map.json"), "utf8"));
  const ids = map.repos.map((r) => r.id).sort();
  assert.deepEqual(ids, ["archon-setup", "github-workflows", "org-defaults", "repo-template", "skills-review"]);
  const roles = new Set(map.repos.map((r) => r.role));
  for (const r of map.repos) {
    assert.notEqual(r.role, "application", `${r.id} is an application repo and must not be in the meta map`);
  }
  assert.ok(roles.has("ecosystem-health-hub") && roles.has("skill-source"));
});

test("skill-source map entry points agents at the catalog and router", async () => {
  const map = JSON.parse(await readFile(join(repoRoot, "config", "ecosystem-map.json"), "utf8"));
  const skillRepo = map.repos.find((r) => r.id === "skills-review");
  assert.ok(skillRepo, "skills-review must be listed in the ecosystem map");
  assert.equal(skillRepo.role, "skill-source");
  assert.equal(skillRepo.localPath, "C:/Users/josep/skills");
  assert.ok(
    skillRepo.owns.includes("docs/skill-catalog.md (skills index)"),
    "skills-review must expose the skill catalog as a source of truth",
  );
  assert.ok(
    skillRepo.owns.includes("shared/skill-router/ (skill selection router)"),
    "skills-review must expose the skill-router selection surface",
  );
});

test("change-routing table answers where skill inventory and selection live", async () => {
  const doc = await readFile(join(repoRoot, "docs", "ecosystem-overview.md"), "utf8");
  const row = doc.split(/\r?\n/).find((line) => line.startsWith("| Skill inventory / selection |"));
  assert.ok(row, "overview must include a Skill inventory / selection change-routing row");
  assert.match(row, /C:\\Users\\josep\\skills\\docs\\skill-catalog\.md/);
  assert.match(row, /C:\\Users\\josep\\skills\\shared\\skill-router\\/);
});
