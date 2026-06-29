import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadRegistry, buildPlan } from "../src/server/planner/buildPlan.mjs";
import { auditPlan } from "../src/server/onboard/auditPlan.mjs";
import * as writeCoordinationClaims from "../src/server/tasks/writeCoordinationClaims.mjs";
import { detectClaimsInstalled } from "../scripts/agent/lib.mjs";

const BOARD = ".agent/coordination/board.md";
const CLAIMS_PLACEHOLDER = ".agent/coordination/claims/.gitkeep";
const CLAIMS_DIR = ".agent/coordination/claims";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "archon-coord-"));
}

function ctx(targetPath) {
  return {
    targetPath,
    owner: "ArchonVII",
    account: "ArchonVII",
    repo: "example",
    visibility: "private",
    taskOptions: {},
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
  };
}

// --- #299: active coordination is an explicit, complete onboarding path ---

test("active coordination stays an opt-in feature (no machine-global, not locked-on)", async () => {
  const { features } = await loadRegistry();
  const board = features.find((f) => f.id === "agent-workflow.coordination-board");
  assert.ok(board, "agent-workflow.coordination-board feature missing");
  // Isolation / least-invasive: active coordination must remain explicit opt-in,
  // never default-on or locked, so a repo only gets live claims when it asks.
  assert.equal(board.default, false);
  assert.ok(!board.locked, "active coordination must not be locked on");
});

test("selecting active coordination plans both the board and a claims location", async () => {
  const plan = await buildPlan({
    selection: ["agent-workflow.coordination-board"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  const paths = plan.files.map((f) => f.path);
  assert.ok(paths.includes(BOARD), "active coordination must create the board");
  assert.ok(paths.includes(CLAIMS_PLACEHOLDER), "active coordination must create a claims location");

  const tasks = plan.ordered.map((u) => u.taskId);
  assert.ok(tasks.includes("writeCoordinationBoard"), "board task must be planned");
  assert.ok(tasks.includes("writeCoordinationClaims"), "claims task must be planned");
});

test("a repo without active coordination plans no claims directory (doc-sweep stays absent → no live claims)", async () => {
  const { features } = await loadRegistry();
  const selection = features
    .filter((feature) => feature.default && !feature.remoteRequirement)
    .map((feature) => feature.id);
  assert.ok(!selection.includes("agent-workflow.coordination-board"), "board must not be a default feature");

  const plan = await buildPlan({
    selection,
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  const paths = plan.files.map((f) => f.path);
  assert.ok(!paths.some((p) => p.startsWith(CLAIMS_DIR)), "no claims dir without the active-coordination feature");
});

test("writeCoordinationClaims installs a claims location that agent:status detects as installed", async () => {
  const root = await tempRoot();
  try {
    // agent:status reads existence of .agent/coordination/claims/ (status.mjs).
    assert.equal(
      detectClaimsInstalled({ claimsFileExists: existsSync(join(root, CLAIMS_DIR)) }),
      false,
      "claims must read as not installed before apply"
    );

    const taskCtx = ctx(root);
    assert.equal(await writeCoordinationClaims.check(taskCtx), "needs-apply");
    await writeCoordinationClaims.apply(taskCtx);

    assert.ok(existsSync(join(root, CLAIMS_DIR)), "claims directory must exist after apply");
    assert.equal(
      detectClaimsInstalled({ claimsFileExists: existsSync(join(root, CLAIMS_DIR)) }),
      true,
      "agent:status must report claims installed after apply"
    );

    const verify = await writeCoordinationClaims.verify(taskCtx);
    assert.equal(verify.ok, true, verify.error);

    // Idempotent: re-running check after apply reports already-done.
    assert.equal(await writeCoordinationClaims.check(taskCtx), "already-done");
    assert.deepEqual(
      taskCtx.manifest.createdFiles,
      [{ path: CLAIMS_PLACEHOLDER, source: "generated:coordination-claims-placeholder" }],
      "apply records exactly the claims placeholder"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the claims placeholder is not a JSON claim file (doc-sweep's *.json loader ignores it)", async () => {
  const root = await tempRoot();
  try {
    await writeCoordinationClaims.apply(ctx(root));
    // doc-sweep's defaultLoadClaims only parses entries ending in .json; a
    // non-json placeholder must never be mistaken for a live claim.
    assert.ok(!CLAIMS_PLACEHOLDER.endsWith(".json"), "placeholder must not look like a claim file");
    const body = await readFile(join(root, CLAIMS_PLACEHOLDER), "utf8");
    assert.doesNotThrow(() => body, "placeholder is readable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audit reports active coordination missing when the claims location is absent", async () => {
  const root = await tempRoot();
  try {
    const plan = await buildPlan({
      selection: ["agent-workflow.coordination-board"],
      options: {},
      context: { targetPath: root, owner: "o", repo: "r", visibility: "private", capabilities: {} },
    });

    // Nothing installed yet → both board and claims report missing.
    const before = await auditPlan(plan);
    const claimsBefore = before.items.find((i) => i.path === CLAIMS_PLACEHOLDER);
    assert.ok(claimsBefore, "audit must surface the claims location as an item");
    assert.equal(claimsBefore.status, "missing");

    // Install both → audit reports the claims location present (not drifted
    // against the board snapshot).
    await mkdir(join(root, ".agent", "coordination"), { recursive: true });
    const boardSnapshot = await readFile(
      join(process.cwd(), "src", "snapshots", "repo-template", BOARD),
      "utf8"
    );
    await writeFile(join(root, BOARD), boardSnapshot, "utf8");
    await writeCoordinationClaims.apply(ctx(root));

    const after = await auditPlan(plan);
    const claimsAfter = after.items.find((i) => i.path === CLAIMS_PLACEHOLDER);
    const boardAfter = after.items.find((i) => i.path === BOARD);
    assert.equal(claimsAfter.status, "present", "claims location must read present once installed");
    assert.equal(boardAfter.status, "present", "board must not drift");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
