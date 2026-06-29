import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

import { safeJoin } from "../lib/paths.mjs";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "../tasks/repoTemplateSnapshot.mjs";
import { template as readmeTemplate } from "../tasks/writeReadme.mjs";
import { TEMPLATE as CLAUDE_TEMPLATE } from "../tasks/writeClaudeMd.mjs";
import { TEMPLATE as GEMINI_TEMPLATE } from "../tasks/writeGeminiMd.mjs";
import { scrubHookBody } from "../tasks/writeGithooks.mjs";
import { AGENT_SCRIPTS } from "../tasks/writeAgentLifecycle.mjs";
import { TEMPLATE_LIBRARY_FILES } from "../tasks/writeTemplateLibrary.mjs";
import { hasCurrentManagedBlock } from "../tasks/managedMarkdownBlock.mjs";
import {
  DELIVERY_WORKFLOW_BLOCK_ID,
  extractDeliveryWorkflowBody,
  renderAgentsBody,
} from "../tasks/writeAgentsMd.mjs";
import { markdownMatchesSnapshotAllowingFrontmatter } from "../tasks/markdownFrontmatter.mjs";
import { startupBaselineMatchesExpected } from "../tasks/startupBaselineContract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GITHUB_WORKFLOWS_SNAPSHOT = join(__dirname, "..", "..", "snapshots", "github-workflows");
const REPO_ROOT = join(__dirname, "..", "..", "..");

async function repoTemplateBody(snapshotPath, transform = (body) => body) {
  return transform(normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, snapshotPath), "utf8")));
}

async function workflowBody(unit) {
  const name = unit?.options?.workflowName;
  if (!name) return null;
  if (unit.options?.snapshotSource === "repo-template") {
    return repoTemplateBody(join(".github", "workflows", `${name}.yml`));
  }
  return readFile(join(GITHUB_WORKFLOWS_SNAPSHOT, `${name}.yml`), "utf8").then(normalizeSnapshotText);
}

async function expectedBodyFor({ path, unit, context }) {
  switch (unit?.taskId) {
    case "writeReadme":
      return readmeTemplate({ repo: context.repo, owner: context.owner });
    case "writeAgentsMd":
      if (path === "AGENTS.md") {
        // #291 + #306: reuse the emitter's renderer so the audit's expected body
        // never drifts from what onboarding actually writes (Mode 2 default,
        // managed delivery-workflow block).
        return renderAgentsBody(await repoTemplateBody("AGENTS.md"), unit.options?.changelogMode);
      }
      if (path === "docs/repo-update-log.md") {
        return repoTemplateBody(join("docs", "repo-update-log.md"));
      }
      if (path === "docs/repo-update-log/README.md") {
        // Per-PR fragments guide. Like the plans README it tolerates repo-local
        // YAML frontmatter in wiki-managed repos.
        return {
          comparison: "markdown-frontmatter",
          body: await repoTemplateBody(join("docs", "repo-update-log", "README.md")),
        };
      }
      if (path === ".agent/startup-baseline.json") {
        return repoTemplateBody(join(".agent", "startup-baseline.json"));
      }
      if (path === "docs/plans/README.md") {
        return {
          comparison: "markdown-frontmatter",
          body: await repoTemplateBody(join("docs", "plans", "README.md")),
        };
      }
      if (path === "docs/agent-process/document-policy.md") {
        // Document-policy charter (document-policy spec §5.1, lane 1c). Like the
        // plans README it tolerates repo-local YAML frontmatter in wiki-managed
        // repos, so it gets the markdown-frontmatter comparison.
        return {
          comparison: "markdown-frontmatter",
          body: await repoTemplateBody(join("docs", "agent-process", "document-policy.md")),
        };
      }
      return null;
    case "writeClaudeMd":
      return CLAUDE_TEMPLATE;
    case "writeGeminiMd":
      return GEMINI_TEMPLATE;
    case "writeCoordinationReadme":
      return repoTemplateBody(join(".agent", "coordination", "README.md"));
    case "writeCoordinationBoard":
      return repoTemplateBody(join(".agent", "coordination", "board.md"));
    case "writeCheckMap":
      return repoTemplateBody(join(".agent", "check-map.yml"));
    case "writeGithooks":
      return repoTemplateBody(path, scrubHookBody);
    case "writeGitattributes":
    case "writeChangelog":
    case "writeDependabot":
    case "writePrTemplate":
      return repoTemplateBody(path);
    case "writeCodeowners": {
      const owner = (context.owner || context.account || "").trim();
      return owner ? `* @${owner}\n` : null;
    }
    case "installWorkflow":
      return workflowBody(unit);
    case "writeAgentLifecycle":
      // The managed agent scripts compare exact against the snapshot; package.json is
      // a merge, so it gets the "entries" comparison (the managed agent:* scripts).
      if (path === "package.json") return { comparison: "entries", entries: AGENT_SCRIPTS };
      return repoTemplateBody(path);
    case "writeDocSweep":
      // Runner scripts are exact snapshot copies; the markdown spec may carry
      // repo-local frontmatter in wiki-managed repos.
      if (path === "docs/agent-process/doc-sweep.md") {
        return {
          comparison: "markdown-frontmatter",
          body: await repoTemplateBody(path),
        };
      }
      return repoTemplateBody(path);
    case "writeDocHealth":
      // Mirrors writeDocSweep: runner scripts are exact snapshot copies; the
      // markdown spec may carry repo-local frontmatter in wiki-managed repos.
      if (path === "docs/agent-process/doc-health.md") {
        return {
          comparison: "markdown-frontmatter",
          body: await repoTemplateBody(path),
        };
      }
      return repoTemplateBody(path);
    case "writeTemplateLibrary":
      if (TEMPLATE_LIBRARY_FILES.includes(path)) return repoTemplateBody(path);
      return null;
    default:
      return null;
  }
}

