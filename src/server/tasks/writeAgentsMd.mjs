import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";

const SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  "AGENTS.md"
);

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, "AGENTS.md");
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  let body = await readFile(SNAPSHOT, "utf8");
  // Resolve the CHANGELOG-mode placeholder.
  const mode = ctx.taskOptions?.changelogMode || "Mode 1: direct edit";
  body = body.replace(
    /<Mode 1: direct edit \/ Mode 2: `\.changelog\/unreleased\/` fragments>/,
    mode === "fragments" ? "Mode 2: `.changelog/unreleased/` fragments" : "Mode 1: direct edit"
  );
  const res = await safeWriteFile(ctx.targetPath, "AGENTS.md", body);
  ctx.manifest.createdFiles.push({
    path: "AGENTS.md",
    source: "snapshot:repo-template/AGENTS.md",
  });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, "AGENTS.md");
  try {
    await access(full, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/AGENTS.md to retry.`;
}
