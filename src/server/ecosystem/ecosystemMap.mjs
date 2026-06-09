// src/server/ecosystem/ecosystemMap.mjs
// Pure render/apply logic for the generated repo-map block in
// docs/ecosystem-overview.md. The bin script (bin/update-ecosystem-overview.mjs)
// wires the filesystem; everything here is deterministic and side-effect-free so
// the sync gate in test/ecosystemOverview.test.mjs can assert against it.
// Mirrors the managed-block approach in src/server/globalUpdates.mjs.

export const BLOCK_START = "<!-- BEGIN GENERATED: ecosystem-map -->";
export const BLOCK_END = "<!-- END GENERATED: ecosystem-map -->";

// Markdown table cells must not contain raw pipes or newlines.
function cell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function joinList(items) {
  return Array.isArray(items) && items.length ? items.map(cell).join("; ") : "—";
}

// One "snapshot / version" cell per repo. Provider repos that archon-setup
// snapshots show the live captured ref + short SHA from src/snapshots/manifest.json
// (joined by snapshotKey) so the doc never carries a hand-typed SHA that can drift.
function snapshotCell(repo, snapshots) {
  if (repo.versioning?.publicRef && repo.snapshotKey && snapshots?.[repo.snapshotKey]) {
    const snap = snapshots[repo.snapshotKey];
    return cell(`consumed @${repo.versioning.publicRef}; snapshot ${snap.ref}@${shortSha(snap.sha)}`);
  }
  if (repo.snapshotKey && snapshots?.[repo.snapshotKey]) {
    const snap = snapshots[repo.snapshotKey];
    return cell(`snapshot ${snap.ref}@${shortSha(snap.sha)}`);
  }
  if (repo.versioning?.publicRef) return cell(`consumed @${repo.versioning.publicRef}`);
  return "not snapshotted (integrator/source)";
}

function shortSha(sha) {
  return typeof sha === "string" ? sha.slice(0, 7) : "unknown";
}

// Renders the INNER body of the generated block (no markers). applyEcosystemMapBlock
// wraps it with markers when writing into the doc. Output is deterministic — no clocks,
// no randomness — so a second run produces byte-identical text.
export function renderEcosystemMapBlock(map, snapshots) {
  const rows = (map.repos || []).map((repo) => {
    const remote = `[${cell(repo.owner)}/${cell(repo.repo)}](${cell(repo.remote)})`;
    return `| ${remote} | \`${cell(repo.localPath)}\` | ${cell(repo.role)} | ${joinList(repo.owns)} | ${snapshotCell(repo, snapshots)} |`;
  });

  const captured = capturedLine(map, snapshots);

  return [
    "| Repo | Local checkout | Role | Owns (source of truth) | Snapshot / version |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    captured,
  ].join("\n");
}

// Surfaces the snapshot capture timestamps so a reader can see how fresh the
// pinned provider snapshots are. Values come from the manifest, not a live clock.
function capturedLine(map, snapshots) {
  const keys = (map.repos || []).map((r) => r.snapshotKey).filter(Boolean);
  const stamps = keys
    .map((k) => snapshots?.[k]?.capturedAt)
    .filter(Boolean)
    .sort();
  if (!stamps.length) return "_Snapshot refs sourced from `src/snapshots/manifest.json`._";
  return `_Provider snapshots captured ${stamps[0]} … ${stamps[stamps.length - 1]} (source: \`src/snapshots/manifest.json\`)._`;
}

// Replaces the inner content between the markers. The markers must already exist
// in the committed doc; a missing marker is a hard error rather than a silent append,
// because the prose around the block is human-owned and we must not relocate it.
export function applyEcosystemMapBlock(docText, body) {
  const start = docText.indexOf(BLOCK_START);
  const end = docText.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`ecosystem-map markers not found or malformed in document (need ${BLOCK_START} … ${BLOCK_END})`);
  }
  const before = docText.slice(0, start + BLOCK_START.length);
  const after = docText.slice(end);
  return `${before}\n${body}\n${after}`;
}

// Extracts the current inner content between the markers (trimmed of the leading/
// trailing newlines applyEcosystemMapBlock adds). Used by the --check gate.
export function extractEcosystemMapBlock(docText) {
  const start = docText.indexOf(BLOCK_START);
  const end = docText.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`ecosystem-map markers not found or malformed in document`);
  }
  // CRLF-aware: on a Windows checkout the doc has \r\n, so strip an optional \r
  // around the boundary newlines instead of leaving an orphaned \r that the
  // comparison gate would choke on.
  return docText.slice(start + BLOCK_START.length, end).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}
