import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { collectRepos } from "./ecosystem/collectRepos.mjs";

const BROWSER_BACKEND_UPDATE_ID = "2026-05-31-browser-backend-preflight";
const STRICT_PR_READY_UPDATE_ID = "2026-05-31-strict-pr-ready-contract";

const GLOBAL_UPDATES = [
  {
    id: BROWSER_BACKEND_UPDATE_ID,
    date: "2026-05-31",
    status: "ready",
    title: "Browser backend preflight and fallback policy",
    summary:
      "Records that Browser plugin availability is separate from a live iab/chrome backend, and requires agents to preflight before claiming browser verification.",
    source: [
      "C:/Users/josep/.codex/AGENTS.md",
      "C:/Users/josep/.codex/BOOTSTRAP.md",
      "C:/Users/josep/skills/shared/browser-backend-check/SKILL.md",
    ],
    agentInstruction:
      "Agents must ask the user before disseminating this or any future global workflow fix across the full ecosystem.",
    confirmationPhrase: `DISTRIBUTE ${BROWSER_BACKEND_UPDATE_ID}`,
    distribution: {
      kind: "agents-managed-block",
      targetPath: "AGENTS.md",
      protectedBranches: ["main", "master"],
      heading: "Browser Backend Preflight",
      body: [
        "## Browser Backend Preflight",
        "",
        "- Browser plugin availability and live browser backend availability are separate states.",
        "- Before relying on screenshots, click-through tests, localhost inspection, or in-app browser work, run the Browser workflow/preflight and verify `agent.browsers.list()` includes the needed backend.",
        "- If `iab` or `chrome` is unavailable, say that the current session lacks a connected browser backend. Do not describe it as a repo setup, dependency, or onboarding failure unless local evidence proves that.",
        "- When Browser is unavailable, use the best verification fallback for the task: repo tests, HTTP checks, standalone Playwright when installed, or launching the repo-owned dev server and giving the exact URL for manual review. Clearly mark any browser smoke test as not run.",
        "- Before distributing any global workflow fix across ecosystem repos, ask the user for explicit confirmation and record per-repo applied/skipped/failed results.",
      ].join("\n"),
    },
  },
  {
    id: STRICT_PR_READY_UPDATE_ID,
    date: "2026-05-31",
    status: "ready",
    title: "Strict PR ready-for-review contract",
    summary:
      "Requires agents to validate PR title/body/branch/files before ready-for-review and forbids direct gh pr ready promotion.",
    source: [
      "ArchonVII/github-workflows scripts/pr-contract.mjs",
      "ArchonVII/github-workflows scripts/agent-pr-ready.mjs",
      "ArchonVII/repo-template AGENTS.md",
      "ArchonVII/.github .github/PULL_REQUEST_TEMPLATE.md",
    ],
    agentInstruction:
      "Do not rely on agents remembering PR format. Use the shared contract wrapper before ready-for-review.",
    confirmationPhrase: `DISTRIBUTE ${STRICT_PR_READY_UPDATE_ID}`,
    distribution: {
      kind: "agents-managed-block",
      targetPath: "AGENTS.md",
      protectedBranches: ["main", "master"],
      heading: "Strict PR Ready Contract",
      body: [
        "## Strict PR Ready Contract",
        "",
        "- Do not run `gh pr ready` directly.",
        "- Before ready-for-review, run the shared PR contract preflight and ready wrapper so malformed PRs cannot trigger paid or expensive checks:",
        "",
        "  ```powershell",
        "  node C:\\GitHub\\github-workflows\\scripts\\agent-close-preflight.mjs --repo OWNER/REPO --pr <number>",
        "  node C:\\GitHub\\github-workflows\\scripts\\agent-pr-ready.mjs --repo OWNER/REPO --pr <number>",
        "  ```",
        "",
        "- Non-doc PR bodies must use this exact section order: `## Summary`, `## Verification`, `### Verification Notes`, `## Docs / Changelog`, plus an issue link (`Closes #N`, `Fixes #N`, or `Refs #N`).",
        "- The PR title must use Conventional Commits. The branch must match the repo branch pattern.",
        "- Remove placeholder text such as TODO, TBD, N/A, and unset issue markers before promotion.",
        "- Check a verification box only after the command, CI check, or manual smoke test actually passed and is recorded in Verification Notes.",
      ].join("\n"),
    },
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function listGlobalUpdates() {
  return clone(GLOBAL_UPDATES);
}

export function getGlobalUpdate(updateId) {
  const record = GLOBAL_UPDATES.find((entry) => entry.id === updateId);
  if (!record) throw new Error(`unknown global update: ${updateId}`);
  return clone(record);
}

function managedBlock(record) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
    record.distribution.body,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
    "",
  ].join("\n");
}

