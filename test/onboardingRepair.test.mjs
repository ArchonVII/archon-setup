import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOnboardingDecision,
  intakeOnboardingDecision,
} from "../src/server/onboard/repairDecision.mjs";
import { parseOnboardingDecisionIssue, serializeOnboardingDecisionIssue } from "../src/server/onboard/repairIssue.mjs";
import { loadProfileFeatures } from "../src/server/tasks/startupBaseline.mjs";

const execFileP = promisify(execFile);

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), "archon-onboarding-repair-"));
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "config", "user.email", "agent@example.test"]);
  await execFileP("git", ["-C", root, "config", "user.name", "Archon Agent"]);
  await writeFile(join(root, "seed.txt"), "seed\n", "utf8");
  await execFileP("git", ["-C", root, "add", "seed.txt"]);
  await execFileP("git", ["-C", root, "commit", "-m", "chore: seed"]);
  return root;
}

function resolveApplyCentral(doc) {
  return {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: { choice: "apply-central", decidedBy: "owner", decidedAt: "2026-07-10T00:00:00.000Z" },
    })),
  };
}

test("onboarding repair decision makes missing baseline items explicitly apply-central eligible", async () => {
  const targetPath = await fixtureRepo();

  const doc = await buildOnboardingDecision({
    targetPath,
    features: ["foundation.readme"],
    runId: "onboard-repair-1",
    now: "2026-07-10T00:00:00.000Z",
  });

  assert.equal(doc.kind, "onboarding-decision");
  assert.equal(doc.schemaVersion, 1);
  assert.deepEqual(doc.selectedFeatures, ["foundation.readme"]);
  assert.equal(doc.items.length, 1);
  assert.deepEqual(doc.items[0], {
    itemId: "foundation.readme:README.md",
    feature: "foundation.readme",
    path: "README.md",
    status: "missing",
    options: ["apply-central", "declined", "defer", "blocked"],
    resolution: { choice: null, decidedBy: null, decidedAt: null, review: null },
  });
});

test("onboarding repair intake accepts only fully resolved, current apply-central decisions", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({
    targetPath,
    features: ["foundation.readme"],
    runId: "onboard-repair-2",
    defaultBranch: "main",
    owner: "ArchonVII",
    repo: "consumer-repo",
  });

  const intake = await intakeOnboardingDecision({ input: resolveApplyCentral(doc), targetPath });

  assert.deepEqual(intake, {
    ok: true,
    runId: "onboard-repair-2",
    baseSha: doc.baseSha,
    defaultBranch: "main",
    owner: "ArchonVII",
    repo: "consumer-repo",
    selectedFeatures: ["foundation.readme"],
    effectiveSelectedFeatures: ["foundation.readme"],
    declinedFeatures: [],
    applyFeatures: ["foundation.readme"],
    applyPaths: ["README.md"],
    manual: [],
    dispositions: [
      {
        itemId: "foundation.readme:README.md",
        feature: "foundation.readme",
        path: "README.md",
        status: "missing",
        choice: "apply-central",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
      },
    ],
  });
});

test("onboarding repair intake turns declined capabilities into an effective deselection", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({
    targetPath,
    features: ["foundation.readme", "foundation.license"],
    runId: "onboard-repair-declined",
  });
  const resolved = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice: item.feature === "foundation.license" ? "declined" : "apply-central",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
        review: null,
      },
    })),
  };

  const intake = await intakeOnboardingDecision({ input: resolved, targetPath });

  assert.equal(intake.ok, true);
  assert.deepEqual(intake.declinedFeatures, ["foundation.license"]);
  assert.deepEqual(intake.effectiveSelectedFeatures, ["foundation.readme"]);
  assert.deepEqual(intake.applyFeatures, ["foundation.readme"]);
  assert.equal(intake.dispositions.find((item) => item.feature === "foundation.license")?.choice, "declined");
});

