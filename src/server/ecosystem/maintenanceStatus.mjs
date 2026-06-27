// src/server/ecosystem/maintenanceStatus.mjs
//
// Pure per-repo maintenance rollup (#215, spec §4.2). The rules implemented
// here are stated verbatim in docs/MAINTENANCE.md ("Maintenance status") —
// keep doc and code in lockstep in the same PR. No I/O happens here: every
// input (fast status, drift, pin comparisons, fix queue, audit cache, clock)
// is gathered by collectMaintenance.mjs and injected, so each role's rules
// are unit-testable with synthetic inputs.

import { MAINTENANCE_REASONS } from "../../contracts/vocab.mjs";

// A repo with no event in 14 days counts as drifting out of maintenance —
// roughly two idle weeks (docs/MAINTENANCE.md, spec §4.2).
export const EVENTS_STALE_DAYS = 14;

// Worst reason wins: red > yellow > green. Every code in the closed vocab has
// exactly one severity; a vocab/severity mismatch fails the consistency test.
export const REASON_SEVERITY = Object.freeze({
  "repo-unavailable": "red",
  "dirty-worktree": "yellow",
  "not-onboarded": "red",
  "manifest-outdated": "yellow",
  "workflow-drift": "yellow",
  "needs-audit": "yellow",
  "events-stale": "yellow",
  "manifest-current-unaudited": "green",
  "docs-overbudget": "yellow",
  "docs-stale": "yellow",
  "docs-unswept": "yellow",
  "verified-current": "green",
  "drift-detected": "yellow",
  "missing-files": "yellow",
  "audit-blocked": "red",
  "audit-needs-review": "red",
  "snapshot-current": "green",
  "snapshot-behind": "yellow",
  "snapshot-integrity": "red",
  "snapshot-unverified": "yellow",
  "v1-retag-pending": "yellow",
  "pins-verified": "green",
  "fix-queue-pending": "yellow",
  "catalog-present": "green",
  "catalog-missing": "yellow",
});

// Honesty rule (FRONTEND_REDESIGN_SPEC §5, MAINTENANCE.md): a fast-basis
// green is a manifest read, not a verified truth — it must never render as a
// bare "Current". This is the single string every consumer shows for it.
export const FAST_GREEN_DETAIL = "Manifest current · run audit to verify";

const SEVERITY_RANK = { green: 0, yellow: 1, red: 2 };

// VerifiedStatus (FRONTEND_REDESIGN_SPEC §5.2) → reason code. Unknown cache
// values fall through to needs-audit (fail closed, basis stays fast).
const VERIFIED_STATUS_REASONS = Object.freeze({
  verified_current: { code: "verified-current", detail: "Verified current (deep audit)" },
  drift_detected: { code: "drift-detected", detail: "deep audit found drifted files" },
  missing_files: { code: "missing-files", detail: "deep audit found missing files" },
  blocked: { code: "audit-blocked", detail: "deep audit blocked" },
  needs_review: { code: "audit-needs-review", detail: "deep audit needs human review" },
});

const DOC_HEALTH_REASON_GROUPS = Object.freeze({
  "docs-overbudget": new Set(["charter-overbudget", "tool-stub-overbudget"]),
  "docs-stale": new Set(["last-reviewed-stale", "active-plan-stale", "stale-active-doc-term"]),
});

function worstStatus(reasons) {
  let worst = "green";
  for (const { code } of reasons) {
    const severity = REASON_SEVERITY[code];
    if (!severity) throw new Error(`unknown maintenance reason code "${code}"`);
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity;
  }
  return worst;
}

function shortSha(sha) {
  return typeof sha === "string" ? sha.slice(0, 7) : "unknown";
}

function daysBetween(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return (to - from) / 86_400_000; // ms per day
}

