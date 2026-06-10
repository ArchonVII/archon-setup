import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegions } from "../../distributor/regionEngine.mjs";
import { loadOperationMapping, operationRowFor } from "../../contracts/operationMapping.mjs";
import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";
import { redactString } from "../ecosystem/redact.mjs";
import { safeJoin } from "../lib/paths.mjs";

// M2 decision doc (#158): the canonical JSON the whole decision flow trusts.
// HTML faces and Save-as-Issue bodies are views/transport of this document,
// never sources of truth (locked decision 1). Built from an M1
// RepoRefreshReport, validated against the M0.5 schema before it leaves this
// module (fail closed), and fingerprinted so intake (and M3 inside its
// worktree) can prove the world has not moved since the doc was generated.

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "..", "contracts", "schemas", "decision-doc.schema.json"), "utf8"),
);
assertSchemaSupported(DOC_SCHEMA);

// Verbatim per the plan's DecisionDoc contract: external review agents get
// their marching orders inside the document itself (AC4).
export const REVIEW_BUNDLE_INSTRUCTIONS =
  "Choose exactly one resolution per item: set resolution.choice to one of that item's options, " +
  "and fill resolution.decidedBy and resolution.decidedAt. Never edit fingerprints, provenance, " +
  "raw findings, or evidence. Blocked (conflict) items require resolution.rationale unless deferred. " +
  "Return the completed JSON document only - no surrounding prose.";

// Items the audit already settled (already-current, not-applicable) carry no
// decision; only these actions enter a decision doc.
const ACTIONABLE = new Set(["merge", "create", "needs_review", "blocked"]);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// All content fingerprints are computed over LF-normalized text so a CRLF
// checkout and the LF worktree M3 cuts from origin/main agree on identity
// (the repo's recorded EOL gotcha). M3 MUST reuse this helper for its
// inside-worktree re-validation.
export function contentFingerprint(text) {
  return sha256(text.replace(/\r\n?/g, "\n"));
}

// The doc's own identity: sha256 over its canonical JSON serialization.
// ApplySet.sourceDecisionDoc.fingerprint carries this value.
export function canonicalJson(doc) {
  return JSON.stringify(doc);
}

export function decisionDocFingerprint(doc) {
  return sha256(canonicalJson(doc));
}

// Provenance default: hash of the committed managed-regions manifest this
// archon-setup checkout would distribute from. Injectable for fixtures.
export function defaultProvenance() {
  const manifestPath = join(HERE, "..", "..", "distributor", "managed-regions.json");
  return { managedRegionsSha256: contentFingerprint(readFileSync(manifestPath, "utf8")) };
}

async function readTargetBody(repoPath, relpath) {
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
  // AGENTS-category files are markdown; the parser accepts all three marker
  // shapes. An unparseable file simply yields no region fingerprint.
  const parsed = parseRegions(body, "markdown");
  const region = parsed.regions.find((r) => r.id === regionId);
  return region ? region.inner : null;
}

// Builds the canonical DecisionDoc from a RepoRefreshReport. Returns null when
// the report holds nothing actionable (a clean repo needs no decisions).
export async function buildDecisionDoc({
  report,
  runId,
  now = new Date().toISOString(),
  owner = null,
  defaultBranch = "main",
  provenance = defaultProvenance(),
  mapping = loadOperationMapping(),
}) {
  if (report.status !== "ok") {
    throw new Error(`cannot build a decision doc from a ${report.status} report (${report.reason ?? "no reason"})`);
  }
  if (!report.repo.baseSha) {
    throw new Error("cannot build a decision doc without repo.baseSha (audit the repo via refreshTarget)");
  }
  if (!runId) throw new Error("runId is required");

  const sourceItems = report.categories
    .flatMap((category) => category.items)
    .filter((item) => ACTIONABLE.has(item.operation.action));
  if (sourceItems.length === 0) return null;

  const fileBodies = new Map();
  for (const item of sourceItems) {
    if (!fileBodies.has(item.file)) {
      fileBodies.set(item.file, await readTargetBody(report.repo.path, item.file));
    }
  }

  const items = sourceItems.map((item) => {
    const body = fileBodies.get(item.file);
    const inner = regionInnerOf(body, item.regionId);
    const row = operationRowFor(mapping, {
      status: item.raw.status,
      changed: item.raw.changed,
      created: item.raw.created ?? false,
    });

    const rawDiff = item.operation.diff ?? null;
    const redactedDiff = rawDiff === null ? null : redactString(rawDiff);

    const operation = { action: item.operation.action, currentState: item.operation.currentState };
    if (item.operation.requiresConfirmation) operation.requiresConfirmation = true;
    if (item.operation.blockerReason) operation.blockerReason = item.operation.blockerReason;

    return {
      itemId: item.itemId,
      category: item.category,
      regionId: item.regionId,
      file: item.file,
      raw: item.raw,
      operation,
      evidence: {
        diff: redactedDiff,
        diagnostics: [],
        truncated: false,
        redacted: redactedDiff !== rawDiff,
      },
      fingerprints: {
        fileSha256: body === null ? null : contentFingerprint(body),
        regionInnerSha256: inner === null ? null : contentFingerprint(inner),
      },
      options: row.options,
      recommended: item.recommended,
      recommendationReason: item.recommendationReason,
      resolution: { choice: null, rationale: null, freeText: null, decidedBy: null, decidedAt: null },
    };
  });

  const files = {};
  for (const [relpath, body] of fileBodies) {
    if (body !== null) files[relpath] = contentFingerprint(body);
  }

  const repo = {
    name: report.repo.name,
    path: report.repo.path ?? null,
    defaultBranch,
    baseSha: report.repo.baseSha,
  };
  if (owner) repo.owner = owner;

  const doc = {
    schemaVersion: 1,
    kind: "decision-doc",
    runId,
    createdAt: now,
    repo,
    repoFingerprint: { headSha: report.repo.baseSha, files },
    provenance,
    reviewBundle: { instructions: REVIEW_BUNDLE_INSTRUCTIONS },
    items,
  };

  const checked = validate(DOC_SCHEMA, doc);
  if (!checked.valid) {
    const detail = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`buildDecisionDoc produced a schema-invalid DecisionDoc: ${detail}`);
  }
  return doc;
}

export function validateDecisionDoc(doc) {
  return validate(DOC_SCHEMA, doc);
}
