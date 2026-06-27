import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeMaintenanceStatus,
  severityTableMatchesVocab,
  EVENTS_STALE_DAYS,
  FAST_GREEN_DETAIL,
  REASON_SEVERITY,
} from "../src/server/ecosystem/maintenanceStatus.mjs";
import { MAINTENANCE_REASONS } from "../src/contracts/vocab.mjs";
import { validate } from "../src/contracts/validate.mjs";

// Per-role rule coverage with synthetic inputs (#215 acceptance criteria).
// Rules under test are stated in docs/MAINTENANCE.md "Maintenance status".

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = JSON.parse(
  readFileSync(join(ROOT, "src", "contracts", "schemas", "repo-maintenance-status.schema.json"), "utf8"),
);

const NOW = "2026-06-12T12:00:00.000Z";

function app(overrides = {}) {
  return {
    entry: { id: "pigafetta", role: "application", healthTarget: true, lifecycle: "active" },
    repoState: { available: true, dirty: false },
    fastStatus: "manifest_current",
    workflowDrift: { drifted: 0, current: 3, unmanaged: 1 },
    events: { lastEventAt: "2026-06-11T00:00:00.000Z" }, // 1.5 days before NOW
    now: NOW,
    ...overrides,
  };
}

function codes(result) {
  return result.reasons.map((r) => r.code).sort();
}

// Every result in this file must also satisfy the contract schema — the
// engine and repo-maintenance-status.schema.json may not drift apart.
function compute(input) {
  const result = computeMaintenanceStatus(input);
  assert.deepEqual(validate(SCHEMA, result).errors, [], "engine output must validate against the contract schema");
  return result;
}

// ---- all roles ----

test("all roles: unavailable repo is red repo-unavailable and short-circuits", () => {
  const result = compute(app({
    repoState: { available: false, dirty: false, reason: "not a git worktree" },
    fastStatus: null,
  }));
  assert.equal(result.status, "red");
  assert.deepEqual(codes(result), ["repo-unavailable"]);
  assert.match(result.reasons[0].detail, /not a git worktree/);
});

test("all roles: dirty worktree is yellow dirty-worktree", () => {
  const result = compute(app({ repoState: { available: true, dirty: true } }));
  assert.equal(result.status, "yellow");
  assert.ok(codes(result).includes("dirty-worktree"));
});

test("unknown role throws (registry schema makes this unreachable in practice)", () => {
  assert.throws(
    () => computeMaintenanceStatus(app({ entry: { id: "x", role: "mystery" } })),
    /unknown repo role/,
  );
});

// ---- application, fast basis ----

test("application fast green is never a bare Current (honesty rule)", () => {
  const result = compute(app());
  assert.equal(result.status, "green");
  assert.equal(result.basis, "fast");
  assert.equal(result.fastStatus, "manifest_current");
  assert.deepEqual(codes(result), ["manifest-current-unaudited"]);
  assert.equal(result.reasons[0].detail, FAST_GREEN_DETAIL);
  // The whole serialized result must not claim an unqualified "Current".
  const text = JSON.stringify(result);
  assert.ok(!/"(?:current|Current)"/.test(text), `bare Current leaked: ${text}`);
  assert.match(text, /run audit to verify/);
});

test("application: not onboarded while a health target is red", () => {
  const result = compute(app({ fastStatus: "not_onboarded" }));
  assert.equal(result.status, "red");
  assert.ok(codes(result).includes("not-onboarded"));
});

test("application: not onboarded while NOT a health target stays yellow needs-audit", () => {
  const result = compute(app({
    entry: { id: "jma-ui", role: "application", healthTarget: false, lifecycle: "inactive" },
    fastStatus: "not_onboarded",
  }));
  assert.equal(result.status, "yellow");
  assert.ok(codes(result).includes("needs-audit"));
});

test("application: manifest_outdated and unknown_needs_audit are yellow", () => {
  assert.deepEqual(codes(compute(app({ fastStatus: "manifest_outdated" }))), ["manifest-outdated"]);
  assert.deepEqual(codes(compute(app({ fastStatus: "unknown_needs_audit" }))), ["needs-audit"]);
  assert.equal(compute(app({ fastStatus: "manifest_outdated" })).status, "yellow");
});

test("application: workflow drift is yellow workflow-drift", () => {
  const result = compute(app({ workflowDrift: { drifted: 2, current: 1, unmanaged: 0 } }));
  assert.equal(result.status, "yellow");
  assert.ok(codes(result).includes("workflow-drift"));
  assert.match(result.reasons.find((r) => r.code === "workflow-drift").detail, /2 managed workflow caller/);
});

