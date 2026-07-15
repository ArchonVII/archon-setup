import { getAdapter } from "./adapters/index.mjs";
import { assertCapabilityIds } from "./capabilityRefs.mjs";
import { parseRegions } from "./regionEngine.mjs";

// Builds the desired-region catalog a distribute run works from. Two sources:
//   1. the managed-regions manifest (snapshot-authored markers, A4 entries) —
//      each entry's desired inner is extracted from its snapshot source file;
//   2. the globalUpdates catalog — cross-cutting AGENTS guidance with no 1:1
//      template file (DL11), carried as legacy GLOBAL UPDATE marker regions (A8).
// Pure: `read(snapshotFile)` is injected so fixtures can drive it.

export function globalUpdatesCatalogEntries(updates) {
  return updates
    .filter((record) => record.distribution?.kind === "agents-managed-block")
    .map((record) => ({
      id: record.id,
      group: "agents",
      provider: "globalUpdates",
      adapter: "markdown",
      targetRelpath: record.distribution.targetPath,
      wholeFile: false,
      appliesToDefault: "existing-file-only",
      inner: record.distribution.body,
      // Inserted blocks keep the legacy marker shape so the delegated
      // globalUpdates path produces byte-identical files (A8 back-compat).
      markerShape: "global-update",
      // EOF-append is the one anchor the legacy path already uses; it is
      // always unique, so adoption can carry a concrete insertion (A2).
      anchor: { kind: "eof-append" },
      protectedBranches: record.distribution.protectedBranches ?? ["main", "master"],
      capabilityIds: assertCapabilityIds(
        record.distribution.capabilityIds,
        `global update ${record.id}`,
      ),
    }));
}

export function manifestCatalogEntries(manifest, read) {
  const entries = [];
  for (const entry of manifest?.entries ?? []) {
    assertCapabilityIds(entry.capabilityIds, `managed region ${entry.id}`);
    const adapter = getAdapter(entry.adapter);
    const snapshotBody = read(entry.snapshotFile);
    const parsed = parseRegions(snapshotBody, adapter.commentStyle);
    if (parsed.diagnostics.length) {
      throw new Error(
        `managed-regions source ${entry.snapshotFile} has marker diagnostics; run the marker lint`,
      );
    }
    const region = parsed.regions.find((r) => r.id === entry.id);
    if (!region) {
      throw new Error(`managed-regions source ${entry.snapshotFile} is missing region ${entry.id}`);
    }
    entries.push({
      ...entry,
      inner: region.inner,
      markerShape: "managed",
      // Snapshot-authored regions declare no insertion anchor yet — adoption
      // is proposed without a patch (A2: never guess an insertion location).
      anchor: null,
      snapshotBody,
    });
  }
  return entries;
}

// A8: onboarding writes its own MANAGED BLOCK regions into consumer AGENTS.md
// files (src/server/tasks/writeAgentsMd.mjs — AGENTS_MANAGED_BLOCK_ID and its
// legacy id). They are owned by onboarding, not the distributor, so they are
// KNOWN (never an unknown-id conflict) but never actionable catalog entries.
export const ONBOARDING_MANAGED_IDS = ["agents-start-map", "agents-workflow-contract"];

export function buildCatalog({ manifest, read, globalUpdates = [] }) {
  const entries = [
    ...manifestCatalogEntries(manifest, read),
    ...globalUpdatesCatalogEntries(globalUpdates),
  ];
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`duplicate catalog id across sources: ${entry.id}`);
    }
    seen.add(entry.id);
  }
  // knownIds is a superset of entry ids (A8): onboarding-owned regions are
  // recognized so reconciliation leaves them untouched and unflagged.
  const knownIds = new Set([...seen, ...ONBOARDING_MANAGED_IDS]);
  return { entries, knownIds };
}