function docHealthReasons({ entry, docHealth }, findings) {
  if (!docHealth || entry.lifecycle !== "active") return;

  if (docHealth.state === "missing") {
    findings.push({ code: "docs-unswept", detail: "no cached doc-health report for an active repo" });
    return;
  }
  if (docHealth.state === "unreadable") {
    findings.push({ code: "docs-unswept", detail: "cached doc-health report could not be read" });
    return;
  }

  const report = docHealth.report ?? docHealth;
  if (report.schemaVersion !== "doc-health.v1" || !Array.isArray(report.findings)) {
    findings.push({ code: "docs-unswept", detail: "cached doc-health report is missing or invalid" });
    return;
  }
  if (report.findings.length === 0) return;

  const counts = { "docs-overbudget": 0, "docs-stale": 0, "docs-unswept": 0 };
  for (const finding of report.findings) {
    const findingCode = String(finding?.code ?? "");
    if (DOC_HEALTH_REASON_GROUPS["docs-overbudget"].has(findingCode)) {
      counts["docs-overbudget"] += 1;
    } else if (DOC_HEALTH_REASON_GROUPS["docs-stale"].has(findingCode)) {
      counts["docs-stale"] += 1;
    } else {
      counts["docs-unswept"] += 1;
    }
  }

  if (counts["docs-overbudget"] > 0) {
    findings.push({ code: "docs-overbudget", detail: `${counts["docs-overbudget"]} doc budget warning(s) in cached doc-health report` });
  }
  if (counts["docs-stale"] > 0) {
    findings.push({ code: "docs-stale", detail: `${counts["docs-stale"]} stale doc warning(s) in cached doc-health report` });
  }
  if (counts["docs-unswept"] > 0) {
    findings.push({ code: "docs-unswept", detail: `${counts["docs-unswept"]} doc-health warning(s) need sweep or policy follow-up` });
  }
}

function applicationReasons({ entry, fastStatus, workflowDrift, events, auditCache, now }, findings) {
  // A fresh audit cache upgrades the basis; a stale or absent cache keeps the
  // cheap fast basis. Freshness is the cache writer's job (lane 3) — it is
  // passed through here as `stale`, never recomputed.
  const audited = Boolean(auditCache && !auditCache.stale && VERIFIED_STATUS_REASONS[auditCache.verifiedStatus]);

  if (audited) {
    findings.push({ ...VERIFIED_STATUS_REASONS[auditCache.verifiedStatus] });
  } else {
    switch (fastStatus) {
      case "manifest_current":
        findings.push({ code: "manifest-current-unaudited", detail: FAST_GREEN_DETAIL });
        break;
      case "manifest_outdated":
        findings.push({ code: "manifest-outdated", detail: "onboarding manifest pinned to an older baseline" });
        break;
      case "not_onboarded":
        // RED only while the repo is a health target (MAINTENANCE.md); an
        // explicitly excluded repo still reports honestly that it is unjudged.
        if (entry.healthTarget !== false) {
          findings.push({ code: "not-onboarded", detail: "no .github/archon-setup.json in a health-target repo" });
        } else {
          findings.push({ code: "needs-audit", detail: "not onboarded; excluded from health targets" });
        }
        break;
      default: // unknown_needs_audit, or no fast status computed — fail closed
        findings.push({ code: "needs-audit", detail: "manifest not comparable; run a deep audit" });
        break;
    }
  }

  // Live signals apply on both bases: drift and event flow are measured at
  // snapshot time and can postdate any cached audit.
  if (workflowDrift && workflowDrift.drifted > 0) {
    findings.push({ code: "workflow-drift", detail: `${workflowDrift.drifted} managed workflow caller(s) drifted from the snapshot` });
  }
  const lastEventAt = events?.lastEventAt ?? null;
  if (!lastEventAt) {
    findings.push({ code: "events-stale", detail: "no events recorded in .archon/events.jsonl" });
  } else {
    const age = daysBetween(lastEventAt, now);
    if (age === null || age > EVENTS_STALE_DAYS) {
      findings.push({ code: "events-stale", detail: `last event ${lastEventAt} is older than ${EVENTS_STALE_DAYS} days` });
    }
  }
  return audited ? "audited" : "fast";
}

function pinFindings(pin, findings) {
  if (!pin || !pin.localHead || !pin.pinnedSha) {
    findings.push({
      code: "snapshot-unverified",
      detail: `snapshot pin for ${pin?.key ?? "provider"} could not be compared (missing pin or local HEAD)`,
    });
    return;
  }
  if (pin.pinReachable === false) {
    findings.push({
      code: "snapshot-integrity",
      detail: `pinned ${shortSha(pin.pinnedSha)} (${pin.key}) is unreachable in provider history`,
    });
    return;
  }
  if (pin.pinnedSha === pin.localHead) return; // current — equality is self-evident
  if (pin.pinReachable !== true) {
    findings.push({
      code: "snapshot-unverified",
      detail: `reachability of pinned ${shortSha(pin.pinnedSha)} (${pin.key}) could not be determined`,
    });
    return;
  }
  findings.push({
    code: "snapshot-behind",
    detail: `provider HEAD ${shortSha(pin.localHead)} is ahead of pinned ${shortSha(pin.pinnedSha)} (${pin.key})`,
  });
}

