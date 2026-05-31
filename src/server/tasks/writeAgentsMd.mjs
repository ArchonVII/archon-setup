import { readFile, access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { hasCurrentManagedBlock, reconcileManagedBlock } from "./managedMarkdownBlock.mjs";

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
const AGENTS_MANAGED_BLOCK_ID = "agents-workflow-contract";

async function readAgentsSnapshot(ctx) {
  let body = await readFile(AGENTS_SNAPSHOT, "utf8");
  const mode = ctx.taskOptions?.changelogMode || "Mode 1: direct edit";
  return body.replace(
    /<Mode 1: direct edit \/ Mode 2: `\.changelog\/unreleased\/` fragments>/,
    mode === "fragments" ? "Mode 2: `.changelog/unreleased/` fragments" : "Mode 1: direct edit"
  );
}

function managedAgentsBody(snapshotBody) {
  return snapshotBody.replace(/^# AGENTS\.md\r?\n+/, "");
}

async function fileExists(root, relativePath) {
  try {
    await access(safeJoin(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function agentsContractCurrent(current, snapshotBody) {
  return current === snapshotBody
    || hasCurrentManagedBlock(current, AGENTS_MANAGED_BLOCK_ID, managedAgentsBody(snapshotBody));
}

export async function check(ctx) {
  try {
    const current = await readFile(safeJoin(ctx.targetPath, "AGENTS.md"), "utf8");
    const snapshotBody = await readAgentsSnapshot(ctx);
    const updateLogDone = await fileExists(ctx.targetPath, "docs/repo-update-log.md");
    return agentsContractCurrent(current, snapshotBody) && updateLogDone
      ? "already-done"
      : "needs-apply";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await readAgentsSnapshot(ctx);
  const updateLog = await readFile(UPDATE_LOG_SNAPSHOT, "utf8");

  let agentsResult;
  const agentsPath = safeJoin(ctx.targetPath, "AGENTS.md");
  try {
    const current = await readFile(agentsPath, "utf8");
    if (current === body) {
      agentsResult = { status: "unchanged", path: agentsPath };
    } else {
      const reconciled = reconcileManagedBlock(
        current,
        AGENTS_MANAGED_BLOCK_ID,
        managedAgentsBody(body)
      );
      if (reconciled.changed) {
        await writeFile(agentsPath, reconciled.body, "utf8");
        agentsResult = { status: "updated", path: agentsPath };
      } else {
        agentsResult = { status: "unchanged", path: agentsPath };
      }
    }
  } catch {
    agentsResult = await safeWriteFile(ctx.targetPath, "AGENTS.md", body);
  }

  const updateLogResult = await safeWriteFile(
    ctx.targetPath,
    "docs/repo-update-log.md",
    updateLog
  );
  recordCreatedFile(ctx, agentsResult, {
    path: "AGENTS.md",
    source: "snapshot:repo-template/AGENTS.md",
  });
  recordCreatedFile(ctx, updateLogResult, {
    path: "docs/repo-update-log.md",
    source: "snapshot:repo-template/docs/repo-update-log.md",
  });
  return [agentsResult, updateLogResult];
}

export async function verify(ctx) {
  try {
    const current = await readFile(safeJoin(ctx.targetPath, "AGENTS.md"), "utf8");
    const snapshotBody = await readAgentsSnapshot(ctx);
    if (!agentsContractCurrent(current, snapshotBody)) {
      return { ok: false, error: "AGENTS.md is missing the ArchonVII workflow contract" };
    }
    await access(safeJoin(ctx.targetPath, "docs/repo-update-log.md"), constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/AGENTS.md and ${ctx.targetPath}/docs/repo-update-log.md to retry.`;
}
