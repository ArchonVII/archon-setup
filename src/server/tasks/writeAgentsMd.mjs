import { readFile, access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import {
  formatManagedBlock,
  hasCurrentManagedBlock,
  reconcileManagedBlock,
  reconcileManagedBlockNearTop,
} from "./managedMarkdownBlock.mjs";
import {
  applySnapshotPreservingFrontmatter,
  markdownMatchesSnapshotAllowingFrontmatter,
} from "./markdownFrontmatter.mjs";
import { startupBaselineMatchesExpected } from "./startupBaselineContract.mjs";
import { loadStartupBaseline, serializeStartupBaseline } from "./startupBaseline.mjs";

const SNAPSHOT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots",
  "repo-template"
);
// The repo-relative destination paths foundation.agents writes on onboard. Single
// source for the derived *_SNAPSHOT read paths below AND the capability-manifest
// cross-check: test/capabilityManifest.test.mjs asserts this equals the
// foundation.agents installs[] projection in src/registry/features.json. Keep the
// order in sync with the positional reads that follow.
export const AGENTS_MANAGED_FILES = [
  "AGENTS.md",
  "docs/repo-update-log.md",
  ".agent/startup-baseline.json",
  "docs/plans/README.md",
  "docs/agent-process/message-protocol.md",
];
const snapshotPath = (rel) => join(SNAPSHOT_ROOT, ...rel.split("/"));
const AGENTS_SNAPSHOT = snapshotPath(AGENTS_MANAGED_FILES[0]);
const UPDATE_LOG_SNAPSHOT = snapshotPath(AGENTS_MANAGED_FILES[1]);
// AGENTS_MANAGED_FILES[2] — .agent/startup-baseline.json is NO LONGER copied from
// the snapshot (lane C2, #352). It is generated per resolved selection from the
// capability manifest by startupBaseline.mjs, so there is no *_SNAPSHOT read path
// for it; the vendored snapshot copy remains repo-template's own provider file.
const PLANS_README_SNAPSHOT = snapshotPath(AGENTS_MANAGED_FILES[3]);
// AGENTS_MANAGED_FILES[4] — message-protocol charter (status-tag vocabulary,
// For you / My work lanes, machine-backed SAFE TO CLEAR rule). AGENTS.md's
// `## Message protocol` section links here, so distributing it alongside
// AGENTS.md clears the dangling relative link doc-health flags in every
// onboarded repo (#278). Frontmatter-tolerant like document-policy: wiki-managed
// repos may prepend repo-local YAML.
const MESSAGE_PROTOCOL_SNAPSHOT = snapshotPath(AGENTS_MANAGED_FILES[4]);
const AGENTS_MANAGED_BLOCK_ID = "agents-start-map";
// #306: the cross-tool delivery contract (issue -> branch -> atomic commits ->
// PR, never commit feature work to `main`, Conventional Commits, branch naming
// `agent/<tool>/<issue>-<slug>`) ships as its own managed block so it is
// guaranteed and re-syncable for every onboarded repo, not just freshly created
// ones. Existing repos only got the start map before, which is the lifeloot gap.
export const DELIVERY_WORKFLOW_BLOCK_ID = "delivery-workflow";
const LEGACY_AGENTS_MANAGED_BLOCK_IDS = ["agents-workflow-contract"];

function detectEol(value) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

