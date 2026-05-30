import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";

const BOARD_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  ".agent",
  "coordination",
  "board.md"
);

export async function check(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/coordination/board.md");
  try {
    await access(target, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await readFile(BOARD_SNAPSHOT, "utf8");
  const result = await safeWriteFile(ctx.targetPath, ".agent/coordination/board.md", body);
  ctx.manifest.createdFiles.push({
    path: ".agent/coordination/board.md",
    source: "snapshot:repo-template/.agent/coordination/board.md",
  });
  return result;
}

export async function verify(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/coordination/board.md");
  try {
    const body = await readFile(target, "utf8");
    if (!body.includes("Active claims")) {
      return { ok: false, error: "coordination board does not contain an Active claims section" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.agent/coordination/board.md to retry.`;
}