test("application: cached doc-health findings map to document maintenance reasons", () => {
  const result = compute(app({
    docHealth: {
      report: {
        schemaVersion: "doc-health.v1",
        status: "warnings",
        summary: { findings: 3, warnings: 3, blocking: 0 },
        findings: [
          { code: "charter-overbudget", path: "README.md", severity: "warning" },
          { code: "last-reviewed-stale", path: "docs/CANON.md", severity: "warning" },
          { code: "startup-baseline-missing-path", path: ".agent/startup-baseline.json", severity: "warning" },
        ],
        issues: [],
      },
    },
  }));
  assert.equal(result.status, "yellow");
  assert.deepEqual(codes(result), ["docs-overbudget", "docs-stale", "docs-unswept"]);
});

test("application: missing or invalid doc-health cache is yellow docs-unswept for active repos", () => {
  assert.deepEqual(codes(compute(app({ docHealth: { state: "missing" } }))), ["docs-unswept"]);
  assert.deepEqual(codes(compute(app({ docHealth: { report: { schemaVersion: "other", findings: [] } } }))), ["docs-unswept"]);

  const inactive = compute(app({
    entry: { id: "old-app", role: "application", healthTarget: true, lifecycle: "inactive" },
    docHealth: { state: "missing" },
  }));
  assert.deepEqual(codes(inactive), ["manifest-current-unaudited"]);
});

test("provider: doc-health applies to every active registry role", () => {
  const result = compute(provider({
    docHealth: {
      report: {
        schemaVersion: "doc-health.v1",
        status: "warnings",
        summary: { findings: 1, warnings: 1, blocking: 0 },
        findings: [{ code: "tool-stub-overbudget", path: "CLAUDE.md", severity: "warning" }],
        issues: [],
      },
    },
  }));
  assert.equal(result.status, "yellow");
  assert.deepEqual(codes(result), ["docs-overbudget"]);
});

test("application: events-stale exactly at the 14-day threshold boundary", () => {
  // 13.9 days old — still fresh.
  const fresh = compute(app({ events: { lastEventAt: "2026-05-29T14:00:00.000Z" } }));
  assert.equal(fresh.status, "green", JSON.stringify(fresh));
  // 14.5 days old — stale (threshold is "no event in 14 days").
  const stale = compute(app({ events: { lastEventAt: "2026-05-29T00:00:00.000Z" } }));
  assert.equal(stale.status, "yellow");
  assert.ok(codes(stale).includes("events-stale"));
  assert.match(stale.reasons.find((r) => r.code === "events-stale").detail, new RegExp(`${EVENTS_STALE_DAYS} days`));
});

test("application: no events at all is events-stale", () => {
  const result = compute(app({ events: { lastEventAt: null } }));
  assert.ok(codes(result).includes("events-stale"));
  const missing = compute(app({ events: null }));
  assert.ok(codes(missing).includes("events-stale"));
});

// ---- application, audited basis ----

test("application: fresh audit cache flips the basis and yields verified-current green", () => {
  const result = compute(app({ auditCache: { ts: "2026-06-12T10:00:00.000Z", verifiedStatus: "verified_current" } }));
  assert.equal(result.status, "green");
  assert.equal(result.basis, "audited");
  assert.deepEqual(codes(result), ["verified-current"]);
});

test("application audited: drift/missing are yellow; blocked/needs_review are red", () => {
  const cases = [
    ["drift_detected", "yellow", "drift-detected"],
    ["missing_files", "yellow", "missing-files"],
    ["blocked", "red", "audit-blocked"],
    ["needs_review", "red", "audit-needs-review"],
  ];
  for (const [verifiedStatus, status, code] of cases) {
    const result = compute(app({ auditCache: { ts: NOW, verifiedStatus } }));
    assert.equal(result.status, status, verifiedStatus);
    assert.equal(result.basis, "audited", verifiedStatus);
    assert.ok(codes(result).includes(code), verifiedStatus);
  }
});

test("application: stale or unrecognized audit cache falls back to the fast basis", () => {
  const stale = compute(app({ auditCache: { ts: "2026-01-01T00:00:00.000Z", verifiedStatus: "verified_current", stale: true } }));
  assert.equal(stale.basis, "fast");
  assert.deepEqual(codes(stale), ["manifest-current-unaudited"]);
  const garbage = compute(app({ auditCache: { ts: NOW, verifiedStatus: "totally_fine" } }));
  assert.equal(garbage.basis, "fast");
});

