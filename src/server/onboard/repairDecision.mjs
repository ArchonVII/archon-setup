import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { runOnboard } from "./headlessOnboard.mjs";

const VERSION = 1;
const KIND = "onboarding-decision";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

async function git(targetPath, args, runCommand) {
  const result = await runCommand("git", ["-C", targetPath, ...args]);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
  }
  return result.stdout.trim();
}

function optionsFor(status) {
  if (status === "missing") return ["apply-central", "defer", "blocked"];
  if (status === "drifted") return ["keep-local", "merge-manual", "defer", "blocked"];
  return [];
}

function decisionItems(audit) {
  return audit.items
    .filter((item) => item.status === "missing" || item.status === "drifted")
    .map((item) => ({
      itemId: `${item.feature}:${item.path}`,
      feature: item.feature,
      path: item.path,
      status: item.status,
      options: optionsFor(item.status),
    }));
}

function basisFor({ targetPath, defaultBranch, baseSha, selectedFeatures, items, owner, repo }) {
  return {
    target: { name: basename(targetPath), defaultBranch, owner, repo },
    baseSha,
    selectedFeatures,
    items,
  };
}

async function currentDecisionBasis({ targetPath, features, defaultBranch, owner = "", repo = "", runCommand }) {
  const absoluteTarget = resolve(targetPath);
  const baseSha = await git(absoluteTarget, ["rev-parse", "HEAD"], runCommand);
  const branch = defaultBranch || (await git(absoluteTarget, ["branch", "--show-current"], runCommand));
  if (!branch) throw new Error("could not determine target default branch; pass defaultBranch explicitly");
  const result = await runOnboard({ targetPath: absoluteTarget, features, owner, repo, audit: true });
  const items = decisionItems(result.audit);
  return {
    targetPath: absoluteTarget,
    baseSha,
    defaultBranch: branch,
    owner,
    repo,
    selectedFeatures: result.plan.selectedFeatureIds,
    items,
  };
}

function rejection(code, detail) {
  return { ok: false, code, detail };
}

function sameItem(actual, expected) {
  return (
    actual.itemId === expected.itemId &&
    actual.feature === expected.feature &&
    actual.path === expected.path &&
    actual.status === expected.status &&
    JSON.stringify(actual.options) === JSON.stringify(expected.options)
  );
}

export async function buildOnboardingDecision({
  targetPath,
  features = null,
  defaultBranch = "",
  owner = "",
  repo = "",
  runId = `onboard-${Date.now().toString(36)}`,
  now = new Date().toISOString(),
  runCommand = defaultRunCommand,
} = {}) {
  if (!targetPath) throw new Error("targetPath is required");
  const current = await currentDecisionBasis({ targetPath, features, defaultBranch, owner, repo, runCommand });
  const basis = basisFor(current);
  return {
    schemaVersion: VERSION,
    kind: KIND,
    runId,
    createdAt: now,
    target: basis.target,
    baseSha: current.baseSha,
    selectedFeatures: current.selectedFeatures,
    basisFingerprint: sha256(basis),
    items: current.items.map((item) => ({
      ...item,
      resolution: { choice: null, decidedBy: null, decidedAt: null },
    })),
  };
}

export async function intakeOnboardingDecision({ input, targetPath, runCommand = defaultRunCommand } = {}) {
  let doc = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (error) {
      return rejection("parse-failed", error.message);
    }
  }
  if (!doc || typeof doc !== "object" || doc.schemaVersion !== VERSION || doc.kind !== KIND) {
    return rejection("schema-invalid", "expected onboarding decision document version 1");
  }
  if (!targetPath || !Array.isArray(doc.selectedFeatures) || !Array.isArray(doc.items)) {
    return rejection("schema-invalid", "targetPath, selectedFeatures, and items are required");
  }

  let current;
  try {
    current = await currentDecisionBasis({
      targetPath,
      features: doc.selectedFeatures,
      defaultBranch: doc.target?.defaultBranch || "",
      owner: doc.target?.owner || "",
      repo: doc.target?.repo || "",
      runCommand,
    });
  } catch (error) {
    return rejection("target-unavailable", error.message);
  }
  if (doc.baseSha !== current.baseSha) {
    return rejection("stale-base", `decision base ${doc.baseSha} does not match current ${current.baseSha}`);
  }
  if (doc.target?.name !== basename(current.targetPath)) {
    return rejection("repo-mismatch", `decision is for ${doc.target?.name || "unknown"}, target is ${basename(current.targetPath)}`);
  }

  const currentBasis = basisFor(current);
  if (doc.basisFingerprint !== sha256(currentBasis)) {
    return rejection("stale-state", "decision findings no longer match the current onboarding audit");
  }
  const expected = new Map(current.items.map((item) => [item.itemId, item]));
  if (doc.items.length !== expected.size) {
    return rejection("stale-state", "decision item set does not match the current onboarding audit");
  }

  const applyFeatures = new Set();
  const applyPaths = [];
  const manual = [];
  for (const item of doc.items) {
    const fresh = expected.get(item.itemId);
    if (!fresh || !sameItem(item, fresh)) {
      return rejection("stale-state", `${item.itemId || "unknown"}: decision item does not match the current audit`);
    }
    const choice = item.resolution?.choice;
    if (!choice) return rejection("unresolved-decision", `${item.itemId}: choice is required`);
    if (!fresh.options.includes(choice)) return rejection("invalid-resolution", `${item.itemId}: ${choice} is not allowed`);
    if (choice === "apply-central") {
      applyFeatures.add(item.feature);
      applyPaths.push(fresh.path);
    } else {
      // Carry the path so the repair runner can restore decision-overridden
      // files after the feature-level apply (#362): apply-central is the only
      // decision that may ship tool-written content.
      manual.push({ itemId: item.itemId, choice, path: fresh.path });
    }
  }

  return {
    ok: true,
    runId: doc.runId,
    baseSha: doc.baseSha,
    defaultBranch: doc.target.defaultBranch,
    owner: doc.target.owner,
    repo: doc.target.repo,
    selectedFeatures: doc.selectedFeatures,
    applyFeatures: [...applyFeatures],
    applyPaths,
    manual,
  };
}
