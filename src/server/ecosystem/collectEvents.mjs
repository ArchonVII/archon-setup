// src/server/ecosystem/collectEvents.mjs
import { readFile } from "node:fs/promises";

// Parse an `.archon/events.jsonl` body into its events (one JSON object per
// line, schema { ts, type, actor, ref, detail }). Append-only, so file order
// is chronological. Blank lines, malformed JSON, and objects without a `type`
// are skipped — the stream is best-effort and must survive partial writes.
export function parseEventLog(jsonl) {
  const lines = (jsonl || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev && typeof ev === "object" && ev.type) events.push(ev);
    } catch {
      /* skip malformed line */
    }
  }
  return { count: events.length, events };
}

// Collect events across every repo's `.archon/events.jsonl`, returning the
// most-recent-N globally (sorted by `ts` descending). Events are informational,
// so the section is always green. Missing/unreadable files contribute nothing.
export async function collectEvents(eventsJsonlPaths = [], { recentN = 5 } = {}) {
  const read = async (p) => {
    try {
      return await readFile(p, "utf8");
    } catch {
      return "";
    }
  };

  const all = [];
  for (const p of eventsJsonlPaths) {
    const { events } = parseEventLog(await read(p));
    all.push(...events);
  }
  const recent = [...all]
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
    .slice(0, recentN);

  return {
    id: "events",
    status: "green",
    detail: `${all.length} events`,
    count: all.length,
    recent,
  };
}
