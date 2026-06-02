import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { safeJoin } from "../lib/paths.mjs";
import { REPO_TEMPLATE_SNAPSHOT } from "../tasks/repoTemplateSnapshot.mjs";
import { template as readmeTemplate } from "../tasks/writeReadme.mjs";
import { TEMPLATE as CLAUDE_TEMPLATE } from "../tasks/writeClaudeMd.mjs";
import { TEMPLATE as GEMINI_TEMPLATE } from "../tasks/writeGeminiMd.mjs";
import { scrubHookBody } from "../tasks/writeGithooks.mjs";
import { AGENT_SCRIPTS } from "../tasks/writeAgentLifecycle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GITHUB_WORKFLOWS_SNAPSHOT = join(__dirname, "..", "..", "snapshots", "github-workflows");

async function repoTemplateBody(snapshotPath, transform = (body) => body) {
  return transform(await readFile(join(REPO_TEMPLATE_SNAPSHOT, snapshotPath), "utf8"));
}

async function workflowBody(unit) {
  const name = unit?.options?.workflowName;
  if (!name) return null;
  if (unit.options?.snapshotSource === "repo-template") {
    return repoTemplateBody(join(".github", "workflows", `${name}.yml`));
  }
  return readFile(join(GITHUB_WORKFLOWS_SNAPSHOT, `${name}.yml`), "utf8");
}

async function expectedBodyFor({ path, unit, context }) {
  switch (unit?.taskId) {
    case "writeReadme":
      return readmeTemplate({ repo: context.repo, owner: context.owner });
    case "writeAgentsMd":
      if (path === "AGENTS.md") {
        const mode = unit.options?.changelogMode || "Mode 1: direct edit";
        const body = await repoTemplateBody("AGENTS.md");
        return body.replace(
          /<Mode 1: direct edit \/ Mode 2: `\.changelog\/unreleased\/` fragments>/,
          mode === "fragments" ? "Mode 2: `.changelog/unreleased/` fragments" : "Mode 1: direct edit"
        );
      }
      if (path === "docs/repo-update-log.md") {
        return repoTemplateBody(join("docs", "repo-update-log.md"));
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
      // The 4 agent scripts compare exact against the snapshot; package.json is
      // a merge, so it gets the "entries" comparison (the 3 agent:* scripts).
      if (path === "package.json") return { comparison: "entries", entries: AGENT_SCRIPTS };
      return repoTemplateBody(path);
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
    const matches = actual === expected;
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
  };
}
