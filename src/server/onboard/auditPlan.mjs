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
import { loadStartupBaseline } from "../tasks/startupBaseline.mjs";
import { loadCheckMapBody } from "../tasks/writeCheckMap.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GITHUB_WORKFLOWS_SNAPSHOT = join(__dirname, "..", "..", "snapshots", "github-workflows");
const REPO_ROOT = join(__dirname, "..", "..", "..");

// The baseline file audits itself in addition to the manifest-derived floor, so
// a present-but-stale/selection-mismatched baseline is reported (lane C2, #352).
// It is prepended to the checked `required` set whenever foundation.agents (the
// feature that installs it) is in the selection.
const STARTUP_BASELINE_PATH = ".agent/startup-baseline.json";

const ONBOARDING_COMPLETION_ANCHORS = [
  "AGENTS.md",
  ".github/archon-setup.json",
];

const COMPLETION_DRIFT_EXCEPTIONS = new Set([
  "AGENTS.md",
  "docs/repo-update-log.md",
]);

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

async function expectedBodyFor({ path, unit, context, generatedBaseline }) {
  switch (unit?.taskId) {
    case "writeReadme":
      return readmeTemplate({ repo: context.repo, owner: context.owner });
    case "writeAgentsMd":
      if (path === "AGENTS.md") {
        // Reuse the emitter's renderer so the audit's expected body never
        // drifts from the release-class template and managed delivery block.
        return renderAgentsBody(await repoTemplateBody("AGENTS.md"));
      }
      if (path === "docs/repo-update-log.md") {
        return repoTemplateBody(join("docs", "repo-update-log.md"));
      }
      if (path === ".agent/startup-baseline.json") {
        // Generated per selection (lane C2, #352), not a snapshot copy. Compared
        // order-insensitively against the generated expectation for this plan's
        // resolved selection.
        return { comparison: "startup-baseline", baseline: generatedBaseline };
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
      // The active-coordination feature plans two files but unitForFile resolves
      // both to this (first) task; the board has a snapshot body, the claims
      // placeholder is generated (no snapshot) so it audits by existence only.
      if (path === ".agent/coordination/board.md") {
        return repoTemplateBody(join(".agent", "coordination", "board.md"));
      }
      return null;
    case "writeCoordinationClaims":
      return null;
    case "writeCheckMap":
      // #293: reuse the emitter's renderer (defaults.stack derived from the
      // vendored gate caller) so the audit's expected body never drifts from
      // what onboarding actually writes — same pattern as renderAgentsBody.
      return loadCheckMapBody();
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
  // The startup baseline this plan's resolved selection expects — generated once
  // from the capability manifest and shared by the per-file check and the
  // startup-readiness derivation so they never disagree (lane C2, #352).
  const generatedBaseline = await loadStartupBaseline(plan.selectedFeatureIds || []);
  for (const file of plan.files) {
    const unit = unitForFile(plan, file);
    const fullPath = safeJoin(plan.context.targetPath, file.path);
    const expected = await expectedBodyFor({ path: file.path, unit, context: plan.context, generatedBaseline });
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

    // "startup-baseline" comparison: the .agent/startup-baseline.json is generated
    // per selection, so it audits order-insensitively (version + sorted floor)
    // against the generated expectation rather than by exact-string snapshot match.
    if (expected && typeof expected === "object" && expected.comparison === "startup-baseline") {
      if (!exists) {
        items.push({
          path: file.path,
          feature: file.feature,
          taskId: unit?.taskId || null,
          status: "missing",
          comparison: "startup-baseline",
          detail: "file is absent",
        });
        continue;
      }
      let matches = false;
      try {
        matches = startupBaselineMatchesExpected(JSON.parse(await readFile(fullPath, "utf8")), expected.baseline);
      } catch {
        matches = false;
      }
      items.push({
        path: file.path,
        feature: file.feature,
        taskId: unit?.taskId || null,
        status: matches ? "present" : "drifted",
        comparison: "startup-baseline",
        detail: matches
          ? "matches the generated startup baseline for the selection"
          : "differs from the generated startup baseline for the selection",
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

  const startup = await startupReadiness(plan, items, generatedBaseline);
  return {
    summary: summarize(items),
    items,
    startupReadiness: startup,
    onboardingCompletion: await onboardingCompletion(plan, items, startup),
  };
}

async function onboardingCompletion(plan, items, startup) {
  const present = [];
  const missing = [];

  for (const path of ONBOARDING_COMPLETION_ANCHORS) {
    if (await pathExists(plan.context.targetPath, path)) present.push(path);
    else missing.push(path);
  }

  const manifest = await onboardingManifestStatus(plan);
  const { missingBaselineItems, driftedBaselineItems } = completionItemFailures(items, startup);
  const blockers = [
    ...missing.map((path) => `missing required onboarding anchor: ${path}`),
    ...manifest.problems,
    ...manifest.missingFeatures.map((feature) => `manifest missing selected feature: ${feature}`),
    ...missingBaselineItems.map((path) => `missing selected baseline item: ${path}`),
    ...driftedBaselineItems.map((path) => `drifted selected baseline item: ${path}`),
  ];
  if (startup?.status !== "complete") {
    blockers.push(`startup readiness is ${startup?.status || "unknown"}`);
  }

  return {
    status: blockers.length ? "incomplete" : "complete",
    requiredAnchors: ONBOARDING_COMPLETION_ANCHORS,
    present,
    missing,
    missingBaselineItems,
    driftedBaselineItems,
    manifestStatus: manifest.status,
    manifestMissingFeatures: manifest.missingFeatures,
    manifestProblems: manifest.problems,
    startupStatus: startup?.status || "unknown",
    blockers,
  };
}

async function onboardingManifestStatus(plan) {
  if (!(await pathExists(plan.context.targetPath, ".github/archon-setup.json"))) {
    return { status: "missing", missingFeatures: [], problems: [] };
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(safeJoin(plan.context.targetPath, ".github/archon-setup.json"), "utf8"));
  } catch {
    return {
      status: "invalid",
      missingFeatures: [],
      problems: ["manifest is invalid or unreadable"],
    };
  }

  const problems = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.tool !== "archon-setup") {
    problems.push("manifest is not an archon-setup manifest");
  }
  if (!Array.isArray(parsed?.selectedFeatures)) {
    problems.push("manifest selectedFeatures is missing or invalid");
  }

  const selected = new Set(Array.isArray(parsed?.selectedFeatures) ? parsed.selectedFeatures : []);
  const missingFeatures = (plan.selectedFeatureIds || []).filter((feature) => !selected.has(feature));
  return {
    status: problems.length || missingFeatures.length ? "incomplete" : "complete",
    missingFeatures,
    problems,
  };
}

function completionItemFailures(items, startup) {
  const startupPresent = new Set(startup?.present || []);
  const missingBaselineItems = [];
  const driftedBaselineItems = [];

  for (const item of items) {
    if (item.status === "missing") {
      missingBaselineItems.push(item.path);
      continue;
    }
    if (item.status === "drifted" && !completionAcceptsDrift(item.path, startupPresent)) {
      driftedBaselineItems.push(item.path);
    }
  }

  return {
    missingBaselineItems: unique(missingBaselineItems),
    driftedBaselineItems: unique(driftedBaselineItems),
  };
}

function completionAcceptsDrift(path, startupPresent) {
  return COMPLETION_DRIFT_EXCEPTIONS.has(path) && startupPresent.has(path);
}

async function startupReadiness(plan, items, baseline) {
  // The floor is now the manifest-derived baseline for the plan's resolved
  // selection (lane C2, #352) — no more full/minimal binary. `profile` is the
  // tier name (or "custom") the selection earned. The baseline file itself is
  // prepended to the checked set when foundation.agents installs it.
  const profile = plan.profile || "custom";
  const installsBaseline = (plan.selectedFeatureIds || []).includes("foundation.agents");
  const floor = Array.isArray(baseline.required) ? baseline.required : [];
  const required = installsBaseline ? unique([STARTUP_BASELINE_PATH, ...floor]) : floor;
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
    profile,
    baselineVersion: baseline.version || "unknown",
    missing: unique(missing),
    present: unique(present),
    stale: unique(stale),
    misplaced: unique(misplaced),
    legacyDetected: unique(legacyDetected),
    repairCommand: `node ${normalize(join(REPO_ROOT, "bin", "onboard.mjs")).replace(/\\/g, "/")} ${String(plan.context.targetPath).replace(/\\/g, "/")} --dry-run`,
  };
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
    case "package.json":
      return (await packageHasAgentScripts(root)) ? "present" : "stale";
    case "docs/agent-process/doc-sweep.md":
    case "docs/agent-process/doc-health.md":
      return (await markdownFileMatchesSnapshot(root, relativePath)) ? "present" : "stale";
    default:
      // Every required script under scripts/ is snapshot-backed (repo-template
      // sources), so compare its content — not just the scripts/{agent,close,
      // doc-sweep,doc-health}/ subdirs. Matching only those subdir prefixes let a
      // tampered/stale root closeout script (scripts/pr-contract.mjs,
      // scripts/agent-{close-preflight,pr-ready}.mjs — the three C2 flipped to
      // contract:"required") fall through to "present" and report startup-ready,
      // defeating the generated required contract (Codex review on #356).
      if (relativePath.startsWith("scripts/")) {
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
