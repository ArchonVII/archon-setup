import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { safeJoin } from "../lib/paths.mjs";

export const REPO_TEMPLATE_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template"
);

export async function checkAllExist(ctx, relativePaths) {
  try {
    for (const relativePath of relativePaths) {
      await access(safeJoin(ctx.targetPath, relativePath), constants.F_OK);
    }
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function verifyAllExist(ctx, relativePaths) {
  try {
    for (const relativePath of relativePaths) {
      await access(safeJoin(ctx.targetPath, relativePath), constants.F_OK);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Content-aware variants of the *Exist helpers (#95). A managed file that is
// present but has drifted from its snapshot must NOT report as already-done —
// existence alone is too weak a signal for files we own byte-for-byte. The
// snapshot is read live (never a hardcoded string) so the comparison stays
// consistent whether line endings are CRLF (local) or LF (CI).
async function targetMatchesSnapshot(ctx, relativePath) {
  let actual;
  try {
    actual = await readFile(safeJoin(ctx.targetPath, relativePath), "utf8");
  } catch {
    return false; // missing counts as a mismatch
  }
  const expected = await readFile(join(REPO_TEMPLATE_SNAPSHOT, relativePath), "utf8");
  return actual === expected;
}

export async function checkAllMatch(ctx, relativePaths) {
  for (const relativePath of relativePaths) {
    if (!(await targetMatchesSnapshot(ctx, relativePath))) return "needs-apply";
  }
  return "already-done";
}

export async function verifyAllMatch(ctx, relativePaths) {
  for (const relativePath of relativePaths) {
    if (!(await targetMatchesSnapshot(ctx, relativePath))) {
      return { ok: false, error: `${relativePath} is missing or has drifted from the repo-template baseline` };
    }
  }
  return { ok: true };
}

export async function writeSnapshotFile(ctx, relativePath, {
  snapshotPath = relativePath,
  source = `snapshot:repo-template/${snapshotPath}`,
  transform = (body) => body,
  overwrite = false,
} = {}) {
  const body = transform(await readFile(join(REPO_TEMPLATE_SNAPSHOT, snapshotPath), "utf8"));
  const result = await safeWriteFile(ctx.targetPath, relativePath, body, { overwrite });
  recordCreatedFile(ctx, result, { path: relativePath, source });
  return result;
}
