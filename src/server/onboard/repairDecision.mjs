import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { loadRegistry } from "../planner/buildPlan.mjs";
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
  if (status === "missing") return ["apply-central", "declined", "defer", "blocked"];
  if (status === "drifted") return ["keep-local", "declined", "merge-manual", "defer", "blocked"];
  return [];
}

function decisionItems(audit) {
  return audit.items
    .filter((item) =>
      (item.status === "missing" || item.status === "drifted") &&
      item.disposition?.state !== "accepted"
    )
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

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) return false;
  if (review.expiresAt !== undefined && !validTimestamp(review.expiresAt)) return false;
  if (review.triggeredAt !== undefined && !validTimestamp(review.triggeredAt)) return false;
  const hasTrigger = typeof review.trigger === "string" && review.trigger.trim().length > 0;
  const hasExpiry = validTimestamp(review.expiresAt);
  return hasTrigger || hasExpiry;
}

async function contentFingerprint(targetPath, path) {
  const body = await readFile(safeJoin(targetPath, path));
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(body).digest("hex"),
  };
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

function excludedByDeclines(features, selectedFeatures, declinedFeatures) {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const excluded = new Set(declinedFeatures);
  let changed = true;

  while (changed) {
    changed = false;
    for (const featureId of selectedFeatures) {
      if (excluded.has(featureId)) continue;
      const feature = byId.get(featureId);
      if ((feature?.requires || []).some((dependency) => excluded.has(dependency))) {
        excluded.add(featureId);
        changed = true;
      }
    }
  }

  return excluded;
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
      resolution: { choice: null, decidedBy: null, decidedAt: null, review: null },
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
  const declinedFeatures = new Set();
  const manual = [];
  const dispositions = [];
  for (const item of doc.items) {
    const fresh = expected.get(item.itemId);
    if (!fresh || !sameItem(item, fresh)) {
      return rejection("stale-state", `${item.itemId || "unknown"}: decision item does not match the current audit`);
    }
    const choice = item.resolution?.choice;
    if (!choice) return rejection("unresolved-decision", `${item.itemId}: choice is required`);
    if (!fresh.options.includes(choice)) return rejection("invalid-resolution", `${item.itemId}: ${choice} is not allowed`);
    if (typeof item.resolution?.decidedBy !== "string" || !item.resolution.decidedBy.trim()) {
      return rejection("invalid-resolution", `${item.itemId}: decidedBy is required`);
    }
    if (!validTimestamp(item.resolution?.decidedAt)) {
      return rejection("invalid-resolution", `${item.itemId}: decidedAt must be a valid timestamp`);
    }
    if (choice === "defer" && !validReview(item.resolution?.review)) {
      return rejection("invalid-resolution", `${item.itemId}: defer requires review.trigger or review.expiresAt`);
    }

    const disposition = {
      itemId: item.itemId,
      feature: item.feature,
      path: fresh.path,
      status: fresh.status,
      choice,
      decidedBy: item.resolution.decidedBy,
      decidedAt: item.resolution.decidedAt,
    };
    if (choice === "defer") disposition.review = item.resolution.review;
    if (choice === "keep-local") {
      try {
        disposition.fingerprint = await contentFingerprint(current.targetPath, fresh.path);
      } catch (error) {
        return rejection("invalid-resolution", `${item.itemId}: keep-local fingerprint failed: ${error.message}`);
      }
    }
    dispositions.push(disposition);

    if (choice === "apply-central") {
      applyFeatures.add(item.feature);
    } else {
      if (choice === "declined") declinedFeatures.add(item.feature);
      // Carry the path so the repair runner can restore decision-overridden
      // files after the feature-level apply (#362): apply-central is the only
      // decision that may ship tool-written content.
      manual.push({ itemId: item.itemId, choice, path: fresh.path });
    }
  }

  for (const feature of declinedFeatures) {
    const featureChoices = dispositions.filter((item) => item.feature === feature).map((item) => item.choice);
    if (featureChoices.some((choice) => choice !== "declined")) {
      return rejection("invalid-resolution", `${feature}: declined cannot be combined with another resolution in the same feature`);
    }
    applyFeatures.delete(feature);
  }

  const { features } = await loadRegistry();
  const excludedFeatures = excludedByDeclines(features, doc.selectedFeatures, declinedFeatures);
  for (const feature of excludedFeatures) applyFeatures.delete(feature);
  const effectiveSelectedFeatures = doc.selectedFeatures.filter((feature) => !excludedFeatures.has(feature));
  const effectiveApplyPaths = dispositions
    .filter((item) => item.choice === "apply-central" && applyFeatures.has(item.feature))
    .map((item) => item.path);

  return {
    ok: true,
    runId: doc.runId,
    baseSha: doc.baseSha,
    defaultBranch: doc.target.defaultBranch,
    owner: doc.target.owner,
    repo: doc.target.repo,
    selectedFeatures: doc.selectedFeatures,
    effectiveSelectedFeatures,
    declinedFeatures: [...declinedFeatures],
    applyFeatures: [...applyFeatures],
    applyPaths: effectiveApplyPaths,
    manual,
    dispositions,
  };
}
