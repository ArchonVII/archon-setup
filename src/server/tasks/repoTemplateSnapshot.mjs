import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
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

export async function writeSnapshotFile(ctx, relativePath, {
  snapshotPath = relativePath,
  source = `snapshot:repo-template/${snapshotPath}`,
  transform = (body) => body,
} = {}) {
  const body = transform(await readFile(join(REPO_TEMPLATE_SNAPSHOT, snapshotPath), "utf8"));
  const result = await safeWriteFile(ctx.targetPath, relativePath, body);
  if (result.status !== "already-exists") {
    ctx.manifest.createdFiles.push({ path: relativePath, source });
  }
  return result;
}