// #306: wrap the snapshot's `## Workflow` delivery contract in an ArchonVII
// managed block so it is re-syncable. The block body is generated from the
// existing snapshot section (the same way agents-start-map is generated), so no
// edit to src/snapshots/ is required.
function wrapDeliveryWorkflow(body) {
  const eol = detectEol(body);
  const headingIndex = body.indexOf("## Workflow");
  if (headingIndex === -1) {
    throw new Error("repo-template AGENTS.md is missing the ## Workflow delivery contract");
  }
  const afterHeading = headingIndex + "## Workflow".length;
  const nextHeadingOffset = body.slice(afterHeading).search(/\r?\n## /);
  const endIndex = nextHeadingOffset === -1 ? body.length : afterHeading + nextHeadingOffset;
  const section = body.slice(headingIndex, endIndex).replace(/\s+$/, "");
  const before = body.slice(0, headingIndex).replace(/\s+$/, "");
  const after = body.slice(endIndex).replace(/^[\r\n]+/, "");
  const block = formatManagedBlock(DELIVERY_WORKFLOW_BLOCK_ID, section, eol);
  const tail = after ? `${eol}${eol}${after}` : eol;
  return `${before}${eol}${eol}${block}${tail}`;
}

// Start Map bullets that point at feature-installed tooling, keyed by the exact
// bullet prefix in the vendored snapshot and mapped to the registry feature id
// that provides the tooling (as#372; feature ids from src/registry via
// loadRegistry — see the checked-mirror test that pins each prefix to exactly
// one snapshot line). `null` means the bullet never ships: the prose
// feature-caveat is superseded by this emit-time filtering.
export const START_MAP_BULLET_FEATURES = {
  "- Check map:": "agent-workflow.check-map",
  "- Coordination:": "foundation.coordination",
  "- PR process:": "foundation.pr-template",
  "- Agent scripts:": "agent-lifecycle.baseline",
  "- Close guards:": "agent-lifecycle.baseline",
  "- Doc sweep:": "agent-workflow.doc-sweep",
  "- Doc health:": "agent-workflow.doc-health",
  "- Friction ledger:": "foundation.friction-ledger",
  "- Feature-gated bullets:": null,
};

// Drop Start Map bullets whose providing feature is not in the resolved
// selection (as#372, pigafetta#1814: docs-min consumers received pointers to
// scripts/agent, check-map, doc-sweep/doc-health etc. they don't have). Only
// lines inside the managed Start Map markers are considered; a dropped bullet
// also drops its indented continuation lines.
function filterStartMapBySelection(body, selectedFeatureIds) {
  const start = "<!-- BEGIN MANAGED AGENT START MAP -->";
  const end = "<!-- END MANAGED AGENT START MAP -->";
  const startIndex = body.indexOf(start);
  const endIndex = body.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) return body;

  const selected = new Set(selectedFeatureIds);
  const section = body.slice(startIndex, endIndex);
  const eol = section.includes("\r\n") ? "\r\n" : "\n";
  const lines = section.split(/\r?\n/);
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    const gate = Object.entries(START_MAP_BULLET_FEATURES).find(([prefix]) => line.startsWith(prefix));
    if (gate) {
      const [, feature] = gate;
      dropping = feature === null || !selected.has(feature);
      if (!dropping) kept.push(line);
      continue;
    }
    if (dropping && /^\s+\S/.test(line)) continue; // continuation of a dropped bullet
    dropping = false;
    kept.push(line);
  }
  return body.slice(0, startIndex) + kept.join(eol) + body.slice(endIndex);
}

// Pure snapshot -> emitted-body transform. Exported and shared with the audit so
// the audit's "expected" body never drifts from what onboarding actually writes:
// filter the Start Map per resolved selection (as#372), resolve the changelog
// mode (#291), then wrap the delivery contract (#306). Omitting
// `selectedFeatureIds` keeps the unfiltered legacy rendering.
export function renderAgentsBody(rawBody, { selectedFeatureIds } = {}) {
  const filtered = Array.isArray(selectedFeatureIds)
    ? filterStartMapBySelection(rawBody, selectedFeatureIds)
    : rawBody;
  return wrapDeliveryWorkflow(filtered);
}

export function extractDeliveryWorkflowBody(renderedBody) {
  const start = `<!-- BEGIN ARCHONVII MANAGED BLOCK: ${DELIVERY_WORKFLOW_BLOCK_ID} -->`;
  const end = `<!-- END ARCHONVII MANAGED BLOCK: ${DELIVERY_WORKFLOW_BLOCK_ID} -->`;
  const startIndex = renderedBody.indexOf(start);
  const endIndex = renderedBody.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("rendered AGENTS.md is missing the managed delivery-workflow block");
  }
  return renderedBody.slice(startIndex + start.length, endIndex).trim();
}

