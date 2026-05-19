import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";

const CHECK_MAP_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  ".agent",
  "check-map.yml"
);

export async function check(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/check-map.yml");
  try {
    await access(target, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await readFile(CHECK_MAP_SNAPSHOT, "utf8");
  const result = await safeWriteFile(ctx.targetPath, ".agent/check-map.yml", body);
  ctx.manifest.createdFiles.push({
    path: ".agent/check-map.yml",
    source: "snapshot:repo-template/.agent/check-map.yml",
  });
  return result;
}

export async function verify(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/check-map.yml");
  try {
    const body = await readFile(target, "utf8");
    if (!body.includes("repo-required-gate / decision")) {
      return { ok: false, error: "check map does not reference repo-required-gate / decision" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.agent/check-map.yml to retry.`;
}
