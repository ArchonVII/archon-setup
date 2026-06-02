import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendEvent, TYPE_PLAN_START, TYPE_TASK_APPLIED, TYPE_PLAN_END } from "../src/server/lib/events.mjs";
import { executePlan } from "../src/server/executor/executePlan.mjs";

function typesIn(body) {
  return body.trim().split("\n").map((l) => JSON.parse(l).type);
}

test("appendEvent writes one JSON line with the canonical schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-events-"));

  const ok = await appendEvent(root, { type: TYPE_PLAN_START, ref: "ArchonVII/demo", detail: "3 tasks" });

  assert.equal(ok, true);
  const lines = (await readFile(join(root, ".archon", "events.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const ev = JSON.parse(lines[0]);
  assert.equal(ev.type, "plan-start");
  assert.equal(ev.actor, "archon-setup");
  assert.equal(ev.ref, "ArchonVII/demo");
  assert.equal(ev.detail, "3 tasks");
  assert.match(ev.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test("appendEvent appends (never truncates) across calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-events-"));

  await appendEvent(root, { type: TYPE_PLAN_START });
  await appendEvent(root, { type: TYPE_TASK_APPLIED, detail: "writeReadme" });
  await appendEvent(root, { type: TYPE_PLAN_END });

  const body = await readFile(join(root, ".archon", "events.jsonl"), "utf8");
  assert.deepEqual(typesIn(body), ["plan-start", "task-applied", "plan-end"]);
});

test("appendEvent never throws into the caller on a bad path", async () => {
  // Pointing the target at a regular file makes the .archon mkdir fail
  // (ENOTDIR). The emitter must swallow it and report false, not throw.
  const root = await mkdtemp(join(tmpdir(), "archon-events-"));
  const filePath = join(root, "afile");
  await writeFile(filePath, "x");

  const ok = await appendEvent(filePath, { type: TYPE_PLAN_START });

  assert.equal(ok, false);
});

test("appendEvent ignores a call with no type or no targetPath", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-events-"));
  assert.equal(await appendEvent(root, {}), false);
  assert.equal(await appendEvent("", { type: TYPE_PLAN_START }), false);
});

test("executePlan emits plan-start and plan-end to the target repo's events log", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-events-"));
  const plan = {
    ordered: [],
    selectedFeatureIds: [],
    postChecks: [],
    context: { targetPath, owner: "ArchonVII", repo: "demo", visibility: "private" },
  };

  const result = await executePlan(plan);

  assert.equal(result.ok, true);
  const body = await readFile(join(targetPath, ".archon", "events.jsonl"), "utf8");
  const types = typesIn(body);
  assert.ok(types.includes("plan-start"), `expected plan-start in ${types}`);
  assert.ok(types.includes("plan-end"), `expected plan-end in ${types}`);
});

test("executePlan emits a task-applied event for an applied task", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-events-"));
  const plan = {
    ordered: [{ taskId: "writeReadme", options: {}, featureId: "docs.readme" }],
    selectedFeatureIds: ["docs.readme"],
    postChecks: [],
    context: { targetPath, owner: "ArchonVII", repo: "demo", visibility: "private" },
  };

  const result = await executePlan(plan);

  assert.equal(result.ok, true);
  const applied = (await readFile(join(targetPath, ".archon", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "task-applied");
  assert.ok(applied.some((e) => e.detail === "writeReadme"), "expected a task-applied event for writeReadme");
});