test("application audited: live drift signal still applies on the audited basis (worst wins)", () => {
  const result = compute(app({
    auditCache: { ts: NOW, verifiedStatus: "verified_current" },
    workflowDrift: { drifted: 1, current: 2, unmanaged: 0 },
  }));
  assert.equal(result.status, "yellow");
  assert.equal(result.basis, "audited");
  assert.deepEqual(codes(result), ["workflow-drift"]);
});

// ---- provider ----

function provider(overrides = {}) {
  return {
    entry: { id: "repo-template", role: "baseline-provider", healthTarget: true, lifecycle: "active" },
    repoState: { available: true, dirty: false },
    snapshotPin: { key: "repoTemplate", pinnedSha: "aaa111", localHead: "aaa111", pinReachable: true },
    now: NOW,
    ...overrides,
  };
}

test("provider: pin == HEAD and clean is green snapshot-current", () => {
  const result = compute(provider());
  assert.equal(result.status, "green");
  assert.equal(result.fastStatus, null);
  assert.deepEqual(codes(result), ["snapshot-current"]);
});

test("provider: HEAD ahead of the pin is yellow snapshot-behind", () => {
  const result = compute(provider({
    snapshotPin: { key: "repoTemplate", pinnedSha: "aaa111", localHead: "bbb222", pinReachable: true },
  }));
  assert.equal(result.status, "yellow");
  assert.deepEqual(codes(result), ["snapshot-behind"]);
});

test("provider: unreachable pinned sha is red snapshot-integrity", () => {
  const result = compute(provider({
    snapshotPin: { key: "repoTemplate", pinnedSha: "aaa111", localHead: "bbb222", pinReachable: false },
  }));
  assert.equal(result.status, "red");
  assert.deepEqual(codes(result), ["snapshot-integrity"]);
});

test("provider: missing pin data degrades to yellow snapshot-unverified", () => {
  assert.deepEqual(codes(compute(provider({ snapshotPin: null }))), ["snapshot-unverified"]);
  assert.deepEqual(
    codes(compute(provider({ snapshotPin: { key: "repoTemplate", pinnedSha: null, localHead: "bbb", pinReachable: null } }))),
    ["snapshot-unverified"],
  );
  assert.deepEqual(
    codes(compute(provider({ snapshotPin: { key: "repoTemplate", pinnedSha: "aaa", localHead: "bbb", pinReachable: null } }))),
    ["snapshot-unverified"],
  );
  // Equal pin and HEAD is self-evidently current even without a reachability probe.
  assert.deepEqual(
    codes(compute(provider({ snapshotPin: { key: "repoTemplate", pinnedSha: "aaa", localHead: "aaa", pinReachable: null } }))),
    ["snapshot-current"],
  );
});

test("workflow provider: v1 tag not on HEAD is yellow v1-retag-pending (missing tag too)", () => {
  const base = {
    entry: { id: "github-workflows", role: "workflow-provider", healthTarget: true, lifecycle: "active" },
    repoState: { available: true, dirty: false },
    now: NOW,
  };
  const behindTag = compute({
    ...base,
    snapshotPin: { key: "githubWorkflows", pinnedSha: "aaa", localHead: "aaa", pinReachable: true, v1Tag: "old" },
  });
  assert.equal(behindTag.status, "yellow");
  assert.deepEqual(codes(behindTag), ["v1-retag-pending"]);

  const missingTag = compute({
    ...base,
    snapshotPin: { key: "githubWorkflows", pinnedSha: "aaa", localHead: "aaa", pinReachable: true, v1Tag: null },
  });
  assert.ok(codes(missingTag).includes("v1-retag-pending"));
  assert.match(missingTag.reasons.find((r) => r.code === "v1-retag-pending").detail, /missing/);

  const current = compute({
    ...base,
    snapshotPin: { key: "githubWorkflows", pinnedSha: "aaa", localHead: "aaa", pinReachable: true, v1Tag: "aaa" },
  });
  assert.equal(current.status, "green");
  assert.deepEqual(codes(current), ["snapshot-current"]);
});

// ---- integrator ----

function integrator(overrides = {}) {
  return {
    entry: { id: "archon-setup", role: "ecosystem-health-hub", healthTarget: true, lifecycle: "active" },
    repoState: { available: true, dirty: false },
    snapshotPin: {
      pins: [
        { key: "githubWorkflows", pinnedSha: "a", localHead: "a", pinReachable: true },
        { key: "repoTemplate", pinnedSha: "b", localHead: "b", pinReachable: true },
        { key: "orgDefaults", pinnedSha: "c", localHead: "c", pinReachable: true },
      ],
      fixQueuePending: 0,
    },
    now: NOW,
    ...overrides,
  };
}