async function readAgentsSnapshot(selectedFeatureIds) {
  const body = await readFile(AGENTS_SNAPSHOT, "utf8");
  return renderAgentsBody(body, { selectedFeatureIds });
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

// The resolved selection whose floor this baseline is generated for. Onboarding
// threads it via ctx (executePlan sets ctx.selectedFeatureIds = the plan's
// resolved selection; the manifest carries the same list). Direct unit calls
// that omit it fall back to the feature that owns this task.
function selectionFrom(ctx) {
  return ctx.selectedFeatureIds || ctx.manifest?.selectedFeatures || ["foundation.agents"];
}

// Current iff the on-disk baseline equals the GENERATED expectation for the
// recorded selection (lane C2, #352) — no longer a comparison against the
// snapshot copy. A selection-mismatched or drifted baseline reports needs-apply.
async function startupBaselineCurrent(root, selection) {
  try {
    const current = JSON.parse(await readFile(safeJoin(root, ".agent/startup-baseline.json"), "utf8"));
    const expected = await loadStartupBaseline(selection);
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
  if (current === snapshotBody) return true;
  // #306: the contract is only current when BOTH the start map and the managed
  // delivery-workflow block are present and in sync with the snapshot.
  return (
    hasCurrentManagedBlock(current, AGENTS_MANAGED_BLOCK_ID, managedAgentsBody(snapshotBody)) &&
    hasCurrentManagedBlock(current, DELIVERY_WORKFLOW_BLOCK_ID, extractDeliveryWorkflowBody(snapshotBody))
  );
}

export async function check(ctx) {
  try {
    const current = await readFile(safeJoin(ctx.targetPath, "AGENTS.md"), "utf8");
    const snapshotBody = await readAgentsSnapshot(selectionFrom(ctx));
    const updateLogDone = await fileExists(ctx.targetPath, "docs/repo-update-log.md");
    const startupDone = await startupBaselineCurrent(ctx.targetPath, selectionFrom(ctx));
    const plansReadme = await readFile(PLANS_README_SNAPSHOT, "utf8");
    const plansReadmeDone = await fileMatchesMarkdownSnapshot(ctx.targetPath, "docs/plans/README.md", plansReadme);
    const messageProtocol = await readFile(MESSAGE_PROTOCOL_SNAPSHOT, "utf8");
    const messageProtocolDone = await fileMatchesMarkdownSnapshot(
      ctx.targetPath,
      "docs/agent-process/message-protocol.md",
      messageProtocol
    );
    return agentsContractCurrent(current, snapshotBody) && updateLogDone && startupDone && plansReadmeDone && messageProtocolDone
      ? "already-done"
      : "needs-apply";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await readAgentsSnapshot(selectionFrom(ctx));
  const updateLog = await readFile(UPDATE_LOG_SNAPSHOT, "utf8");
  // Generated per the recorded selection instead of copied from the snapshot
  // (lane C2, #352) — the shipped repo-local checker then demands exactly what
  // this selection installs.
  const startupBaseline = serializeStartupBaseline(await loadStartupBaseline(selectionFrom(ctx)));
  const plansReadme = await snapshotBodyPreservingFrontmatter(
    ctx.targetPath,
    "docs/plans/README.md",
    await readFile(PLANS_README_SNAPSHOT, "utf8")
  );
  const messageProtocol = await snapshotBodyPreservingFrontmatter(
    ctx.targetPath,
    "docs/agent-process/message-protocol.md",
    await readFile(MESSAGE_PROTOCOL_SNAPSHOT, "utf8")
  );

  let agentsResult;
  const agentsPath = safeJoin(ctx.targetPath, "AGENTS.md");
  try {
    const current = await readFile(agentsPath, "utf8");
    if (current === body) {
      agentsResult = { status: "unchanged", path: agentsPath };
    } else {
      const startMap = reconcileManagedBlockNearTop(
        stripLegacyManagedBlocks(current),
        AGENTS_MANAGED_BLOCK_ID,
        managedAgentsBody(body)
      );
      // #306: also reconcile the delivery-workflow contract. A fresh repo gets it
      // inline from the snapshot body; an existing repo on the reconcile path
      // would otherwise never receive it (the lifeloot gap).
      const delivery = reconcileManagedBlock(
        startMap.body,
        DELIVERY_WORKFLOW_BLOCK_ID,
        extractDeliveryWorkflowBody(body)
      );
      if (startMap.changed || delivery.changed) {
        await writeFile(agentsPath, delivery.body, "utf8");
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
  const messageProtocolResult = await safeWriteFile(
    ctx.targetPath,
    "docs/agent-process/message-protocol.md",
    messageProtocol,
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
    source: "generated:startup-baseline (selection-derived, lane C2)",
  });
  recordCreatedOnly(ctx, plansReadmeResult, {
    path: "docs/plans/README.md",
    source: "snapshot:repo-template/docs/plans/README.md",
  });
  recordCreatedOnly(ctx, messageProtocolResult, {
    path: "docs/agent-process/message-protocol.md",
    source: "snapshot:repo-template/docs/agent-process/message-protocol.md",
  });
  return [agentsResult, updateLogResult, startupBaselineResult, plansReadmeResult, messageProtocolResult];
}

export async function verify(ctx) {
  try {
    const current = await readFile(safeJoin(ctx.targetPath, "AGENTS.md"), "utf8");
    const snapshotBody = await readAgentsSnapshot(selectionFrom(ctx));
    if (!agentsContractCurrent(current, snapshotBody)) {
      return { ok: false, error: "AGENTS.md is missing the ArchonVII startup map" };
    }
    await access(safeJoin(ctx.targetPath, "docs/repo-update-log.md"), constants.F_OK);
    if (!(await startupBaselineCurrent(ctx.targetPath, selectionFrom(ctx)))) {
      return { ok: false, error: ".agent/startup-baseline.json is missing or stale" };
    }
    const plansReadme = await readFile(PLANS_README_SNAPSHOT, "utf8");
    if (!(await fileMatchesMarkdownSnapshot(ctx.targetPath, "docs/plans/README.md", plansReadme))) {
      return { ok: false, error: "docs/plans/README.md is missing or stale" };
    }
    const messageProtocol = await readFile(MESSAGE_PROTOCOL_SNAPSHOT, "utf8");
    if (!(await fileMatchesMarkdownSnapshot(ctx.targetPath, "docs/agent-process/message-protocol.md", messageProtocol))) {
      return { ok: false, error: "docs/agent-process/message-protocol.md is missing or stale" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/AGENTS.md, ${ctx.targetPath}/docs/repo-update-log.md, ${ctx.targetPath}/.agent/startup-baseline.json, ${ctx.targetPath}/docs/plans/README.md, and ${ctx.targetPath}/docs/agent-process/message-protocol.md to retry.`;
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
