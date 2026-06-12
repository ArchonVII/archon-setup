import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { globalUpdatesCatalogEntries, ONBOARDING_MANAGED_IDS } from "../distributor/catalogSource.mjs";
import { distributeRepo } from "../distributor/distribute.mjs";
import { collectRepos } from "./ecosystem/collectRepos.mjs";

const BROWSER_BACKEND_UPDATE_ID = "2026-05-31-browser-backend-preflight";
const STRICT_PR_READY_UPDATE_ID = "2026-05-31-strict-pr-ready-contract";
const OWNER_DOCS_SAFE_PATHS_UPDATE_ID = "2026-06-05-owner-docs-safe-paths";
const STARTUP_BASELINE_UPDATE_ID = "2026-06-09-agent-startup-baseline";
const PLAN_STATUS_CLOSEOUT_UPDATE_ID = "2026-06-10-plan-status-closeout";

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
        "- Before ready-for-review, run the blessed wrapper so malformed PRs cannot trigger paid or expensive checks:",
        "",
        "  ```powershell",
        "  npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>",
        "  npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>",
        "  ```",
        "",
        "- If the npm wrapper scripts are missing, add the repo's portable wrapper setup first. Do not substitute direct `gh pr ready` or machine-local command paths.",
        "- Non-doc PR bodies must use this exact section order: `## Summary`, `## Verification`, `### Verification Notes`, `## Docs / Changelog`, plus an issue link (`Closes #N`, `Fixes #N`, or `Refs #N`).",
        "- The PR title must use Conventional Commits. The branch must match the repo branch pattern.",
        "- Remove placeholder text such as TODO, TBD, N/A, and unset issue markers before promotion.",
        "- Check a verification box only after the command, CI check, or manual smoke test actually passed and is recorded in Verification Notes.",
      ].join("\n"),
    },
  },
  {
    id: OWNER_DOCS_SAFE_PATHS_UPDATE_ID,
    date: "2026-06-05",
    status: "ready",
    title: "Owner Maintenance Lane docs safe paths",
    summary:
      "Records that add-only docs folders are owner-maintenance safe by default, while explicit unsafe paths still require normal PR lanes.",
    source: [
      "ArchonVII/repo-template .githooks/scripts/owner-maintenance.sh",
      "ArchonVII/repo-template AGENTS.md",
      "ArchonVII/repo-template PR #47",
      "ArchonVII/archon-setup issue #100",
    ],
    agentInstruction:
      "Agents must check repo-local owner-maintenance predicates before stopping on protected main, and must not broaden explicit unsafe paths by inference.",
    confirmationPhrase: `DISTRIBUTE ${OWNER_DOCS_SAFE_PATHS_UPDATE_ID}`,
    distribution: {
      kind: "agents-managed-block",
      targetPath: "AGENTS.md",
      protectedBranches: ["main", "master"],
      heading: "Owner Maintenance Docs Safe Paths",
      body: [
        "## Owner Maintenance Docs Safe Paths",
        "",
        "- In repos with the ArchonVII Owner Maintenance Lane, add-only `docs/**` files are safe by default for owner-maintenance commits.",
        "- Explicit unsafe paths still win. Protected policy/architecture/process docs, code, config, modifications, deletes, renames, copies, and unclear files require the normal issue -> branch -> worktree -> PR lifecycle.",
        "- Prefer the repo-owned predicate, usually `.githooks/scripts/owner-maintenance.sh`, over retyping path globs.",
        "- Use the repo-prescribed direct commit format, such as `docs(owner): ...` or `chore(owner): ...`, and stage only exact safe files.",
      ].join("\n"),
    },
  },
  {
    id: STARTUP_BASELINE_UPDATE_ID,
    date: "2026-06-09",
    status: "ready",
    title: "Agent startup baseline map",
    summary:
      "Records the first-stop map for agent plans and process files so agents use the repo baseline before searching for known paths.",
    source: [
      "ArchonVII/repo-template AGENTS.md",
      "ArchonVII/repo-template .agent/startup-baseline.json",
      "ArchonVII/repo-template scripts/agent/status.mjs",
      "ArchonVII/repo-template docs/plans/README.md",
      "ArchonVII/archon-setup issue #130",
    ],
    agentInstruction:
      "Agents must use repo-local AGENTS.md and agent:status startup maps before searching for process paths; if baseline files are missing, run the full archon-setup onboard audit.",
    confirmationPhrase: `DISTRIBUTE ${STARTUP_BASELINE_UPDATE_ID}`,
    distribution: {
      kind: "agents-managed-block",
      targetPath: "AGENTS.md",
      protectedBranches: ["main", "master"],
      heading: "Agent Startup Baseline",
      body: [
        "## Agent Startup Baseline",
        "",
        "- Start with the repo-local `AGENTS.md` and `npm run agent:status` before searching for process paths.",
        "- Canonical startup files and directories:",
        "  - `AGENTS.md`",
        "  - `.agent/startup-baseline.json`",
        "  - `.agent/check-map.yml`",
        "  - `.agent/coordination/README.md`",
        "  - `docs/plans/README.md`",
        "  - `package.json` (`agent:status`, `agent:prune`, `agent:start-task`)",
        "  - `docs/plans/`",
        "  - `docs/agent-process/`",
        "  - `docs/repo-update-log.md`",
        "  - `.github/PULL_REQUEST_TEMPLATE.md`",
        "  - `scripts/agent/`",
        "  - `scripts/doc-sweep/`",
        "  - `docs/agent-process/doc-sweep.md`",
        "- Startup readiness audits the concrete managed files under `scripts/agent/` and `scripts/doc-sweep/`; a directory existing by itself is not enough.",
        "- Active implementation plans belong in `docs/plans/YYYY-MM-DD-<slug>.md`; `docs/superpowers/plans/` is legacy/history only unless repo-local guidance says otherwise.",
        "- If startup files are missing, stale, misplaced, or unclear, stop searching and run the full startup/process audit:",
        "",
        "  ```powershell",
        "  node C:/GitHub/archon-setup/bin/onboard.mjs <repo> --audit",
        "  ```",
        "",
        "- `archon-setup update` is workflow-only; it does not prove the startup/process baseline is present.",
        "- Treat missing or stale startup readiness as a warning-level repair item, not a CI blocker, unless repo-local policy adds a strict mode.",
      ].join("\n"),
    },
  },
  {
    id: PLAN_STATUS_CLOSEOUT_UPDATE_ID,
    date: "2026-06-10",
    status: "ready",
    title: "Plan/status artifact closeout",
    summary:
      "Records that delivery is incomplete while lane-created or lane-used plan, progress, handoff, audit, roadmap, status, or coordination artifacts still read as active execution guidance.",
    source: [
      "ArchonVII/jma-skill-review PR #139",
      "ArchonVII/repo-template PR #63",
      "ArchonVII/archon-setup issue #182",
    ],
    agentInstruction:
      "Agents must close, narrow, or supersede plan/status artifacts they created or used before PR ready/merge.",
    confirmationPhrase: `DISTRIBUTE ${PLAN_STATUS_CLOSEOUT_UPDATE_ID}`,
    distribution: {
      kind: "agents-managed-block",
      targetPath: "AGENTS.md",
      protectedBranches: ["main", "master"],
      heading: "Plan/Status Artifact Closeout",
      body: [
        "## Plan/Status Artifact Closeout",
        "",
        "- Delivery is incomplete while any plan, task file, progress file, findings file, handoff, audit, roadmap/status tracker, or coordination note created or used by the lane still reads as active execution guidance.",
        "- Before PR ready/merge, close it, narrow it to remaining scoped work, or mark it deprecated/superseded with the current source of truth.",
        "- Repo-facing artifacts follow the same branch/PR path as code, config, behavior, and protected docs. Do the closeout in the same branch/PR when the artifact lives in the repo.",
        "- PR bodies should state the closeout result: closed, narrowed, deprecated/superseded, or not applicable because no plan/status artifact was created or used.",
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

// Maps a delegated distributor file result onto the legacy per-repo result
// vocabulary (applied/skipped/failed/unchanged/would-apply) so existing
// consumers and golden tests see the same shapes. The one new outcome is
// "failed"/"managed-region-conflict": a malformed or catalog-orphaned block
// now surfaces instead of being silently bypassed (DL5).
function mapDelegatedFile(file, record, dryRun) {
  const path = record.distribution.targetPath;
  if (!file || (file.status === "skip" && file.reason === "not-applicable")) {
    return { status: "skipped", reason: "missing-agents" };
  }
  if (file.status === "failed") {
    const mapped = { status: "failed", reason: file.reason, path };
    if (file.error) mapped.error = file.error;
    return mapped;
  }
  if (file.status === "conflict" || file.status === "adoption_needed") {
    return { status: "failed", reason: "managed-region-conflict", path };
  }
  if (!file.changed) return { status: "unchanged", reason: "already-present", path };
  if (dryRun) return { status: "would-apply", reason: "updated", path };
  if (file.written) return { status: "applied", reason: "updated", path };
  return { status: "failed", reason: "write-failed", path };
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
  // undefined → effective registry (seed + user overlay, #214); explicit path → that file only.
  repoRegistryPath = undefined,
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

  const targetRepos = repos ?? (await collectRepos({ githubRoot, repoRegistryPath })).repos;
  const protectedBranches = new Set(record.distribution.protectedBranches || ["main", "master"]);
  const results = [];

  // Delegation (#145 PR2): the shared distributor reconciles the managed
  // region. The full globalUpdates catalog feeds knownIds so blocks from OTHER
  // updates stay untouched and unflagged (A1/A8); only this record's entry is
  // selected for action. adoptAnchored preserves the legacy append-on-missing
  // behavior byte for byte.
  const catalogEntries = globalUpdatesCatalogEntries(GLOBAL_UPDATES);
  const catalog = {
    entries: catalogEntries.filter((entry) => entry.id === record.id),
    // A8: onboarding-owned MANAGED BLOCKs (agents-start-map etc.) live in real
    // consumer AGENTS.md files; they must be known so delegation never
    // reclassifies them as unknown -> conflict.
    knownIds: new Set([...catalogEntries.map((entry) => entry.id), ...ONBOARDING_MANAGED_IDS]),
  };

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

    const delegated = await distributeRepo({
      repo,
      catalog,
      mode: dryRun ? "dry-run" : "apply",
      adoptAnchored: true,
    });
    if (delegated.status === "skipped") {
      results.push({ ...base, status: "skipped", reason: delegated.reason });
      continue;
    }
    results.push({ ...base, ...mapDelegatedFile(delegated.files[0], record, dryRun) });
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
