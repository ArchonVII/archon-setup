import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { safeJoin } from "../lib/paths.mjs";

const SNAPSHOT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "github-workflows"
);
const REPO_TEMPLATE_WORKFLOW_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  ".github",
  "workflows"
);

function relPath(name) {
  return `.github/workflows/${name}.yml`;
}

function snapshotPath(ctx, name) {
  if (ctx.taskOptions?.snapshotSource === "repo-template") {
    return {
      full: join(REPO_TEMPLATE_WORKFLOW_DIR, `${name}.yml`),
      source: `snapshot:repo-template/.github/workflows/${name}.yml`,
    };
  }
  return {
    full: join(SNAPSHOT_DIR, `${name}.yml`),
    source: `snapshot:github-workflows/${name}.yml`,
  };
}

export async function check(ctx) {
  const name = ctx.taskOptions?.workflowName;
  if (!name) throw new Error("installWorkflow: workflowName missing");
  const full = safeJoin(ctx.targetPath, relPath(name));
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const name = ctx.taskOptions?.workflowName;
  const src = snapshotPath(ctx, name);
  const body = await readFile(src.full, "utf8");
  if (!body.includes("@v1")) {
    throw new Error(`workflow snapshot ${name}.yml does not pin @v1 — refusing to install`);
  }
  const res = await safeWriteFile(ctx.targetPath, relPath(name), body);
  recordCreatedFile(ctx, res, {
    path: relPath(name),
    source: src.source,
  });
  return res;
}

export async function verify(ctx) {
  const name = ctx.taskOptions?.workflowName;
  const full = safeJoin(ctx.targetPath, relPath(name));
  try {
    const body = await readFile(full, "utf8");
    if (!body.includes("@v1")) return { ok: false, error: "workflow does not reference @v1" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  const name = ctx.taskOptions?.workflowName;
  return `Delete ${ctx.targetPath}/.github/workflows/${name}.yml to retry.`;
}
