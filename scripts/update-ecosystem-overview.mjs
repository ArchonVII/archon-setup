#!/usr/bin/env node
// Regenerates (or checks) the GENERATED repo-map block inside
// docs/ecosystem-overview.md from config/ecosystem-map.json + the live snapshot
// refs in src/snapshots/manifest.json. Human prose around the block is never touched.
//
//   npm run update-ecosystem-overview            # rewrite the block in place
//   node scripts/update-ecosystem-overview.mjs --check   # exit 1 if the block is stale
//
// Source-only maintenance tool — it reads config/ and docs/, which are not in the
// published package, so it lives under scripts/ (not the shipped bin/).
// The --check mode is what the test/ecosystemOverview.test.mjs sync gate and CI use.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeAtomic } from "../src/server/ecosystem/writeAtomic.mjs";
import {
  renderEcosystemMapBlock,
  applyEcosystemMapBlock,
  extractEcosystemMapBlock,
} from "../src/server/ecosystem/ecosystemMap.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = join(repoRoot, "config", "ecosystem-map.json");
const docPath = join(repoRoot, "docs", "ecosystem-overview.md");

const check = process.argv.includes("--check");

const map = JSON.parse(await readFile(mapPath, "utf8"));
const manifestPath = join(repoRoot, map.snapshotManifestPath || "src/snapshots/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const body = renderEcosystemMapBlock(map, manifest.snapshots || {});
const doc = await readFile(docPath, "utf8");

// Compare on normalized newlines so CRLF (local) vs LF (CI) never trips the gate.
// Strip every \r (not just \r\n pairs) — a lone trailing \r from a CRLF doc would
// otherwise survive and false-fail the comparison on Windows checkouts.
const norm = (s) => s.replace(/\r/g, "");
const current = extractEcosystemMapBlock(doc);

if (check) {
  if (norm(current) === norm(body)) {
    console.log("ecosystem-overview.md generated block is up to date.");
    process.exit(0);
  }
  console.error(
    "ecosystem-overview.md generated block is STALE.\n" +
      "Run: npm run update-ecosystem-overview",
  );
  process.exit(1);
}

if (norm(current) === norm(body)) {
  console.log("ecosystem-overview.md already up to date; no write.");
  process.exit(0);
}

await writeAtomic(docPath, applyEcosystemMapBlock(doc, body));
console.log(`ecosystem-overview.md generated block updated (${(map.repos || []).length} repos).`);
