import { readFileSync } from "node:fs";

const FEATURES = JSON.parse(
  readFileSync(new URL("../registry/features.json", import.meta.url), "utf8"),
);

export const KNOWN_CAPABILITY_IDS = new Set(FEATURES.map((feature) => feature.id));

export function validateCapabilityIds(capabilityIds, context = "distribution entry") {
  if (!Array.isArray(capabilityIds) || capabilityIds.length === 0) {
    return [{ kind: "missing-capability-ids", context }];
  }

  const diagnostics = [];
  for (const capabilityId of capabilityIds) {
    if (!KNOWN_CAPABILITY_IDS.has(capabilityId)) {
      diagnostics.push({ kind: "unknown-capability-id", capabilityId, context });
    }
  }
  return diagnostics;
}

export function assertCapabilityIds(capabilityIds, context = "distribution entry") {
  const diagnostics = validateCapabilityIds(capabilityIds, context);
  if (diagnostics.length === 0) return capabilityIds;

  const diagnostic = diagnostics[0];
  if (diagnostic.kind === "missing-capability-ids") {
    throw new Error(`${context} must declare capabilityIds from src/registry/features.json`);
  }
  throw new Error(
    `${context} references unknown capability id: ${diagnostic.capabilityId}`,
  );
}
