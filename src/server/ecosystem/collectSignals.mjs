// src/server/ecosystem/collectSignals.mjs
import { readFile } from "node:fs/promises";

// NOTE: `join` from "node:path" is omitted — it is unused in this file.
// The spec imports it for the aggregator's use later; if a follow-on task
// re-exports or re-uses it here, add it back then.

// Counts "- " bullet items; treats file order as chronological (append-only logs),
// so the most recent items are the last lines.
export function parseSignalList(md, recentN) {
  const items = (md || "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- "));
  return { count: items.length, recent: items.slice(-recentN).reverse() };
}

export async function collectSignals(anomaliesPath, noticedPaths = [], { recentN = 5 } = {}) {
  const read = async (p) => {
    try { return await readFile(p, "utf8"); } catch { return ""; }
  };
  const anomalies = parseSignalList(await read(anomaliesPath), recentN);
  let noticedCount = 0;
  const noticedRecent = [];
  for (const p of noticedPaths) {
    const r = parseSignalList(await read(p), recentN);
    noticedCount += r.count;
    noticedRecent.push(...r.recent);
  }
  return {
    id: "signals",
    status: anomalies.count > 0 ? "yellow" : "green",
    detail: `${anomalies.count} anomalies, ${noticedCount} noticed`,
    anomalies: anomalies.count,
    noticed: noticedCount,
    recent: [...anomalies.recent, ...noticedRecent].slice(0, recentN),
  };
}
