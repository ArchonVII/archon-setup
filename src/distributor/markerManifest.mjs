import { getAdapter } from "./adapters/index.mjs";
import { parseRegions } from "./regionEngine.mjs";

// Detects the BEGIN marker of each comment style, used to catch a source file
// whose markers don't match its declared adapter (A3 lint check).
const STYLE_BEGIN = {
  markdown: /<!--\s*BEGIN ARCHONVII /,
  hash: /^\s*#\s*BEGIN ARCHONVII /m,
};

// Build the per-region manifest (A4 entry shape) from a per-file sources list.
// `read(snapshotFile)` returns the file text; injecting it keeps this pure
// enough to drive from fixtures or inline content. Validation problems are
// returned as diagnostics (never thrown) so the lint can report them all.
export function buildManifest(sources, read) {
  const entries = [];
  const diagnostics = [];
  const idToFile = new Map();

  for (const src of sources) {
    let adapter;
    try {
      adapter = getAdapter(src.adapter);
    } catch {
      diagnostics.push({ kind: "unknown-adapter", adapter: src.adapter, snapshotFile: src.snapshotFile });
      continue;
    }

    let content;
    try {
      content = read(src.snapshotFile);
    } catch {
      diagnostics.push({ kind: "unreadable-source", snapshotFile: src.snapshotFile });
      continue;
    }

    // Wrong-style markers (e.g. markdown comments in a file declared as yaml):
    // flag and skip parsing under the wrong style so we don't also emit spurious
    // malformed-marker noise.
    const declared = adapter.commentStyle;
    const hasDeclared = STYLE_BEGIN[declared].test(content);
    const hasOther = Object.entries(STYLE_BEGIN).some(
      ([style, re]) => style !== declared && re.test(content),
    );
    if (hasOther && !hasDeclared) {
      diagnostics.push({ kind: "style-mismatch", adapter: src.adapter, snapshotFile: src.snapshotFile });
      continue;
    }

    const parsed = parseRegions(content, declared);
    for (const diagnostic of parsed.diagnostics) {
      diagnostics.push({ ...diagnostic, snapshotFile: src.snapshotFile });
    }

    for (const region of parsed.regions) {
      const prior = idToFile.get(region.id);
      if (prior) {
        diagnostics.push({ kind: "duplicate-id-global", id: region.id, snapshotFile: src.snapshotFile, firstFile: prior });
        continue; // a globally duplicate id must not produce a second manifest entry
      }
      idToFile.set(region.id, src.snapshotFile);
      entries.push({
        id: region.id,
        provider: src.provider,
        snapshotFile: src.snapshotFile,
        targetRelpath: src.targetRelpath,
        adapter: src.adapter,
        group: src.group,
        wholeFile: Boolean(src.wholeFile),
        appliesToDefault: src.appliesToDefault,
      });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, diagnostics };
}

// Canonical on-disk form so --write-manifest and --check round-trip exactly.
export function serializeManifest(entries) {
  return `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`;
}

// --check is ok only when the committed manifest equals a fresh build AND the
// build raised no diagnostics. A silent rename/drop/dup changes one side.
export function diffManifest(committed, built) {
  const committedEntries = committed?.entries ?? [];
  const ok =
    built.diagnostics.length === 0 &&
    JSON.stringify(committedEntries) === JSON.stringify(built.entries);
  return { ok, entries: built.entries, diagnostics: built.diagnostics };
}
