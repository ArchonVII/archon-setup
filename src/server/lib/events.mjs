import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

// Event types emitted by the executor (lane D, archon-setup#88). The set is
// intentionally small; the stream is "inert until events accumulate".
export const TYPE_PLAN_START = "plan-start";
export const TYPE_TASK_APPLIED = "task-applied";
export const TYPE_PLAN_END = "plan-end";

// Append one event as a JSON line to <targetPath>/.archon/events.jsonl. The
// line schema is { ts, type, actor, ref, detail } (aligned with the .archon
// anomalies convention). This is best-effort telemetry: it MUST NEVER throw
// into the task/executor flow, so every failure (bad path, permissions, full
// disk) is swallowed and reported as a falsy return. Returns true on a
// successful append, false otherwise.
export async function appendEvent(targetPath, { type, actor = "archon-setup", ref = "", detail = "" } = {}) {
  try {
    if (!targetPath || !type) return false;
    const file = join(targetPath, ".archon", "events.jsonl");
    await mkdir(dirname(file), { recursive: true });
    const line = { ts: new Date().toISOString(), type, actor, ref, detail };
    await appendFile(file, JSON.stringify(line) + "\n", "utf8");
    return true;
  } catch {
    return false; // never throw into the caller
  }
}
