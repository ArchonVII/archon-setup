import { runPreflight, deriveCapabilities } from "./preflight/index.mjs";
import { loadRegistry, buildPlan } from "./planner/buildPlan.mjs";
import { executePlan } from "./executor/executePlan.mjs";
import { auditPlan } from "./onboard/auditPlan.mjs";
import { pickFolder } from "./lib/pickFolder.mjs";
import { buildSnapshot } from "./ecosystem/snapshot.mjs";
import { redactDeep } from "./ecosystem/redact.mjs";
import { DEFAULT_REPO_REGISTRY_PATH } from "./ecosystem/repoRegistry.mjs";
import { distributeGlobalUpdate, listGlobalUpdates } from "./globalUpdates.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_MANIFEST = join(__dirname, "..", "snapshots", "manifest.json");

// Static read-only methods (GET) and state-changing methods (POST).
export const RPC = {
  // GET
  async "registry.load"() {
    return loadRegistry();
  },
  async "snapshots.manifest"() {
    return JSON.parse(await readFile(SNAPSHOT_MANIFEST, "utf8"));
  },
  // Read-only ecosystem snapshot for the dashboard screen. Defaults mirror
  // bin/ecosystem-snapshot.mjs. Redacted before returning — no raw secrets to the browser.
  async "ecosystem.snapshot"() {
    const home = homedir();
    const snap = await buildSnapshot({
      portRegistryPath: join(home, ".claude", "port-registry.json"),
      githubRoot: "C:\\GitHub",
      repoRegistryPath: DEFAULT_REPO_REGISTRY_PATH,
      amberNode: /amber/i,
      anomaliesPath: join(home, ".claude", "anomalies.md"),
    });
    return redactDeep(snap);
  },
  async "globalUpdates.list"() {
    return { updates: listGlobalUpdates() };
  },

  // POST
  async "preflight.run"({ target, targetMode }) {
    const pre = await runPreflight({ target, targetMode });
    return { ...pre, capabilities: deriveCapabilities(pre) };
  },
  async "plan.build"({ selection, options, context }) {
    return buildPlan({ selection, options, context });
  },
  async "plan.audit"({ plan }) {
    return auditPlan(plan);
  },
  async "plan.execute"({ plan }, { onEvent }) {
    return executePlan(plan, { onEvent });
  },
  async "folder.pick"(_params, { pickFolderOptions } = {}) {
    return pickFolder(pickFolderOptions);
  },
  async "globalUpdates.distribute"({ updateId, confirmation, dryRun = true, githubRoot }) {
    const home = homedir();
    return distributeGlobalUpdate({
      updateId,
      confirmation,
      dryRun,
      githubRoot: githubRoot || "C:\\GitHub",
      logPath: join(home, ".codex", "archon-setup", "global-update-runs.jsonl"),
    });
  },
};

export const STATE_CHANGING = new Set([
  "preflight.run",
  "plan.build",
  "plan.execute",
  "folder.pick",
  "globalUpdates.distribute",
]);
