// src/server/ecosystem/manifestStatus.mjs
//
// Fast (cheap) repo status from the onboarding manifest alone (#215, spec
// §4.2; statuses from docs/FRONTEND_REDESIGN_SPEC.md §5.1). Reads the target
// repo's .github/archon-setup.json (written by
// src/server/tasks/writeSetupManifest.mjs) and compares its recorded
// sourceSnapshots SHAs against the current pins in src/snapshots/manifest.json.
// This is a manifest read, never a file audit — a matching manifest may still
// hide hand-edited files, which is why manifest_current must always render
// qualified ("Manifest current · run audit to verify", spec §5 honesty rule).

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// src/server/ecosystem -> src/snapshots/manifest.json
const DEFAULT_SNAPSHOT_MANIFEST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "snapshots", "manifest.json",
);

const MANIFEST_RELATIVE_PATH = ".github/archon-setup.json";

function recordedShas(sourceSnapshots) {
  if (!sourceSnapshots || typeof sourceSnapshots !== "object" || Array.isArray(sourceSnapshots)) return null;
  const entries = Object.entries(sourceSnapshots).filter(([, v]) => v && typeof v === "object");
  if (entries.length === 0) return null;
  return new Map(entries.map(([key, v]) => [key, v.sha ?? null]));
}

// Pure: classify a parsed setup manifest against the current snapshot pins.
// `currentPins` is the `snapshots` object of src/snapshots/manifest.json.
export function compareManifestToPins(setupManifest, currentPins) {
  if (setupManifest === null) return "not_onboarded";
  if (!setupManifest || typeof setupManifest !== "object" || setupManifest.tool !== "archon-setup") {
    return "unknown_needs_audit";
  }
  const recorded = recordedShas(setupManifest.sourceSnapshots);
  if (!recorded) return "unknown_needs_audit";

  const pinEntries = Object.entries(currentPins ?? {}).filter(([, v]) => v && typeof v === "object" && v.sha);
  if (pinEntries.length === 0) return "unknown_needs_audit"; // no baseline to compare against

  // Every current pin must be recorded with a matching sha; a missing key or
  // an older sha both mean the repo was onboarded against an older baseline.
  for (const [key, pin] of pinEntries) {
    if (recorded.get(key) !== pin.sha) return "manifest_outdated";
  }
  return "manifest_current";
}

async function readJson(path) {
  // Distinguishes "file absent" (null) from "present but unreadable/invalid"
  // (undefined) so the caller can map them to different statuses. Only a
  // genuinely missing path means absent; EACCES/EISDIR and friends are
  // "present but unreadable" and must NOT read as not_onboarded (Codex
  // review, PR #228).
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    return err?.code === "ENOENT" || err?.code === "ENOTDIR" ? null : undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// I/O wrapper: fast status for one repo checkout.
//   not_onboarded       — no .github/archon-setup.json
//   manifest_current    — manifest's recorded baseline == current snapshot pins
//   manifest_outdated   — manifest exists, older/incomplete baseline
//   unknown_needs_audit — manifest (or pins) unreadable or not comparable
export async function computeFastStatus(repoPath, { snapshotManifestPath = DEFAULT_SNAPSHOT_MANIFEST_PATH } = {}) {
  if (!repoPath) throw new Error("repoPath is required");
  const setupManifest = await readJson(join(repoPath, MANIFEST_RELATIVE_PATH));
  if (setupManifest === null) return "not_onboarded";
  if (setupManifest === undefined) return "unknown_needs_audit";

  const pinsFile = await readJson(snapshotManifestPath);
  if (pinsFile === null || pinsFile === undefined) return "unknown_needs_audit";
  return compareManifestToPins(setupManifest, pinsFile.snapshots);
}