export function applyGlobalUpdateToAgents(current, record) {
  if (record.distribution?.kind !== "agents-managed-block") {
    throw new Error(`unsupported global update distribution kind: ${record.distribution?.kind || "unknown"}`);
  }

  const block = managedBlock(record);
  const start = `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${record.id} -->`;
  const end = `<!-- END ARCHONVII GLOBAL UPDATE: ${record.id} -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\r?\\n?`);

  if (pattern.test(current)) {
    return current.replace(pattern, block);
  }

  const prefix = current.endsWith("\n") ? current : `${current}\n`;
  return `${prefix}\n${block}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readAgents(path) {
  try {
    return { ok: true, body: await readFile(path, "utf8") };
  } catch (err) {
    if (err.code === "ENOENT") return { ok: false, missing: true };
    return { ok: false, error: err.message };
  }
}

function summarize(results) {
  return {
    updated: results.filter((entry) => entry.status === "applied").length,
    skipped: results.filter((entry) => entry.status === "skipped").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    unchanged: results.filter((entry) => entry.status === "unchanged").length,
    wouldApply: results.filter((entry) => entry.status === "would-apply").length,
  };
}

async function writeRunLog(logPath, entry) {
  if (!logPath) return;
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function distributeGlobalUpdate({
  updateId,
  confirmation,
  dryRun = true,
  githubRoot = "C:\\GitHub",
  repos,
  now = new Date().toISOString(),
  logPath,
} = {}) {
  const record = getGlobalUpdate(updateId);
  if (confirmation !== record.confirmationPhrase) {
    return {
      ok: false,
      status: "confirmation-required",
      updateId: record.id,
      confirmationPhrase: record.confirmationPhrase,
      dryRun,
      results: [],
      updated: 0,
      skipped: 0,
      failed: 0,
      unchanged: 0,
      wouldApply: 0,
    };
  }

  const targetRepos = repos ?? (await collectRepos(githubRoot)).repos;
  const protectedBranches = new Set(record.distribution.protectedBranches || ["main", "master"]);
  const results = [];

  for (const repo of targetRepos) {
    const base = {
      repo: repo.name,
      path: repo.path,
      branch: repo.branch,
      updateId: record.id,
    };

    if (!repo.path) {
      results.push({ ...base, status: "skipped", reason: "missing-path" });
      continue;
    }
    if (repo.dirty) {
      results.push({ ...base, status: "skipped", reason: "dirty-worktree" });
      continue;
    }
    if (protectedBranches.has(repo.branch)) {
      results.push({ ...base, status: "skipped", reason: "protected-main" });
      continue;
    }

    const agentsPath = join(repo.path, record.distribution.targetPath);
    const current = await readAgents(agentsPath);
    if (!current.ok) {
      results.push({
        ...base,
        status: current.missing ? "skipped" : "failed",
        reason: current.missing ? "missing-agents" : "read-failed",
        error: current.error,
      });
      continue;
    }

    const next = applyGlobalUpdateToAgents(current.body, record);
    if (next === current.body) {
      results.push({ ...base, status: "unchanged", reason: "already-present", path: record.distribution.targetPath });
      continue;
    }

    if (dryRun) {
      results.push({ ...base, status: "would-apply", reason: "updated", path: record.distribution.targetPath });
      continue;
    }

    try {
      await writeFile(agentsPath, next, "utf8");
      results.push({ ...base, status: "applied", reason: "updated", path: record.distribution.targetPath });
    } catch (err) {
      results.push({ ...base, status: "failed", reason: "write-failed", path: record.distribution.targetPath, error: err.message });
    }
  }

  const counts = summarize(results);
  const run = {
    schemaVersion: 1,
    updateId: record.id,
    generatedAt: now,
    dryRun,
    results,
    ...counts,
  };
  await writeRunLog(logPath, run);

  return {
    ok: counts.failed === 0,
    status: counts.failed === 0 ? "completed" : "completed-with-errors",
    updateId: record.id,
    dryRun,
    results,
    ...counts,
  };
}
