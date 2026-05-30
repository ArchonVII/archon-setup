import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";

const PATH = ".github/CODEOWNERS";
const SKIP_REASON = "owner unknown";

function ownerFromContext(ctx) {
  return (ctx.owner || ctx.account || "").trim();
}

function recordSkip(ctx) {
  ctx.manifest.skippedFiles ||= [];
  if (!ctx.manifest.skippedFiles.some((entry) => entry.path === PATH && entry.reason === SKIP_REASON)) {
    ctx.manifest.skippedFiles.push({ path: PATH, reason: SKIP_REASON });
  }
}

export async function check(ctx) {
  if (!ownerFromContext(ctx)) return "needs-apply";
  try {
    await access(safeJoin(ctx.targetPath, PATH), constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const owner = ownerFromContext(ctx);
  if (!owner) {
    recordSkip(ctx);
    return { status: "skipped", path: PATH, reason: SKIP_REASON };
  }
  const result = await safeWriteFile(ctx.targetPath, PATH, `* @${owner}\n`);
  recordCreatedFile(ctx, result, { path: PATH, source: "template:owner" });
  return result;
}

export async function verify(ctx) {
  if (!ownerFromContext(ctx)) return { ok: true };
  try {
    await access(safeJoin(ctx.targetPath, PATH), constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.github/CODEOWNERS to retry.`;
}
