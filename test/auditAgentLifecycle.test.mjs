import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { auditPlan } from "../src/server/onboard/auditPlan.mjs";
import { AGENT_SCRIPTS } from "../src/server/tasks/writeAgentLifecycle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP = join(ROOT, "src/snapshots/repo-template");

function lifecyclePlan(targetPath) {
  return {
    context: { targetPath, owner: "ArchonVII", repo: "demo" },
    ordered: [{ featureId: "agent-lifecycle.baseline", taskId: "writeAgentLifecycle", options: {} }],
    files: [
      { path: "scripts/agent/lib.mjs", feature: "agent-lifecycle.baseline" },
      { path: "scripts/agent/pr-body.mjs", feature: "agent-lifecycle.baseline" },
      { path: "package.json", feature: "agent-lifecycle.baseline" },
    ],
  };
}

const makeTarget = () => mkdtemp(join(tmpdir(), "archon-audit-"));
const item = (res, path) => res.items.find((i) => i.path === path);

test("audit: script missing -> exact/missing; package.json -> entries/missing", async () => {
  const res = await auditPlan(lifecyclePlan(await makeTarget()));
  assert.equal(item(res, "scripts/agent/lib.mjs").status, "missing");
  assert.equal(item(res, "scripts/agent/lib.mjs").comparison, "exact");
  assert.equal(item(res, "scripts/agent/pr-body.mjs").status, "missing");
  assert.equal(item(res, "scripts/agent/pr-body.mjs").comparison, "exact");
  assert.equal(item(res, "package.json").status, "missing");
  assert.equal(item(res, "package.json").comparison, "entries");
});

test("audit: matching script + all entries present -> present", async () => {
  const target = await makeTarget();
  await mkdir(join(target, "scripts", "agent"), { recursive: true });
  await writeFile(join(target, "scripts/agent/lib.mjs"), await readFile(join(SNAP, "scripts/agent/lib.mjs"), "utf8"));
  await writeFile(
    join(target, "scripts/agent/pr-body.mjs"),
    await readFile(join(SNAP, "scripts/agent/pr-body.mjs"), "utf8")
  );
  await writeFile(join(target, "package.json"), JSON.stringify({ name: "demo", scripts: { ...AGENT_SCRIPTS } }, null, 2));

  const res = await auditPlan(lifecyclePlan(target));
  assert.equal(item(res, "scripts/agent/lib.mjs").status, "present");
  assert.equal(item(res, "scripts/agent/pr-body.mjs").status, "present");
  assert.equal(item(res, "package.json").status, "present");
  assert.equal(item(res, "package.json").comparison, "entries");
});

test("audit: a wrong entry value -> entries/drifted", async () => {
  const target = await makeTarget();
  await writeFile(
    join(target, "package.json"),
    JSON.stringify({ name: "demo", scripts: { ...AGENT_SCRIPTS, "agent:status": "node other.mjs" } }, null, 2)
  );
  const res = await auditPlan(lifecyclePlan(target));
  assert.equal(item(res, "package.json").status, "drifted");
  assert.equal(item(res, "package.json").comparison, "entries");
});

test("audit: a script that differs from the snapshot -> exact/drifted", async () => {
  const target = await makeTarget();
  await mkdir(join(target, "scripts", "agent"), { recursive: true });
  await writeFile(join(target, "scripts/agent/lib.mjs"), "// not the snapshot\n");
  const res = await auditPlan(lifecyclePlan(target));
  assert.equal(item(res, "scripts/agent/lib.mjs").status, "drifted");
  assert.equal(item(res, "scripts/agent/lib.mjs").comparison, "exact");
});
