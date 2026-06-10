import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegions } from "../../distributor/regionEngine.mjs";
import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";
import { refreshTarget } from "../refresh/refreshRepo.mjs";
import { repoContextFor } from "../../distributor/distribute.mjs";
import { checkOriginRemote } from "../preflight/checkOriginRemote.mjs";
import { contentFingerprint, decisionDocFingerprint, validateDecisionDoc } from "./decisionDoc.mjs";
import { safeJoin } from "../lib/paths.mjs";

// M2 intake (#158): a completed DecisionDoc comes back from a human, an
// external review agent, an HTML face, or an issue — none of which we trust.
// Intake re-validates everything against the LIVE target repo (schema, repo
// identity F13, base SHA F1/F21, per-item fingerprints, fresh reconcile) and
// only then emits the schema-valid ApplySet the M3 PR lane consumes, plus the
// two-layer confirmation summary (human + machine) from the plan.

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY_SET_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "..", "contracts", "schemas", "apply-set.schema.json"), "utf8"),
);
assertSchemaSupported(APPLY_SET_SCHEMA);

// M6 initial auto-merge allowlist (locked decision 2): AGENTS category only;
// each later category expands this in its own reviewed PR.
export const DEFAULT_GUARDS_CONFIG = {
  allowedAutoMergeCategories: ["agents"],
  allowedPathPatterns: ["AGENTS.md", "**/AGENTS.md", ".archon/region-ownership.json"],
};

