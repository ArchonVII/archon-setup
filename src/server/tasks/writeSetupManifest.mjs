import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const PATH = ".github/archon-setup.json";

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function mergeByPath(previous = [], next = []) {
  const merged = new Map();
  for (const entry of [...previous, ...next]) {
    if (entry?.path && !merged.has(entry.path)) merged.set(entry.path, entry);
  }
  return [...merged.values()];
}

function uniqueObjects(previous = [], next = []) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...previous, ...next]) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

function mergeOnboardingDispositions(previous, next) {
  if (!previous && !next) return undefined;
  const merged = new Map();
  for (const entry of [...(previous?.items || []), ...(next?.items || [])]) {
    if (entry?.itemId) merged.set(entry.itemId, entry);
  }
  return {
    ...(previous || {}),
    ...(next || {}),
    schemaVersion: next?.schemaVersion || previous?.schemaVersion || 1,
    items: [...merged.values()],
  };
}

async function readExistingManifest(targetPath) {
  try {
    return JSON.parse(await readFile(safeJoin(targetPath, PATH), "utf8"));
  } catch {
    return null;
  }
}

export function mergeSetupManifest(previous, next) {
  if (!previous) return next;
  const onboardingDispositions = mergeOnboardingDispositions(
    previous.onboardingDispositions,
    next.onboardingDispositions
  );
  const declinedFeatures = new Set(
    (onboardingDispositions?.items || [])
      .filter((item) => item?.choice === "declined")
      .map((item) => item.feature)
  );
  // A repair records the complete effective selection after owner decisions,
  // including transitive removal of capabilities that depend on a decline.
  // Treat that selection as authoritative; unioning the previous manifest
  // here would silently reintroduce those removed dependents.
  const selectedFeatures = next.onboardingDispositions
    ? uniqueStrings(next.selectedFeatures || [])
    : uniqueStrings([...(previous.selectedFeatures || []), ...(next.selectedFeatures || [])]);
  return {
    ...next,
    selectedFeatures: selectedFeatures.filter((feature) => !declinedFeatures.has(feature)),
    createdFiles: mergeByPath(previous.createdFiles, next.createdFiles),
    skippedFiles: mergeByPath(previous.skippedFiles, next.skippedFiles),
    remoteActions: uniqueObjects(previous.remoteActions, next.remoteActions),
    postChecks: uniqueObjects(previous.postChecks, next.postChecks),
    ...(onboardingDispositions ? { onboardingDispositions } : {}),
  };
}

export async function check() {
  return "needs-apply";
}

export async function apply(ctx) {
  const merged = mergeSetupManifest(await readExistingManifest(ctx.targetPath), ctx.manifest);
  const body = JSON.stringify(merged, null, 2) + "\n";
  // Overwrite because the manifest reflects the most recent run while retaining
  // the existing repo's onboarding history.
  const res = await safeWriteFile(ctx.targetPath, PATH, body, { overwrite: true });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, PATH);
  try {
    await access(full, constants.F_OK);
    const parsed = JSON.parse(await readFile(full, "utf8"));
    return { ok: parsed.tool === "archon-setup" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint() {
  return "The manifest is overwritten on every run, preserving prior manifest history. Nothing to roll back.";
}
