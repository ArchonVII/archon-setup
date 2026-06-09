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

// The doc-sweep runner + full spec, snapshotted from repo-template (the
// capability's canonical home — see docs/agent-process/doc-sweep.md §5). The
// AGENTS.md "## Doc Sweep-Up" contract ships separately via writeAgentsMd (it
// lives in the repo-template AGENTS.md snapshot). Tests are intentionally NOT
// installed into the target — this mirrors agent-lifecycle, which ships the
// scripts without their *.test.mjs.
const FILES = [
  "scripts/doc-sweep/lib.mjs",
  "scripts/doc-sweep/git.mjs",
  "scripts/doc-sweep/sweep.mjs",
  "docs/agent-process/doc-sweep.md",
];
const FRONTMATTER_AWARE_FILES = new Set(["docs/agent-process/doc-sweep.md"]);

export const DOC_SWEEP_FILES = FILES;

// Content-aware drift check, kept local on purpose: the equivalent shared
// helpers (checkAllMatch / writeSnapshotFile overwrite) ride the agent-lifecycle
// drift-repair fix (#95) which is a sibling PR, so depending on them would couple
// this PR to that merge. The snapshot is read live so CRLF-local / LF-CI stays
// consistent. A present-but-drifted managed file is treated as needs-apply, and
// apply overwrites it to repair drift.
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
  return `Delete ${ctx.targetPath}/scripts/doc-sweep/ and ${ctx.targetPath}/docs/agent-process/doc-sweep.md to retry.`;
}
