import { readFile, access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { hasCurrentManagedBlock, reconcileManagedBlockNearTop } from "./managedMarkdownBlock.mjs";
import {
  applySnapshotPreservingFrontmatter,
  markdownMatchesSnapshotAllowingFrontmatter,
} from "./markdownFrontmatter.mjs";
import { startupBaselineMatchesExpected } from "./startupBaselineContract.mjs";

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
const STARTUP_BASELINE_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  ".agent",
  "startup-baseline.json"
);
const PLANS_README_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  "docs",
  "plans",
  "README.md"
);
// Document-policy charter + placement rules (document-policy spec §5.1, lane 1c).
// foundation.agents distributes it alongside AGENTS.md so a new repo lands the
// full policy the AGENTS.md Start Map points at. Frontmatter-tolerant like the
// plans README: wiki-managed repos may prepend repo-local YAML.
const DOCUMENT_POLICY_SNAPSHOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template",
  "docs",
  "agent-process",
  "document-policy.md"
);
const AGENTS_MANAGED_BLOCK_ID = "agents-start-map";
const LEGACY_AGENTS_MANAGED_BLOCK_IDS = ["agents-workflow-contract"];

async function readAgentsSnapshot(ctx) {
  let body = await readFile(AGENTS_SNAPSHOT, "utf8");
  const mode = ctx.taskOptions?.changelogMode || "Mode 1: direct edit";
  return body.replace(
    /<Mode 1: direct edit \/ Mode 2: `\.changelog\/unreleased\/` fragments>/,
    mode === "fragments" ? "Mode 2: `.changelog/unreleased/` fragments" : "Mode 1: direct edit"
  );
}

function managedAgentsBody(snapshotBody) {
  const start = "<!-- BEGIN MANAGED AGENT START MAP -->";
  const end = "<!-- END MANAGED AGENT START MAP -->";
  const startIndex = snapshotBody.indexOf(start);
  const endIndex = snapshotBody.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("repo-template AGENTS.md is missing the managed agent start map");
  }
  return snapshotBody.slice(startIndex, endIndex + end.length).trim();
}

