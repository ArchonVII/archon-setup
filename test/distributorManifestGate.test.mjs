import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, diffManifest } from "../src/distributor/markerManifest.mjs";

// CI gate (A3): the committed production manifest must match a fresh build of
// the committed sources, with no diagnostics. This is the `--check` mode run as
// a node test so it rides `npm test` without wiring the script into CI. A silent
// rename/drop/dup of a managed-region id fails here.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = join(ROOT, "src", "distributor", "managed-sources.json");
const MANIFEST = join(ROOT, "src", "distributor", "managed-regions.json");

test("committed managed-regions manifest matches its sources", () => {
  const sources = JSON.parse(readFileSync(SOURCES, "utf8"));
  const sourcesDir = dirname(SOURCES);
  const read = (relativePath) => readFileSync(join(sourcesDir, relativePath), "utf8");

  const built = buildManifest(sources, read);
  const committed = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { entries: [] };
  const result = diffManifest(committed, built);

  assert.ok(
    result.ok,
    `managed-regions.json is stale — run: npm run lint:markers -- --write-manifest\n${JSON.stringify(result.diagnostics, null, 2)}`,
  );
});
