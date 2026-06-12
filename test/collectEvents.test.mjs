import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseEventLog, collectEvents } from "../src/server/ecosystem/collectEvents.mjs";

async function repoWithEvents(prefix, events) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, ".archon"), { recursive: true });
  await writeFile(
    join(root, ".archon", "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n"
  );
  return join(root, ".archon", "events.jsonl");
}

test("parseEventLog parses every well-formed event in file order", () => {
  const jsonl = [
    JSON.stringify({ ts: "2026-06-01T00:00:00.000Z", type: "plan-start" }),
    JSON.stringify({ ts: "2026-06-01T00:00:01.000Z", type: "plan-end" }),
  ].join("\n");

  const { count, events } = parseEventLog(jsonl);

  assert.equal(count, 2);
  assert.equal(events[0].type, "plan-start");
  assert.equal(events[1].type, "plan-end");
});

test("parseEventLog skips blank and malformed lines", () => {
  const jsonl = ["", "{not json}", JSON.stringify({ ts: "z", type: "plan-end" }), "   "].join("\n");

  const { count, events } = parseEventLog(jsonl);

  assert.equal(count, 1);
  assert.equal(events[0].type, "plan-end");
});

test("parseEventLog skips objects without a type", () => {
  const jsonl = [JSON.stringify({ ts: "z" }), JSON.stringify({ ts: "z", type: "x" })].join("\n");
  assert.equal(parseEventLog(jsonl).count, 1);
});

test("collectEvents merges repos and returns the most-recent-N by ts", async () => {
  const a = await repoWithEvents("archon-ev-a-", [{ ts: "2026-06-01T00:00:00.000Z", type: "plan-start", ref: "a" }]);
  const b = await repoWithEvents("archon-ev-b-", [{ ts: "2026-06-02T00:00:00.000Z", type: "plan-end", ref: "b" }]);

  const section = await collectEvents([a, b], { recentN: 5 });

  assert.equal(section.id, "events");
  assert.equal(section.count, 2);
  assert.equal(section.recent[0].ref, "b", "newest event first");
  assert.equal(section.recent[1].ref, "a");
});

test("collectEvents tolerates missing files and returns a green empty section", async () => {
  const section = await collectEvents([join(tmpdir(), "nope-does-not-exist", ".archon", "events.jsonl")]);

  assert.equal(section.status, "green");
  assert.equal(section.count, 0);
  assert.deepEqual(section.recent, []);
});

test("collectEvents reports per-source lastEventAt for the maintenance engine (#215)", async () => {
  const a = await repoWithEvents("archon-ev-last-a-", [
    { ts: "2026-06-01T00:00:00.000Z", type: "plan-start" },
    { ts: "2026-06-03T00:00:00.000Z", type: "plan-end" },
    { ts: "2026-06-02T00:00:00.000Z", type: "task" }, // out of order on purpose
  ]);
  const missing = join(tmpdir(), "nope-does-not-exist", ".archon", "events.jsonl");

  const section = await collectEvents([a, missing]);

  assert.equal(section.sources.length, 2);
  assert.deepEqual(section.sources[0], { path: a, count: 3, lastEventAt: "2026-06-03T00:00:00.000Z" });
  assert.deepEqual(section.sources[1], { path: missing, count: 0, lastEventAt: null });
});