test("onboarding repair intake removes capabilities that depend on a declined capability", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({
    targetPath,
    features: ["foundation.readme", "workflow.required-gate"],
    runId: "onboard-repair-dependent-declined",
  });
  const resolved = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice: item.feature === "agent-workflow.check-map" ? "declined" : "apply-central",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
        review: null,
      },
    })),
  };

  const intake = await intakeOnboardingDecision({ input: resolved, targetPath });

  assert.equal(intake.ok, true);
  assert.deepEqual(intake.declinedFeatures, ["agent-workflow.check-map"]);
  assert.deepEqual(intake.effectiveSelectedFeatures, ["foundation.readme"]);
  assert.deepEqual(intake.applyFeatures, ["foundation.readme"]);
});

test("onboarding repair intake requires a machine-readable review condition for defer", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({
    targetPath,
    features: ["foundation.readme"],
    runId: "onboard-repair-defer",
  });
  const deferred = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice: "defer",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
        review: null,
      },
    })),
  };

  assert.deepEqual(await intakeOnboardingDecision({ input: deferred, targetPath }), {
    ok: false,
    code: "invalid-resolution",
    detail: "foundation.readme:README.md: defer requires review.trigger or review.expiresAt",
  });

  deferred.items[0].resolution.review = {
    trigger: "review when the documentation charter is installed",
    expiresAt: "2026-08-01T00:00:00.000Z",
  };
  const intake = await intakeOnboardingDecision({ input: deferred, targetPath });
  assert.equal(intake.ok, true);
  assert.deepEqual(intake.dispositions[0].review, deferred.items[0].resolution.review);
});

test("onboarding repair intake rejects an unresolved decision before any write-capable flow", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath, features: ["foundation.readme"], runId: "onboard-repair-3" });

  const intake = await intakeOnboardingDecision({ input: doc, targetPath });

  assert.deepEqual(intake, {
    ok: false,
    code: "unresolved-decision",
    detail: "foundation.readme:README.md: choice is required",
  });
});

test("onboarding repair intake rejects a decision after the target default branch moves", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath, features: ["foundation.readme"], runId: "onboard-repair-4" });
  await writeFile(join(targetPath, "later.txt"), "later\n", "utf8");
  await execFileP("git", ["-C", targetPath, "add", "later.txt"]);
  await execFileP("git", ["-C", targetPath, "commit", "-m", "chore: move"]);

  const intake = await intakeOnboardingDecision({ input: resolveApplyCentral(doc), targetPath });

  assert.equal(intake.ok, false);
  assert.equal(intake.code, "stale-base");
});

test("onboard repair CLI emits a machine-readable decision document without writing", async () => {
  const targetPath = await fixtureRepo();
  const { stdout } = await execFileP(process.execPath, [
    join(process.cwd(), "bin", "onboard.mjs"),
    "repair",
    targetPath,
    "--features",
    "foundation.readme",
    "--json",
  ]);

  const doc = JSON.parse(stdout);
  assert.equal(doc.kind, "onboarding-decision");
  assert.equal(doc.items[0].itemId, "foundation.readme:README.md");
});

test("onboard repair CLI resolves --profile before building the decision document", async () => {
  const targetPath = await fixtureRepo();
  const { stdout } = await execFileP(process.execPath, [
    join(process.cwd(), "bin", "onboard.mjs"),
    "repair",
    targetPath,
    "--profile",
    "agent-standard",
    "--json",
  ]);

  const doc = JSON.parse(stdout);
  assert.deepEqual(doc.selectedFeatures, await loadProfileFeatures("agent-standard"));
});

test("onboarding repair decision issues round-trip only the canonical decision document", async () => {
  const targetPath = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath, features: ["foundation.readme"], runId: "onboard-repair-issue" });

  const issue = serializeOnboardingDecisionIssue(doc);
  const parsed = parseOnboardingDecisionIssue(issue.body);

  assert.match(issue.title, /Decision: .* onboarding repair/);
  assert.deepEqual(parsed, { ok: true, doc });
});