function providerReasons({ snapshotPin }, findings) {
  pinFindings(snapshotPin, findings);
  if (snapshotPin?.v1Tag !== undefined && snapshotPin.v1Tag !== snapshotPin.localHead) {
    findings.push({
      code: "v1-retag-pending",
      detail: snapshotPin.v1Tag
        ? `local v1 tag ${shortSha(snapshotPin.v1Tag)} != HEAD ${shortSha(snapshotPin.localHead)}`
        : "local v1 tag missing",
    });
  }
  if (findings.length === 0) {
    findings.push({ code: "snapshot-current", detail: "snapshot pin matches provider HEAD" });
  }
}

function integratorReasons({ snapshotPin }, findings) {
  const pins = snapshotPin?.pins ?? [];
  if (pins.length === 0) {
    findings.push({ code: "snapshot-unverified", detail: "no snapshot pins available to verify" });
  }
  for (const pin of pins) pinFindings(pin, findings);

  const pending = snapshotPin?.fixQueuePending;
  if (pending === null || pending === undefined) {
    findings.push({ code: "fix-queue-pending", detail: "Ecosystem Fix Queue could not be read (docs/ecosystem-status.md)" });
  } else if (pending > 0) {
    findings.push({ code: "fix-queue-pending", detail: `${pending} item(s) pending in the Ecosystem Fix Queue` });
  }
  if (findings.length === 0) {
    findings.push({ code: "pins-verified", detail: "snapshot pins verify and the fix queue is empty" });
  }
}

function skillSourceReasons({ repoState }, findings) {
  if (repoState.catalogPresent === false) {
    findings.push({ code: "catalog-missing", detail: "docs/skill-catalog.md not found" });
  }
  if (findings.length === 0) {
    findings.push({ code: "catalog-present", detail: "available, clean, catalog present" });
  }
}

const PROVIDER_ROLES = new Set(["workflow-provider", "baseline-provider", "org-defaults-provider"]);

// Pure rollup — spec §4.2 function contract. `governance` is part of the
// contract signature but no current rule consumes it (reserved for future
// posture-based reasons). Returns { status, basis, fastStatus, reasons } where
// reasons is never empty: yellow/red findings, or the role's green code.
export function computeMaintenanceStatus({
  entry,
  repoState,
  fastStatus = null,
  workflowDrift = null,
  events = null,
  governance = null, // reserved: part of the spec §4.2 signature, no rule consumes it yet
  snapshotPin = null,
  auditCache = null,
  docHealth = null,
  now,
}) {
  if (!entry || !entry.role) throw new Error("computeMaintenanceStatus requires entry.role");
  if (!repoState) throw new Error("computeMaintenanceStatus requires repoState");
  if (!now) throw new Error("computeMaintenanceStatus requires now (ISO timestamp)");

  // Unavailable short-circuits everything: no git data exists to judge.
  if (repoState.available === false) {
    return {
      status: "red",
      basis: "fast",
      fastStatus: null,
      reasons: [{ code: "repo-unavailable", detail: repoState.reason || "registered path missing or not a git worktree" }],
    };
  }

  const findings = [];
  if (repoState.dirty) {
    findings.push({ code: "dirty-worktree", detail: "primary checkout has uncommitted changes" });
  }

  let basis = "fast";
  switch (entry.role) {
    case "application":
      basis = applicationReasons({ entry, fastStatus, workflowDrift, events, auditCache, now }, findings);
      break;
    case "ecosystem-health-hub":
      integratorReasons({ snapshotPin }, findings);
      break;
    case "skill-source":
      skillSourceReasons({ repoState }, findings);
      break;
    default:
      if (!PROVIDER_ROLES.has(entry.role)) throw new Error(`unknown repo role "${entry.role}"`);
      providerReasons({ snapshotPin }, findings);
      break;
  }

  docHealthReasons({ entry, docHealth }, findings);

  // Green-with-warnings is contradictory: when yellow/red findings exist, the
  // role's green code (a "nothing wrong" marker, not a finding) is dropped.
  const hasProblems = findings.some(({ code }) => REASON_SEVERITY[code] !== "green");
  const reasons = hasProblems ? findings.filter(({ code }) => REASON_SEVERITY[code] !== "green") : findings;

  return { status: worstStatus(reasons), basis, fastStatus, reasons };
}

// Consistency guard used by tests: the severity table and the closed vocab
// must cover exactly the same codes.
export function severityTableMatchesVocab() {
  const tableCodes = Object.keys(REASON_SEVERITY).sort();
  return JSON.stringify(tableCodes) === JSON.stringify([...MAINTENANCE_REASONS].sort());
}
