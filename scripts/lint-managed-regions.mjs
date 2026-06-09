#!/usr/bin/env node
// Marker-region lint (A3). Two modes:
//   --write-manifest  regenerate the managed-regions manifest from the sources
//   --check           verify the committed manifest matches a fresh build and
//                     that the sources raise no diagnostics; exit non-zero on
//                     any drift. CI runs --check and never rewrites.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, serializeManifest, diffManifest } from "../src/distributor/markerManifest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCES = join(ROOT, "src", "distributor", "managed-sources.json");
const DEFAULT_MANIFEST = join(ROOT, "src", "distributor", "managed-regions.json");

function readOption(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback;
}

function printDiagnostics(diagnostics) {
  for (const d of diagnostics) {
    const id = d.id ? ` [${d.id}]` : "";
    const file = d.snapshotFile ? ` (${d.snapshotFile})` : "";
    console.error(`  ${d.kind}${id}${file}`);
  }
}

const argv = process.argv.slice(2);
const mode = argv.includes("--write-manifest") ? "write" : argv.includes("--check") ? "check" : null;
if (!mode) {
  console.error("usage: lint-managed-regions.mjs (--write-manifest | --check) [--sources <path>] [--manifest <path>]");
  process.exit(2);
}

const sourcesPath = readOption(argv, "--sources", DEFAULT_SOURCES);
const manifestPath = readOption(argv, "--manifest", DEFAULT_MANIFEST);
const sources = existsSync(sourcesPath) ? JSON.parse(readFileSync(sourcesPath, "utf8")) : [];
const sourcesDir = dirname(sourcesPath);
const read = (relativePath) => readFileSync(join(sourcesDir, relativePath), "utf8");

const built = buildManifest(sources, read);

if (mode === "write") {
  if (built.diagnostics.length) {
    console.error(`Refusing to write manifest — ${built.diagnostics.length} diagnostic(s):`);
    printDiagnostics(built.diagnostics);
    process.exit(1);
  }
  writeFileSync(manifestPath, serializeManifest(built.entries));
  console.log(`Wrote ${built.entries.length} managed-region entr${built.entries.length === 1 ? "y" : "ies"} to ${manifestPath}`);
  process.exit(0);
}

const committed = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { entries: [] };
const result = diffManifest(committed, built);
if (!result.ok) {
  console.error("Managed-region manifest is stale or invalid. Run: npm run lint:markers -- --write-manifest");
  printDiagnostics(result.diagnostics);
  process.exit(1);
}
console.log(`Managed-region manifest OK (${built.entries.length} entries).`);
process.exit(0);