// Scope-bound confirmation phrase, mirroring distribute's confirmationPhraseFor:
// a pasted phrase can never authorize a different repo's or run's apply.
export function confirmationPhraseForRun({ repoName, runId }) {
  return `APPLY ${repoName} ${runId}`;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function reject(code, detail) {
  return { ok: false, code, detail };
}

async function currentBody(repoPath, relpath) {
  let fullPath;
  try {
    fullPath = safeJoin(repoPath, relpath);
  } catch {
    return null;
  }
  try {
    return await readFile(fullPath, "utf8");
  } catch {
    return null;
  }
}

function regionInnerOf(body, regionId) {
  if (body === null || regionId === null) return null;
  const region = parseRegions(body, "markdown").regions.find((r) => r.id === regionId);
  return region ? region.inner : null;
}

// Staleness for one item against the live tree. Region hash is checked before
// file hash so an in-region edit reports stale-region-hash and an
// outside-the-region edit reports stale-file-hash (both naturally move the
// file hash).
function stalenessOf(item, body) {
  const inner = regionInnerOf(body, item.regionId);
  const innerHash = inner === null ? null : contentFingerprint(inner);
  if (innerHash !== item.fingerprints.regionInnerSha256) return "stale-region-hash";
  const fileHash = body === null ? null : contentFingerprint(body);
  if (fileHash !== item.fingerprints.fileSha256) return "stale-file-hash";
  return null;
}

function writePlanFor(item) {
  if (item.resolution.choice === "keep-local") {
    return { file: ".archon/region-ownership.json", writePlan: { kind: "record-ownership" } };
  }
  // apply-central: the source region is the catalog entry with this region id.
  const writePlan = { kind: "replace-region", sourceCatalogId: item.regionId };
  if (item.raw.created) writePlan.kind = "create-file";
  else if (item.raw.status === "adoption_needed") writePlan.kind = "append-region";
  return { file: item.file, writePlan };
}

export async function intakeDecisionDoc({
  input, // DecisionDoc object or JSON string
  targetPath,
  allowPartial = false,
  guardsConfig = DEFAULT_GUARDS_CONFIG,
  repoContext = repoContextFor,
  refresh = refreshTarget,
  now = new Date().toISOString(),
}) {
  // F18: transport-level JSON must parse before anything else looks at it.
  let doc = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (err) {
      return reject("parse-failed", err.message);
    }
  }

  // Unknown schemaVersion, missing blocks, out-of-vocabulary values: one gate.
  const schemaCheck = validateDecisionDoc(doc);
  if (!schemaCheck.valid) {
    return reject(
      "schema-invalid",
      schemaCheck.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    );
  }

  // F13: the doc must describe THIS repo.
  const repo = await repoContext(targetPath);
  if (repo.available === false) return reject("target-unavailable", `${targetPath} is not a readable git worktree`);
  if (repo.name !== doc.repo.name) {
    return reject("repo-mismatch", `doc is for "${doc.repo.name}", target is "${repo.name}"`);
  }

  // F1/F21: the world must not have moved since the doc was generated. The
  // fresh audit also supplies the current per-item raw states.
  const audit = await refresh({ targetPath, now });
  if (audit.status !== "ok") return reject("target-unavailable", `fresh audit skipped: ${audit.reason}`);
  if (audit.repo.baseSha !== doc.repo.baseSha) {
    return reject("stale-base", `doc base ${doc.repo.baseSha} != current HEAD ${audit.repo.baseSha}`);
  }
  const auditItems = new Map(
    audit.categories.flatMap((category) => category.items).map((item) => [item.itemId, item]),
  );

  // Reviewer-error gates are never partial-skippable: a malformed resolution
  // means the completed doc itself is untrustworthy.
  for (const item of doc.items) {
    const choice = item.resolution.choice;
    if (choice === null || !item.options.includes(choice)) {
      return reject("malformed-resolution", `${item.itemId}: choice ${JSON.stringify(choice)} not in options`);
    }
    if (item.operation.action === "blocked" && choice !== "defer" && !item.resolution.rationale) {
      return reject("missing-rationale", `${item.itemId}: blocked item resolved as ${choice} without a rationale`);
    }
  }

  const applyItems = [];
  const skipped = [];
  const manual = [];

  for (const item of doc.items) {
    const choice = item.resolution.choice;
    if (choice === "defer" || choice === "merge-manual") {
      manual.push({ itemId: item.itemId, choice });
      continue;
    }

    const body = await currentBody(repo.path, item.file);
    const staleness = stalenessOf(item, body);
    const freshItem = auditItems.get(item.itemId);
    const drifted = staleness ?? (freshItem && freshItem.raw.status !== item.raw.status ? "stale-state" : null);
    if (drifted) {
      if (!allowPartial) return reject(drifted, `${item.itemId}: ${drifted} (re-run refresh, or use --allow-partial)`);
      skipped.push({ itemId: item.itemId, reason: drifted });
      continue;
    }

    const target = writePlanFor(item);
    applyItems.push({
      itemId: item.itemId,
      category: item.category,
      regionId: item.regionId,
      file: target.file,
      resolution: choice,
      expectedFileSha256: body === null ? null : contentFingerprint(body),
      expectedRegionInnerSha256: (() => {
        const inner = regionInnerOf(body, item.regionId);
        return inner === null ? null : contentFingerprint(inner);
      })(),
      writePlan: target.writePlan,
    });
  }

  const phrase = confirmationPhraseForRun({ repoName: doc.repo.name, runId: doc.runId });
  const docFingerprint = decisionDocFingerprint(doc);

  let applySet = null;
  if (applyItems.length > 0) {
    // Owner preference: the doc's recorded owner, else the live origin remote
    // (M3's gh calls need a real slug), else a recorded placeholder.
    const origin = doc.repo.owner ? null : (await checkOriginRemote(repo.path)).originDetected;
    applySet = {
      schemaVersion: 1,
      kind: "apply-set",
      runId: doc.runId,
      repo: {
        owner: doc.repo.owner ?? origin?.owner ?? "unknown",
        name: doc.repo.name,
        defaultBranch: doc.repo.defaultBranch,
        baseSha: doc.repo.baseSha,
      },
      sourceDecisionDoc: { fingerprint: docFingerprint },
      items: applyItems,
      guards: {
        allowAutoMerge: applyItems.every((item) =>
          guardsConfig.allowedAutoMergeCategories.includes(item.category),
        ),
        allowedPathPatterns: guardsConfig.allowedPathPatterns,
        requiredConfirmationPhraseHash: sha256(phrase),
      },
    };
    const checked = validate(APPLY_SET_SCHEMA, applySet);
    if (!checked.valid) {
      const detail = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      throw new Error(`intake produced a schema-invalid ApplySet: ${detail}`);
    }
  }

  // The plan's two-layer confirmation: a human summary and the machine facts
  // that make the run reproducible and auditable.
  const summary = {
    human: {
      repo: doc.repo.name,
      applying: applyItems.map((item) => `${item.resolution}: ${item.itemId} -> ${item.writePlan.kind}`),
      skippedStale: skipped.map((s) => `${s.reason}: ${s.itemId}`),
      manualOrDeferred: manual.map((m) => `${m.choice}: ${m.itemId}`),
      autoMerge: applySet ? applySet.guards.allowAutoMerge : false,
      confirmationPhrase: phrase,
      rollbackCommand: `node bin/archon-setup.mjs rollback --run ${doc.runId}`,
    },
    machine: {
      runId: doc.runId,
      baseSha: doc.repo.baseSha,
      decisionDocFingerprint: docFingerprint,
      allowedPathPatterns: guardsConfig.allowedPathPatterns,
      requiredConfirmationPhraseHash: sha256(phrase),
    },
  };

  return { ok: true, applySet, summary, skipped, manual };
}