test("integrator: pins verify and empty fix queue is green pins-verified", () => {
  const result = compute(integrator());
  assert.equal(result.status, "green");
  assert.deepEqual(codes(result), ["pins-verified"]);
});

test("integrator: a behind pin is yellow snapshot-behind; an unreachable pin is red snapshot-integrity", () => {
  const behind = compute(integrator({
    snapshotPin: {
      pins: [
        { key: "githubWorkflows", pinnedSha: "a", localHead: "z", pinReachable: true },
        { key: "repoTemplate", pinnedSha: "b", localHead: "b", pinReachable: true },
        { key: "orgDefaults", pinnedSha: "c", localHead: "c", pinReachable: true },
      ],
      fixQueuePending: 0,
    },
  }));
  assert.equal(behind.status, "yellow");
  assert.deepEqual(codes(behind), ["snapshot-behind"]);

  const broken = compute(integrator({
    snapshotPin: {
      pins: [{ key: "repoTemplate", pinnedSha: "b", localHead: "z", pinReachable: false }],
      fixQueuePending: 0,
    },
  }));
  assert.equal(broken.status, "red");
  assert.deepEqual(codes(broken), ["snapshot-integrity"]);
});

test("integrator: pending fix-queue items are yellow fix-queue-pending; unreadable queue fails closed", () => {
  const pending = compute(integrator({
    snapshotPin: { ...integrator().snapshotPin, fixQueuePending: 3 },
  }));
  assert.equal(pending.status, "yellow");
  assert.deepEqual(codes(pending), ["fix-queue-pending"]);
  assert.match(pending.reasons[0].detail, /3 item/);

  const unreadable = compute(integrator({
    snapshotPin: { ...integrator().snapshotPin, fixQueuePending: null },
  }));
  assert.equal(unreadable.status, "yellow");
  assert.deepEqual(codes(unreadable), ["fix-queue-pending"]);
  assert.match(unreadable.reasons[0].detail, /could not be read/);
});

test("integrator: no pins available is yellow snapshot-unverified", () => {
  const result = compute(integrator({ snapshotPin: { pins: [], fixQueuePending: 0 } }));
  assert.equal(result.status, "yellow");
  assert.deepEqual(codes(result), ["snapshot-unverified"]);
});

// ---- skill-source ----

function skillSource(overrides = {}) {
  return {
    entry: { id: "skills-review", role: "skill-source", healthTarget: true, lifecycle: "active" },
    repoState: { available: true, dirty: false, catalogPresent: true },
    now: NOW,
    ...overrides,
  };
}

test("skill-source: available, clean, catalog present is green catalog-present", () => {
  const result = compute(skillSource());
  assert.equal(result.status, "green");
  assert.deepEqual(codes(result), ["catalog-present"]);
});

test("skill-source: missing catalog or dirty checkout is yellow; unavailable is red", () => {
  const missing = compute(skillSource({ repoState: { available: true, dirty: false, catalogPresent: false } }));
  assert.equal(missing.status, "yellow");
  assert.deepEqual(codes(missing), ["catalog-missing"]);

  const dirty = compute(skillSource({ repoState: { available: true, dirty: true, catalogPresent: true } }));
  assert.equal(dirty.status, "yellow");
  assert.deepEqual(codes(dirty), ["dirty-worktree"]);

  const gone = compute(skillSource({ repoState: { available: false, dirty: false } }));
  assert.equal(gone.status, "red");
  assert.deepEqual(codes(gone), ["repo-unavailable"]);
});

// ---- rollup mechanics ----

test("worst reason wins and green markers are dropped when findings exist", () => {
  const result = compute(app({
    repoState: { available: true, dirty: true },
    fastStatus: "not_onboarded",
    workflowDrift: { drifted: 1 },
    events: { lastEventAt: null },
  }));
  assert.equal(result.status, "red"); // not-onboarded outranks the yellows
  assert.deepEqual(codes(result), ["dirty-worktree", "events-stale", "not-onboarded", "workflow-drift"]);
  assert.ok(!codes(result).some((code) => REASON_SEVERITY[code] === "green"));
});

test("severity table covers exactly the closed reason vocabulary", () => {
  assert.equal(severityTableMatchesVocab(), true);
  assert.deepEqual(Object.keys(REASON_SEVERITY).sort(), [...MAINTENANCE_REASONS].sort());
});

test("required inputs fail loudly", () => {
  assert.throws(() => computeMaintenanceStatus({ repoState: {}, now: NOW }), /entry\.role/);
  assert.throws(() => computeMaintenanceStatus({ entry: { role: "application" }, now: NOW }), /repoState/);
  assert.throws(() => computeMaintenanceStatus({ entry: { role: "application" }, repoState: {} }), /now/);
});
