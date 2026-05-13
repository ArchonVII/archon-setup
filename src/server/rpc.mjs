import { runPreflight, deriveCapabilities } from "./preflight/index.mjs";
import { loadRegistry, buildPlan } from "./planner/buildPlan.mjs";
import { executePlan } from "./executor/executePlan.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

  // POST
  async "preflight.run"({ target }) {
    const pre = await runPreflight({ target });
    return { ...pre, capabilities: deriveCapabilities(pre) };
  },
  async "plan.build"({ selection, options, context }) {
    return buildPlan({ selection, options, context });
  },
  async "plan.execute"({ plan }, { onEvent }) {
    return executePlan(plan, { onEvent });
  },
};

export const STATE_CHANGING = new Set(["preflight.run", "plan.build", "plan.execute"]);
