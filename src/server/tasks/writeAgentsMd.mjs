import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";

const AGENTS_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  "AGENTS.md"
);
const UPDATE_LOG_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  "docs",
  "repo-update-log.md"
);

export async function check(ctx) {
  const agents = safeJoin(ctx.targetPath, "AGENTS.md");
  const updateLog = safeJoin(ctx.targetPath, "docs/repo-update-log.md");
  try {
    await access(agents, constants.F_OK);
    await access(updateLog, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  let body = await readFile(AGENTS_SNAPSHOT, "utf8");
  // Resolve the CHANGELOG-mode placeholder.
  const mode = ctx.taskOptions?.changelogMode || "Mode 1: direct edit";
  body = body.replace(
    /<Mode 1: direct edit \/ Mode 2: `\.changelog\/unreleased\/` fragments>/,
    mode === "fragments" ? "Mode 2: `.changelog/unreleased/` fragments" : "Mode 1: direct edit"
  );
  const updateLog = await readFile(UPDATE_LOG_SNAPSHOT, "utf8");
  const agentsResult = await safeWriteFile(ctx.targetPath, "AGENTS.md", body);
  const updateLogResult = await safeWriteFile(
    ctx.targetPath,
    "docs/repo-update-log.md",
    updateLog
  );
  ctx.manifest.createdFiles.push({
    path: "AGENTS.md",
    source: "snapshot:repo-template/AGENTS.md",
  });
  ctx.manifest.createdFiles.push({
    path: "docs/repo-update-log.md",
    source: "snapshot:repo-template/docs/repo-update-log.md",
  });
  return [agentsResult, updateLogResult];
}

export async function verify(ctx) {
  const agents = safeJoin(ctx.targetPath, "AGENTS.md");
  const updateLog = safeJoin(ctx.targetPath, "docs/repo-update-log.md");
  try {
    await access(agents, constants.F_OK);
    await access(updateLog, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/AGENTS.md and ${ctx.targetPath}/docs/repo-update-log.md to retry.`;
}
