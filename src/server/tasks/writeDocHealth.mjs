import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "./repoTemplateSnapshot.mjs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import {
  applySnapshotPreservingFrontmatter,
  markdownMatchesSnapshotAllowingFrontmatter,
} from "./markdownFrontmatter.mjs";

// The doc-health runner + spec, snapshotted from repo-template (the capability's
// canonical home — see docs/agent-process/doc-health.md). doc-health is the
// report-only companion to doc-sweep / the document policy: it finds drift and
// emits a report, leaving fixes to the normal issue -> branch -> PR lane. These
// files are named by the 2026-06-15-document-policy startup baseline but had no
// feature generating them (archon-setup#startup-readiness gap), so a fresh
// onboard reported startup readiness "incomplete" until they were hand-copied.
// Mirrors writeDocSweep: the scripts are exact snapshot copies and the markdown
// spec tolerates repo-local YAML frontmatter; tests are intentionally NOT
// installed into the target.
const FILES = [
  "scripts/doc-health/lib.mjs",
  "scripts/doc-health/health.mjs",
  "docs/agent-process/doc-health.md",
  "docs/agent-process/document-policy.md",
];
const FRONTMATTER_AWARE_FILES = new Set([
  "docs/agent-process/doc-health.md",
  "docs/agent-process/document-policy.md",
]);

export const DOC_HEALTH_FILES = FILES;

// Content-aware drift check, kept local to mirror writeDocSweep. The snapshot is
// read live so CRLF-local / LF-CI stays consistent. A present-but-drifted
// managed file is treated as needs-apply, and apply overwrites it to repair.
async function matchesSnapshot(ctx, file) {
  let actual;
  try {
    actual = await readFile(safeJoin(ctx.targetPath, file), "utf8");
  } catch {
    return false; // missing counts as a mismatch
  }
  const expected = await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8");
  if (FRONTMATTER_AWARE_FILES.has(file)) {
    return markdownMatchesSnapshotAllowingFrontmatter(normalizeSnapshotText(actual), normalizeSnapshotText(expected));
  }
  return normalizeSnapshotText(actual) === normalizeSnapshotText(expected);
}

export async function check(ctx) {
  for (const file of FILES) {
    if (!(await matchesSnapshot(ctx, file))) return "needs-apply";
  }
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  for (const file of FILES) {
    const snapshotBody = normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8"));
    let body = snapshotBody;
    if (FRONTMATTER_AWARE_FILES.has(file)) {
      try {
        const current = await readFile(safeJoin(ctx.targetPath, file), "utf8");
        body = applySnapshotPreservingFrontmatter(current, snapshotBody);
      } catch {
        body = snapshotBody;
      }
    }
    // overwrite:true so a drifted managed file is REPAIRED, not skipped.
    const result = await safeWriteFile(ctx.targetPath, file, body, { overwrite: true });
    recordCreatedFile(ctx, result, { path: file, source: `snapshot:repo-template/${file}` });
    results.push(result);
  }
  return results;
}

export async function verify(ctx) {
  for (const file of FILES) {
    if (!(await matchesSnapshot(ctx, file))) {
      return { ok: false, error: `${file} is missing or has drifted from the repo-template baseline` };
    }
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/scripts/doc-health/, ${ctx.targetPath}/docs/agent-process/doc-health.md, and ${ctx.targetPath}/docs/agent-process/document-policy.md to retry.`;
}