async function fileExists(root, relativePath) {
  try {
    await access(safeJoin(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileMatchesMarkdownSnapshot(root, relativePath, snapshotBody) {
  try {
    const current = await readFile(safeJoin(root, relativePath), "utf8");
    return markdownMatchesSnapshotAllowingFrontmatter(current, snapshotBody);
  } catch {
    return false;
  }
}

async function startupBaselineCurrent(root) {
  try {
    const current = JSON.parse(await readFile(safeJoin(root, ".agent/startup-baseline.json"), "utf8"));
    const expected = JSON.parse(await readFile(STARTUP_BASELINE_SNAPSHOT, "utf8"));
    return startupBaselineMatchesExpected(current, expected);
  } catch {
    return false;
  }
}

async function snapshotBodyPreservingFrontmatter(root, relativePath, snapshotBody) {
  try {
    const current = await readFile(safeJoin(root, relativePath), "utf8");
    return applySnapshotPreservingFrontmatter(current, snapshotBody);
  } catch {
    return snapshotBody;
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
    const startupDone = await startupBaselineCurrent(ctx.targetPath);
    const plansReadme = await readFile(PLANS_README_SNAPSHOT, "utf8");
    const plansReadmeDone = await fileMatchesMarkdownSnapshot(ctx.targetPath, "docs/plans/README.md", plansReadme);
    const documentPolicy = await readFile(DOCUMENT_POLICY_SNAPSHOT, "utf8");
    const documentPolicyDone = await fileMatchesMarkdownSnapshot(
      ctx.targetPath,
      "docs/agent-process/document-policy.md",
      documentPolicy
    );
    return agentsContractCurrent(current, snapshotBody) && updateLogDone && startupDone && plansReadmeDone && documentPolicyDone
      ? "already-done"
      : "needs-apply";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await readAgentsSnapshot(ctx);
  const updateLog = await readFile(UPDATE_LOG_SNAPSHOT, "utf8");
  const startupBaseline = await readFile(STARTUP_BASELINE_SNAPSHOT, "utf8");
  const plansReadme = await snapshotBodyPreservingFrontmatter(
    ctx.targetPath,
    "docs/plans/README.md",
    await readFile(PLANS_README_SNAPSHOT, "utf8")
  );
  const documentPolicy = await snapshotBodyPreservingFrontmatter(
    ctx.targetPath,
    "docs/agent-process/document-policy.md",
    await readFile(DOCUMENT_POLICY_SNAPSHOT, "utf8")
  );

  let agentsResult;
  const agentsPath = safeJoin(ctx.targetPath, "AGENTS.md");
  try {
    const current = await readFile(agentsPath, "utf8");
    if (current === body) {
      agentsResult = { status: "unchanged", path: agentsPath };
    } else {
      const reconciled = reconcileManagedBlockNearTop(
        stripLegacyManagedBlocks(current),
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
  const startupBaselineResult = await safeWriteFile(
    ctx.targetPath,
    ".agent/startup-baseline.json",
    startupBaseline,
    { overwrite: true }
  );
  const plansReadmeResult = await safeWriteFile(
    ctx.targetPath,
    "docs/plans/README.md",
    plansReadme,
    { overwrite: true }
  );
  const documentPolicyResult = await safeWriteFile(
    ctx.targetPath,
    "docs/agent-process/document-policy.md",
    documentPolicy,
    { overwrite: true }
  );
  recordCreatedFile(ctx, agentsResult, {
    path: "AGENTS.md",
    source: "snapshot:repo-template/AGENTS.md",
  });
  recordCreatedFile(ctx, updateLogResult, {
    path: "docs/repo-update-log.md",
    source: "snapshot:repo-template/docs/repo-update-log.md",
  });
  recordCreatedOnly(ctx, startupBaselineResult, {
    path: ".agent/startup-baseline.json",
    source: "snapshot:repo-template/.agent/startup-baseline.json",
  });
  recordCreatedOnly(ctx, plansReadmeResult, {
    path: "docs/plans/README.md",
    source: "snapshot:repo-template/docs/plans/README.md",
  });
  recordCreatedOnly(ctx, documentPolicyResult, {
    path: "docs/agent-process/document-policy.md",
    source: "snapshot:repo-template/docs/agent-process/document-policy.md",
  });
  return [agentsResult, updateLogResult, startupBaselineResult, plansReadmeResult, documentPolicyResult];
}

export async function verify(ctx) {
  try {
    const current = await readFile(safeJoin(ctx.targetPath, "AGENTS.md"), "utf8");
    const snapshotBody = await readAgentsSnapshot(ctx);
    if (!agentsContractCurrent(current, snapshotBody)) {
      return { ok: false, error: "AGENTS.md is missing the ArchonVII startup map" };
    }
    await access(safeJoin(ctx.targetPath, "docs/repo-update-log.md"), constants.F_OK);
    if (!(await startupBaselineCurrent(ctx.targetPath))) {
      return { ok: false, error: ".agent/startup-baseline.json is missing or stale" };
    }
    const plansReadme = await readFile(PLANS_README_SNAPSHOT, "utf8");
    if (!(await fileMatchesMarkdownSnapshot(ctx.targetPath, "docs/plans/README.md", plansReadme))) {
      return { ok: false, error: "docs/plans/README.md is missing or stale" };
    }
    const documentPolicy = await readFile(DOCUMENT_POLICY_SNAPSHOT, "utf8");
    if (!(await fileMatchesMarkdownSnapshot(ctx.targetPath, "docs/agent-process/document-policy.md", documentPolicy))) {
      return { ok: false, error: "docs/agent-process/document-policy.md is missing or stale" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/AGENTS.md, ${ctx.targetPath}/docs/repo-update-log.md, ${ctx.targetPath}/.agent/startup-baseline.json, ${ctx.targetPath}/docs/plans/README.md, and ${ctx.targetPath}/docs/agent-process/document-policy.md to retry.`;
}

function recordCreatedOnly(ctx, result, entry) {
  if (result?.status === "created") ctx.manifest.createdFiles.push(entry);
}

function stripLegacyManagedBlocks(current) {
  return LEGACY_AGENTS_MANAGED_BLOCK_IDS.reduce(
    (body, id) => body.replace(managedBlockPattern(id), "").replace(/\r?\n{3,}/g, "\n\n"),
    current
  );
}

function managedBlockPattern(id) {
  const start = `<!-- BEGIN ARCHONVII MANAGED BLOCK: ${id} -->`;
  const end = `<!-- END ARCHONVII MANAGED BLOCK: ${id} -->`;
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\r?\\n?`, "g");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
