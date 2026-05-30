import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";

const README_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  ".agent",
  "coordination",
  "README.md"
);

export async function check(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/coordination/README.md");
  try {
    await access(target, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await readFile(README_SNAPSHOT, "utf8");
  const result = await safeWriteFile(ctx.targetPath, ".agent/coordination/README.md", body);
  recordCreatedFile(ctx, result, {
    path: ".agent/coordination/README.md",
    source: "snapshot:repo-template/.agent/coordination/README.md",
  });
  return result;
}

export async function verify(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/coordination/README.md");
  try {
    const body = await readFile(target, "utf8");
    if (!body.includes("coordination-isolated")) {
      return { ok: false, error: "coordination README does not state the repo is coordination-isolated" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.agent/coordination/README.md to retry.`;
}
