import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Runtime accessor for the operation-mapping golden (#156). M1's refresh
// engine must project raw distributor file results through THIS table — the
// goldens and the runtime share one decision table by construction, so the
// audit and the UI can never disagree about what action a state implies.

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadOperationMapping() {
  return JSON.parse(readFileSync(join(HERE, "operation-mapping.json"), "utf8"));
}

function dimensionMatches(expected, actual) {
  return expected === null || expected === actual;
}

// Returns every row matching a raw state. Exactly one match is the contract
// (asserted behaviorally by test/operationMapping.test.mjs); callers should
// treat any other cardinality as a hard error.
export function mappingRowsFor(mapping, { status, changed = null, created = null }) {
  return mapping.rows.filter(
    (row) =>
      row.when.status === status &&
      dimensionMatches(row.when.changed, changed) &&
      dimensionMatches(row.when.created, created),
  );
}

export function operationRowFor(mapping, rawState) {
  const rows = mappingRowsFor(mapping, rawState);
  if (rows.length !== 1) {
    throw new Error(
      `operation-mapping must match exactly one row for ${JSON.stringify(rawState)}, got ${rows.length}`,
    );
  }
  return rows[0];
}