function unitForFile(plan, file) {
  return plan.ordered.find((unit) => unit.featureId === file.feature) || null;
}

function summarize(items) {
  const summary = { present: 0, missing: 0, drifted: 0, total: items.length };
  for (const item of items) summary[item.status] += 1;
  return summary;
}

export async function auditPlan(plan) {
  const items = [];
  for (const file of plan.files) {
    const unit = unitForFile(plan, file);
    const fullPath = safeJoin(plan.context.targetPath, file.path);
    const expected = await expectedBodyFor({ path: file.path, unit, context: plan.context });
    let exists = false;
    try {
      await access(fullPath, constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }

    // "entries" comparison: the file is merged (e.g. package.json), so audit the
    // specific managed keys rather than the whole body. Reports each key
    // present/missing/drifted; absent file => all missing.
    if (expected && typeof expected === "object" && expected.comparison === "entries") {
      let scripts = {};
      if (exists) {
        try {
          scripts = JSON.parse(await readFile(fullPath, "utf8")).scripts || {};
        } catch {
          scripts = {};
        }
      }
      const entries = Object.entries(expected.entries).map(([key, value]) => ({
        key,
        status: scripts[key] === value ? "present" : scripts[key] == null ? "missing" : "drifted",
      }));
      const allPresent = entries.every((e) => e.status === "present");
      const anyDrifted = entries.some((e) => e.status === "drifted");
      items.push({
        path: file.path,
        feature: file.feature,
        taskId: unit?.taskId || null,
        status: allPresent ? "present" : anyDrifted ? "drifted" : "missing",
        comparison: "entries",
        detail: entries,
      });
      continue;
    }

    if (expected && typeof expected === "object" && expected.comparison === "markdown-frontmatter") {
      if (!exists) {
        items.push({
          path: file.path,
          feature: file.feature,
          taskId: unit?.taskId || null,
          status: "missing",
          comparison: "markdown-frontmatter",
          detail: "file is absent",
        });
        continue;
      }
      const actual = await readFile(fullPath, "utf8");
      const matches = markdownMatchesSnapshotAllowingFrontmatter(normalizeSnapshotText(actual), expected.body);
      items.push({
        path: file.path,
        feature: file.feature,
        taskId: unit?.taskId || null,
        status: matches ? "present" : "drifted",
        comparison: "markdown-frontmatter",
        detail: matches
          ? "matches the ArchonVII baseline, allowing repo-local YAML frontmatter"
          : "content differs from the ArchonVII baseline",
      });
      continue;
    }

    if (!exists) {
      items.push({
        path: file.path,
        feature: file.feature,
        taskId: unit?.taskId || null,
        status: "missing",
        comparison: expected === null ? "existence" : "exact",
        detail: "file is absent",
      });
      continue;
    }

    if (expected === null) {
      items.push({
        path: file.path,
        feature: file.feature,
        taskId: unit?.taskId || null,
        status: "present",
        comparison: "existence",
        detail: "file exists; exact content comparison is not available for this item",
      });
      continue;
    }

    const actual = await readFile(fullPath, "utf8");
    const matches = normalizeSnapshotText(actual) === expected;
    items.push({
      path: file.path,
      feature: file.feature,
      taskId: unit?.taskId || null,
      status: matches ? "present" : "drifted",
      comparison: "exact",
      detail: matches ? "matches the ArchonVII baseline" : "content differs from the ArchonVII baseline",
    });
  }

  return {
    summary: summarize(items),
    items,
    startupReadiness: await startupReadiness(plan, items),
  };
}

async function startupReadiness(plan, items) {
  const baseline = await readStartupBaseline();
  const required = unique([".agent/startup-baseline.json", ...(Array.isArray(baseline.required) ? baseline.required : [])]);
  const expectedDirectories = Array.isArray(baseline.expectedDirectories) ? baseline.expectedDirectories : [];
  const legacy = Array.isArray(baseline.legacy) ? baseline.legacy : [];
  const byPath = new Map(items.map((item) => [item.path, item]));
  const present = [];
  const missing = [];
  const stale = [];
  const misplaced = [];
  const legacyDetected = [];

  for (const path of required) {
    const status = await startupRequiredPathStatus(plan.context.targetPath, path, byPath.get(path), baseline);
    if (status === "present") present.push(path);
    else if (status === "stale") stale.push(path);
    else missing.push(path);
  }

  for (const path of expectedDirectories) {
    if (await pathExists(plan.context.targetPath, path)) present.push(path);
    else missing.push(path);
  }

  for (const path of legacy) {
    if (await pathExists(plan.context.targetPath, path)) legacyDetected.push(path);
  }

  const agentsPath = "AGENTS.md";
  if (await pathExists(plan.context.targetPath, agentsPath)) {
    const body = await readFile(safeJoin(plan.context.targetPath, agentsPath), "utf8");
    if (managedBlockMisplaced(body)) misplaced.push(agentsPath);
  }

  const status = missing.length || stale.length || misplaced.length
    ? "incomplete"
    : legacyDetected.length
      ? "warning"
      : "complete";

  return {
    status,
    baselineVersion: baseline.version || "unknown",
    missing: unique(missing),
    present: unique(present),
    stale: unique(stale),
    misplaced: unique(misplaced),
    legacyDetected: unique(legacyDetected),
    repairCommand: `node ${normalize(join(REPO_ROOT, "bin", "onboard.mjs")).replace(/\\/g, "/")} ${String(plan.context.targetPath).replace(/\\/g, "/")} --dry-run`,
  };
}

async function readStartupBaseline() {
  return JSON.parse(await repoTemplateBody(join(".agent", "startup-baseline.json")));
}

async function startupRequiredPathStatus(root, relativePath, item, baseline) {
  if (item?.status === "present") return "present";
  if (!(await pathExists(root, relativePath))) return "missing";

  switch (relativePath) {
    case "AGENTS.md":
      // #306: AGENTS.md is only current when BOTH the start map and the managed
      // delivery-workflow contract are present and in sync. A missing
      // delivery-workflow block (the lifeloot gap) reports AGENTS.md as stale.
      return (await agentsHasCurrentStartMap(root)) && (await agentsHasCurrentDeliveryWorkflow(root))
        ? "present"
        : "stale";
    case ".agent/startup-baseline.json":
      return (await startupBaselineCurrent(root, baseline)) ? "present" : "stale";
    case "docs/plans/README.md":
      return (await markdownFileMatchesSnapshot(root, relativePath)) ? "present" : "stale";
    case "docs/repo-update-log.md":
      return (await fileMatches(root, relativePath, /^# Repository Update Log/m)) ? "present" : "stale";
    case "docs/repo-update-log/README.md":
      return (await markdownFileMatchesSnapshot(root, relativePath)) ? "present" : "stale";
    case "package.json":
      return (await packageHasAgentScripts(root)) ? "present" : "stale";
    case "docs/agent-process/doc-sweep.md":
    case "docs/agent-process/doc-health.md":
      return (await markdownFileMatchesSnapshot(root, relativePath)) ? "present" : "stale";
    default:
      if (
        relativePath.startsWith("scripts/agent/") ||
        relativePath.startsWith("scripts/close/") ||
        relativePath.startsWith("scripts/doc-sweep/") ||
        relativePath.startsWith("scripts/doc-health/")
      ) {
        return (await fileMatchesSnapshot(root, relativePath)) ? "present" : "stale";
      }
      return "present";
  }
}

async function agentsHasCurrentStartMap(root) {
  const body = normalizeSnapshotText(await readFile(safeJoin(root, "AGENTS.md"), "utf8"));
  const expected = extractManagedAgentStartMap(await repoTemplateBody("AGENTS.md"));
  return body.includes(expected) || hasCurrentManagedBlock(body, "agents-start-map", expected);
}

function extractManagedAgentStartMap(body) {
  const match = body.match(/<!-- BEGIN MANAGED AGENT START MAP -->[\s\S]*?<!-- END MANAGED AGENT START MAP -->/);
  if (!match) throw new Error("repo-template AGENTS.md is missing the managed agent start map");
  return match[0].trim();
}

// #306: mirror agentsHasCurrentStartMap for the managed delivery-workflow block.
// The expected body is rendered the same way the emitter renders it, so the
// audit and onboarding never disagree on what "current" means.
async function agentsHasCurrentDeliveryWorkflow(root) {
  const body = normalizeSnapshotText(await readFile(safeJoin(root, "AGENTS.md"), "utf8"));
  const expected = extractDeliveryWorkflowBody(renderAgentsBody(await repoTemplateBody("AGENTS.md")));
  return hasCurrentManagedBlock(body, DELIVERY_WORKFLOW_BLOCK_ID, expected);
}

async function startupBaselineCurrent(root, expectedBaseline) {
  try {
    const actual = JSON.parse(await readFile(safeJoin(root, ".agent/startup-baseline.json"), "utf8"));
    return startupBaselineMatchesExpected(actual, expectedBaseline);
  } catch {
    return false;
  }
}

async function fileMatches(root, relativePath, pattern) {
  const body = await readFile(safeJoin(root, relativePath), "utf8");
  return pattern.test(body);
}

async function fileMatchesSnapshot(root, relativePath) {
  const actual = await readFile(safeJoin(root, relativePath), "utf8");
  const expected = await repoTemplateBody(relativePath);
  return normalizeSnapshotText(actual) === expected;
}

async function markdownFileMatchesSnapshot(root, relativePath) {
  const actual = await readFile(safeJoin(root, relativePath), "utf8");
  const expected = await repoTemplateBody(relativePath);
  return markdownMatchesSnapshotAllowingFrontmatter(normalizeSnapshotText(actual), expected);
}

async function packageHasAgentScripts(root) {
  try {
    const pkg = JSON.parse(await readFile(safeJoin(root, "package.json"), "utf8"));
    const scripts = pkg.scripts || {};
    return Object.entries(AGENT_SCRIPTS).every(([key, value]) => scripts[key] === value);
  } catch {
    return false;
  }
}

async function pathExists(root, relativePath) {
  try {
    await access(safeJoin(root, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function managedBlockMisplaced(body) {
  const markers = [
    "BEGIN ARCHONVII MANAGED BLOCK: agents-start-map",
    "BEGIN ARCHONVII MANAGED BLOCK: agents-workflow-contract",
  ];
  const blockIndex = markers
    .map((marker) => body.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
  if (blockIndex === -1) return false;
  const firstWorkflowSection = body.search(/^##\s+/m);
  return firstWorkflowSection !== -1 && blockIndex > firstWorkflowSection;
}

function unique(values) {
  return [...new Set(values)];
}
