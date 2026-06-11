import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeAgentLifecycle from "../src/server/tasks/writeAgentLifecycle.mjs";
import { AGENT_SCRIPTS } from "../src/server/tasks/writeAgentLifecycle.mjs";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "../src/server/tasks/repoTemplateSnapshot.mjs";

const SCRIPT_FILES = [
  "scripts/agent/lib.mjs",
  "scripts/agent/start-task.mjs",
  "scripts/agent/status.mjs",
  "scripts/agent/prune.mjs",
  "scripts/agent/pr-body.mjs",
];

async function makeTarget() {
  return mkdtemp(join(tmpdir(), "archon-lifecycle-"));
}

function makeCtx(targetPath, extra = {}) {
  return { targetPath, repo: "demo", manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] }, ...extra };
}

async function readPkg(targetPath) {
  return JSON.parse(await readFile(join(targetPath, "package.json"), "utf8"));
}

function snapshotBody(file) {
  return readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8").then(normalizeSnapshotText);
}

test("apply copies the managed agent lifecycle scripts into the target", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));
  for (const file of SCRIPT_FILES) {
    const s = await stat(join(target, file));
    assert.ok(s.isFile(), `${file} should be installed`);
  }
});

test("apply merges the agent:* entries into an existing package.json, preserving other keys", async () => {
  const target = await makeTarget();
  await writeFile(
    join(target, "package.json"),
    JSON.stringify({ name: "mine", version: "1.2.3", scripts: { build: "tsc" }, dependencies: { x: "1" } }, null, 2)
  );
  await writeAgentLifecycle.apply(makeCtx(target));
  const pkg = await readPkg(target);
  assert.equal(pkg.name, "mine", "existing name preserved");
  assert.equal(pkg.version, "1.2.3", "existing version preserved");
  assert.equal(pkg.scripts.build, "tsc", "existing script preserved");
  assert.deepEqual(pkg.dependencies, { x: "1" }, "existing deps preserved");
  for (const [k, v] of Object.entries(AGENT_SCRIPTS)) assert.equal(pkg.scripts[k], v);
});

test("apply creates a minimal package.json when none exists", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target, { repo: "fresh-repo" }));
  const pkg = await readPkg(target);
  assert.equal(pkg.name, "fresh-repo");
  assert.equal(pkg.type, "module");
  for (const [k, v] of Object.entries(AGENT_SCRIPTS)) assert.equal(pkg.scripts[k], v);
});

test("check is needs-apply before and already-done after apply", async () => {
  const target = await makeTarget();
  assert.equal(await writeAgentLifecycle.check(makeCtx(target)), "needs-apply");
  await writeAgentLifecycle.apply(makeCtx(target));
  assert.equal(await writeAgentLifecycle.check(makeCtx(target)), "already-done");
});

test("apply is idempotent — a second run leaves package.json unchanged", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));
  const first = await readFile(join(target, "package.json"), "utf8");
  await writeAgentLifecycle.apply(makeCtx(target));
  const second = await readFile(join(target, "package.json"), "utf8");
  assert.equal(second, first, "re-applying must not change package.json");
  assert.equal(await writeAgentLifecycle.check(makeCtx(target)), "already-done");
});

test("verify passes after apply and fails when an agent:* entry is missing", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));
  assert.deepEqual(await writeAgentLifecycle.verify(makeCtx(target)), { ok: true });

  const pkg = await readPkg(target);
  delete pkg.scripts["agent:status"];
  await writeFile(join(target, "package.json"), JSON.stringify(pkg, null, 2));
  const v = await writeAgentLifecycle.verify(makeCtx(target));
  assert.equal(v.ok, false);
});

test("check reports needs-apply when a managed script has drifted (not just missing)", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));
  assert.equal(await writeAgentLifecycle.check(makeCtx(target)), "already-done");
  // A present-but-drifted managed script must re-open the apply path (#95).
  await writeFile(join(target, "scripts/agent/status.mjs"), "// drifted by hand\n");
  assert.equal(await writeAgentLifecycle.check(makeCtx(target)), "needs-apply");
});

test("verify fails when a managed script has drifted from the snapshot", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));
  await writeFile(join(target, "scripts/agent/prune.mjs"), "// drifted by hand\n");
  const v = await writeAgentLifecycle.verify(makeCtx(target));
  assert.equal(v.ok, false, "drifted script must fail verification");
});

test("apply repairs a drifted managed script by overwriting it from the snapshot", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));
  const file = "scripts/agent/lib.mjs";
  await writeFile(join(target, file), "// drifted by hand\n");
  await writeAgentLifecycle.apply(makeCtx(target));
  assert.equal(
    await readFile(join(target, file), "utf8"),
    await snapshotBody(file),
    "drifted script restored to the snapshot body"
  );
  assert.equal(await writeAgentLifecycle.check(makeCtx(target)), "already-done");
});

test("AGENT_SCRIPTS exports the current lifecycle entries", () => {
  assert.deepEqual(AGENT_SCRIPTS, {
    "agent:status": "node scripts/agent/status.mjs",
    "agent:prune": "node scripts/agent/prune.mjs",
    "agent:start-task": "node scripts/agent/start-task.mjs",
    "agent:pr-body": "node scripts/agent/pr-body.mjs",
  });
});

test("apply records the installed scripts and the merged package.json in the manifest", async () => {
  const target = await makeTarget();
  const ctx = makeCtx(target);
  await writeAgentLifecycle.apply(ctx);
  const paths = ctx.manifest.createdFiles.map((f) => f.path);
  assert.ok(paths.includes("package.json"), "package.json merge recorded");
  for (const file of SCRIPT_FILES) assert.ok(paths.includes(file), `${file} recorded`);
});
