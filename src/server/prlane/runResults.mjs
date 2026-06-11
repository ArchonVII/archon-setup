// C4 (#187): RunReport.results buckets are outcomes derived from the ledger's
// reached state, never synthesized from the plan. Nothing may appear under
// `applied` before the run reaches the `applied` state; keep-local ownership
// records report as `skipped` (the target region is deliberately left
// untouched); a run that failed before apply reports its items under `failed`.
// A run that has neither applied nor failed has no per-item outcome yet, so
// every bucket stays empty.

// Mirrors the action vocabulary the old resultItemsFromApplySet used:
// keep-local -> skip, create-file -> create, everything else -> merge.
function plannedAction(item) {
  if (item.resolution === "keep-local" || item.writePlan.kind === "record-ownership") return "skip";
  return item.writePlan.kind === "create-file" ? "create" : "merge";
}

export function deriveRunResults({ applySet, reachedApplied, failedStage = null }) {
  const results = { applied: [], skipped: [], blocked: [], failed: [] };
  for (const item of applySet.items) {
    const base = { itemId: item.itemId, file: item.file, regionId: item.regionId };
    if (reachedApplied) {
      if (item.resolution === "keep-local") {
        results.skipped.push({
          ...base,
          action: "skip",
          detail: "keep-local ownership recorded; target region left untouched",
        });
      } else {
        results.applied.push({ ...base, action: plannedAction(item) });
      }
    } else if (failedStage) {
      results.failed.push({
        ...base,
        action: plannedAction(item),
        detail: `never applied; run failed at ${failedStage}`,
      });
    }
  }
  return results;
}

export function resultsFromRecord({ record, applySet }) {
  const reachedApplied = record.entries.some((entry) => entry.state === "applied");
  let failedStage = null;
  for (let i = record.entries.length - 1; i >= 0; i -= 1) {
    if (record.entries[i].state === "failed") {
      failedStage = record.entries[i].failedStage ?? "failed";
      break;
    }
  }
  return deriveRunResults({ applySet, reachedApplied, failedStage });
}
