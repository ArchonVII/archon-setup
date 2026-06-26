import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as writeAgentLifecycle from "../src/server/tasks/writeAgentLifecycle.mjs";
import { AGENT_SCRIPTS } from "../src/server/tasks/writeAgentLifecycle.mjs";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "../src/server/tasks/repoTemplateSnapshot.mjs";

const SCRIPT_FILES = [
  "scripts/agent/lib.mjs",
  "scripts/agent/start-task.mjs",
  "scripts/agent/status.mjs",
  "scripts/agent/prune.mjs",
  "scripts/agent/pr-body.mjs",
  "scripts/pr-contract.mjs",
  "scripts/close/lib.mjs",
  "scripts/close/scan-complete.mjs",
  "scripts/close/ci-guard.mjs",
  "scripts/agent-close-preflight.mjs",
  "scripts/agent-pr-ready.mjs",
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
    "close:scan:complete": "node scripts/close/scan-complete.mjs",
    "close:ci:guard": "node scripts/close/ci-guard.mjs",
    "agent:close-preflight": "node scripts/agent-close-preflight.mjs",
    "agent:pr-ready": "node scripts/agent-pr-ready.mjs",
  });
});

// Regression for #252: the close scripts `import ../pr-contract.mjs`, so the task
// must install scripts/pr-contract.mjs. Apply into a temp dir, then have a child
// node process import the installed scripts/close/ci-guard.mjs and report whether
// the import graph resolves. A missing dependency surfaces as ERR_MODULE_NOT_FOUND
// at import-resolution time (before ci-guard's main() ever runs), which is the
// exact failure onboarded repos hit. ci-guard.mjs calls main() unconditionally, so
// its own git/gh runtime errors are expected and tolerated — only a module-
// resolution failure is the bug under test.
test("installed close scripts resolve their pr-contract.mjs dependency (no ERR_MODULE_NOT_FOUND, #252)", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));

  const ciGuard = join(target, "scripts/close/ci-guard.mjs");
  assert.ok((await stat(ciGuard)).isFile(), "ci-guard.mjs should be installed");
  assert.ok(
    (await stat(join(target, "scripts/pr-contract.mjs"))).isFile(),
    "pr-contract.mjs (the close-script dependency) should be installed",
  );

  const probe = [
    `const url = ${JSON.stringify(pathToFileURL(ciGuard).href)};`,
    "try { await import(url); }",
    "catch (err) {",
    "  if (err && err.code === 'ERR_MODULE_NOT_FOUND') {",
    "    console.error(err.message); process.exit(2);",
    "  }",
    "  // Any other error (e.g. ci-guard main() failing with no git/gh) means the",
    "  // import graph resolved, which is all this test asserts.",
    "}",
  ].join(String.fromCharCode(10));

  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: target,
    encoding: "utf8",
  });
  assert.notEqual(
    result.status,
    2,
    `installed close script failed to resolve pr-contract.mjs: ${result.stderr}`,
  );
});

// #282: AGENTS.md mandates `npm run agent:close-preflight` / `agent:pr-ready`,
// so the task must install both wrappers AND their npm entries. The wrappers
// named-import loadPrFromGh/validatePrContract/formatPrContractResult from
// scripts/pr-contract.mjs; a missing export or file surfaces as a module-
// resolution failure at import time (the wrappers call main() on import, so any
// later git/gh runtime error means the import graph already resolved).
test("installed closeout wrappers resolve and are wired as npm scripts (#282)", async () => {
  const target = await makeTarget();
  await writeAgentLifecycle.apply(makeCtx(target));

  const pkg = await readPkg(target);
  assert.equal(pkg.scripts["agent:close-preflight"], "node scripts/agent-close-preflight.mjs");
  assert.equal(pkg.scripts["agent:pr-ready"], "node scripts/agent-pr-ready.mjs");

  for (const rel of ["scripts/agent-close-preflight.mjs", "scripts/agent-pr-ready.mjs"]) {
    const full = join(target, rel);
    assert.ok((await stat(full)).isFile(), `${rel} should be installed`);
    const probe = [
      `const url = ${JSON.stringify(pathToFileURL(full).href)};`,
      "try { await import(url); }",
      "catch (err) {",
      "  if (err && err.code === 'ERR_MODULE_NOT_FOUND') { console.error(err.message); process.exit(2); }",
      "  // Any other error (e.g. main() failing with no git/gh) means the import graph resolved.",
      "}",
    ].join(String.fromCharCode(10));
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
      cwd: target,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 2, `${rel} failed to resolve its pr-contract.mjs imports: ${result.stderr}`);
  }
});

test("apply records the installed scripts and the merged package.json in the manifest", async () => {
  const target = await makeTarget();
  const ctx = makeCtx(target);
  await writeAgentLifecycle.apply(ctx);
  const paths = ctx.manifest.createdFiles.map((f) => f.path);
  assert.ok(paths.includes("package.json"), "package.json merge recorded");
  for (const file of SCRIPT_FILES) assert.ok(paths.includes(file), `${file} recorded`);
});
