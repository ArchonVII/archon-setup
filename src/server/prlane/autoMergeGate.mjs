import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY_SET_SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "..", "contracts", "schemas", "apply-set.schema.json"), "utf8"));
assertSchemaSupported(APPLY_SET_SCHEMA);

export const DEFAULT_AUTO_MERGE_CONFIG = {
  allowedCategories: ["agents"],
  requiredPrLabel: "automated-distribution",
};

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function patternAllows(pattern, relpath) {
  const normalized = relpath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern === normalized) return true;
  if (normalizedPattern.startsWith("**/")) {
    const suffix = normalizedPattern.slice("**/".length);
    return normalized === suffix || normalized.endsWith(`/${suffix}`);
  }
  return false;
}

function labelsOf(pr) {
  return (pr?.labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function checkStatus(check) {
  return String(check?.bucket ?? check?.conclusion ?? check?.status ?? check?.state ?? "").toLowerCase();
}

function checkPassed(check) {
  // Real gh shapes only: `gh pr checks --json ... bucket` emits bucket "pass"; a raw
  // check-run conclusion is "success". Bare "completed"/"ok" are NOT terminal-success
  // (a `{status:"completed"}` run with no conclusion is a real race shape) — excluded.
  return ["pass", "passed", "success"].includes(checkStatus(check));
}

function bodyIncludesIssue(body, issueNumber) {
  if (!issueNumber) return true;
  return new RegExp(`(?:#|/issues/)${issueNumber}\\b`).test(body);
}

export function evaluateAutoMergeEligibility({
  applySet,
  confirmationPhrase,
  conflictAutoResolved = false,
  pr = {},
  requiredChecks = [],
  requireConfiguredChecks = false,
  checks = [],
  postApplyAudit = {},
  config = DEFAULT_AUTO_MERGE_CONFIG,
}) {
  const reasons = [];
  const schemaCheck = validate(APPLY_SET_SCHEMA, applySet);
  if (!schemaCheck.valid) {
    return { eligible: false, reasons: ["apply-set-schema-invalid"] };
  }

  if (sha256(confirmationPhrase ?? "") !== applySet.guards.requiredConfirmationPhraseHash) {
    reasons.push("confirmation-phrase-mismatch");
  }
  if (!applySet.guards.allowAutoMerge) {
    reasons.push("auto-merge-not-allowed-by-apply-set");
  }

  for (const item of applySet.items) {
    if (!config.allowedCategories.includes(item.category)) {
      if (!reasons.includes("auto-merge-not-allowed-by-apply-set")) {
        reasons.push("auto-merge-not-allowed-by-apply-set");
      }
      reasons.push(`disallowed-category:${item.category}`);
    }
    if (!applySet.guards.allowedPathPatterns.some((pattern) => patternAllows(pattern, item.file))) {
      reasons.push(`disallowed-path:${item.file}`);
    }
    if (item.resolution === "merge-manual" || item.resolution === "defer") {
      reasons.push(`unresolved-item:${item.itemId}`);
    }
  }

  if (conflictAutoResolved) reasons.push("conflict-auto-resolved");

  const labels = labelsOf(pr);
  if (!labels.includes(config.requiredPrLabel)) {
    reasons.push(`missing-pr-label:${config.requiredPrLabel}`);
  }

  const body = pr?.body ?? "";
  if (!body.includes(applySet.sourceDecisionDoc.fingerprint)) {
    reasons.push("missing-decision-doc-link");
  }
  if (!bodyIncludesIssue(body, applySet.sourceDecisionDoc.issueNumber)) {
    reasons.push("missing-issue-link");
  }

  if (requireConfiguredChecks && requiredChecks.length === 0) {
    reasons.push("no-required-checks-configured");
  }

  const checksByName = new Map(checks.map((check) => [check.name, check]));
  for (const name of requiredChecks) {
    const check = checksByName.get(name);
    if (!check) reasons.push(`required-check-missing:${name}`);
    else if (!checkPassed(check)) reasons.push(`required-check-not-passing:${name}`);
  }

  if (postApplyAudit.clean !== true) reasons.push("post-apply-audit-not-clean");

  return { eligible: reasons.length === 0, reasons };
}
