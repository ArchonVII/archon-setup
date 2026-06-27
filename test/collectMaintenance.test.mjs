import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectMaintenance, parseFixQueue } from "../src/server/ecosystem/collectMaintenance.mjs";

// I/O wiring for the maintenance engine (#215): pin comparisons via injected
// git, fix-queue/manifest/catalog reads via temp dirs, events via the
// collector's per-source join.

const NOW = "2026-06-12T12:00:00.000Z";

// ---- parseFixQueue ----

const QUEUE_DOC = `
# Ecosystem status

## Ecosystem Fix Queue

Statuses: prose that should not be counted.

| ID | Status | Source | Source-of-truth target | Intended fix | Snapshot impact | Consumer action | Batch notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q1 | proposed | #1 | repo-template | fix a | none | none | - |
| Q2 | \`source-pr\` | #2 | github-workflows | fix b | refresh | accept | - |
| Q3 | shipped | #3 | repo-template | fix c | done | done | - |
| Q4 | deferred | #4 | .github | fix d | parked | none | - |

## Decision log
| ID | Status |
| Q9 | proposed |
`;

test("parseFixQueue counts only pending rows inside the Ecosystem Fix Queue section", () => {
  assert.deepEqual(parseFixQueue(QUEUE_DOC), { pending: 2, total: 4 });
});

test("parseFixQueue: empty table is zero pending; missing section is null", () => {
  const empty = "## Ecosystem Fix Queue\n\n| ID | Status |\n| --- | --- |\n";
  assert.deepEqual(parseFixQueue(empty), { pending: 0, total: 0 });
  assert.equal(parseFixQueue("# no queue here"), null);
  assert.equal(parseFixQueue(""), null);
});

// ---- collectMaintenance ----

function fakeGit(handlers) {
  return async (cmd, args) => {
    assert.equal(cmd, "git", "collectMaintenance only shells out to git");
    const repoPath = args[1]; // ["-C", path, ...rest]
    const rest = args.slice(2).join(" ");
    const response = handlers[repoPath]?.[rest];
    if (response === undefined) return { code: 128, stdout: "", stderr: `unhandled: ${rest}` };
    return response;
  };
}

function repoRow(overrides) {
  return { available: true, dirty: false, healthTarget: true, lifecycle: "active", ...overrides };
}

test("collectMaintenance assembles per-role inputs and returns byId", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "collect-maintenance-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Current snapshot pins.
  const snapshotManifestPath = join(root, "manifest.json");
  await writeFile(snapshotManifestPath, JSON.stringify({
    snapshots: {
      githubWorkflows: { sha: "gw-pin" },
      repoTemplate: { sha: "rt-pin" },
      orgDefaults: { sha: "od-pin" },
    },
  }), "utf8");

  // Application repo onboarded against the current pins, with a fresh event.
  const appPath = join(root, "pigafetta");
  await mkdir(join(appPath, ".github"), { recursive: true });
  await writeFile(join(appPath, ".github", "archon-setup.json"), JSON.stringify({
    tool: "archon-setup",
    sourceSnapshots: {
      githubWorkflows: { sha: "gw-pin" },
      repoTemplate: { sha: "rt-pin" },
      orgDefaults: { sha: "od-pin" },
    },
  }), "utf8");

  // Integrator repo with one pending fix-queue row.
  const hubPath = join(root, "archon-setup");
  await mkdir(join(hubPath, "docs"), { recursive: true });
  await writeFile(join(hubPath, "docs", "ecosystem-status.md"), QUEUE_DOC, "utf8");

  // Skill-source repo without a catalog.
  const skillsPath = join(root, "skills");
  await mkdir(skillsPath, { recursive: true });

  const rtPath = join(root, "repo-template");
  const gwPath = join(root, "github-workflows");
  const docHealthCacheDir = join(root, "doc-health-cache");
  await mkdir(docHealthCacheDir, { recursive: true });
  for (const id of ["pigafetta", "archon-setup", "repo-template", "github-workflows", "skills-review"]) {
    await writeFile(join(docHealthCacheDir, `${encodeURIComponent(id)}.json`), JSON.stringify({
      schemaVersion: "doc-health.v1",
      status: "clean",
      summary: { findings: 0, warnings: 0, blocking: 0 },
      findings: [],
      issues: [],
    }), "utf8");
  }

  const repos = [
    repoRow({ id: "pigafetta", role: "application", path: appPath }),
    repoRow({ id: "archon-setup", role: "ecosystem-health-hub", path: hubPath }),
    repoRow({ id: "repo-template", role: "baseline-provider", path: rtPath }),
    repoRow({ id: "github-workflows", role: "workflow-provider", path: gwPath }),
    repoRow({ id: "skills-review", role: "skill-source", path: skillsPath }),
    repoRow({ id: "mystery", role: null, path: join(root, "mystery") }), // no role → no assessment
    // org-defaults provider intentionally absent: its pin must be unverifiable.
  ];

  const events = {
    sources: [
      { path: join(appPath, ".archon", "events.jsonl"), count: 2, lastEventAt: "2026-06-11T00:00:00.000Z" },
    ],
  };

  const runCommand = fakeGit({
    [rtPath]: {
      "rev-parse HEAD": { code: 0, stdout: "rt-pin\n" },
      "merge-base --is-ancestor rt-pin HEAD": { code: 0, stdout: "" },
    },
    [gwPath]: {
      "rev-parse HEAD": { code: 0, stdout: "gw-head\n" },
      "merge-base --is-ancestor gw-pin HEAD": { code: 0, stdout: "" }, // reachable → behind, not integrity
      "rev-parse refs/tags/v1": { code: 0, stdout: "gw-v1-old\n" },
    },
  });

  const { byId } = await collectMaintenance({ repos, events, now: NOW, snapshotManifestPath, docHealthCacheDir, runCommand });

  // Application: green fast basis, honesty detail, no bare "Current".
  assert.equal(byId.pigafetta.status, "green");
  assert.equal(byId.pigafetta.basis, "fast");
  assert.equal(byId.pigafetta.fastStatus, "manifest_current");
  assert.equal(byId.pigafetta.reasons[0].detail, "Manifest current · run audit to verify");

  // Baseline provider: pin equals HEAD → green snapshot-current.
  assert.equal(byId["repo-template"].status, "green");
  assert.deepEqual(byId["repo-template"].reasons.map((r) => r.code), ["snapshot-current"]);

  // Workflow provider: HEAD ahead of pin + v1 tag not on HEAD.
  assert.equal(byId["github-workflows"].status, "yellow");
  assert.deepEqual(
    byId["github-workflows"].reasons.map((r) => r.code).sort(),
    ["snapshot-behind", "v1-retag-pending"],
  );

  // Integrator: gw pin behind, org-defaults pin unverifiable (provider row
  // absent), one pending fix-queue batch — all surfaced, worst is yellow.
  assert.equal(byId["archon-setup"].status, "yellow");
  const hubCodes = byId["archon-setup"].reasons.map((r) => r.code).sort();
  assert.deepEqual(hubCodes, ["fix-queue-pending", "snapshot-behind", "snapshot-unverified"]);
  assert.match(
    byId["archon-setup"].reasons.find((r) => r.code === "fix-queue-pending").detail,
    /2 item/,
  );

  // Skill source: catalog missing.
  assert.equal(byId["skills-review"].status, "yellow");
  assert.deepEqual(byId["skills-review"].reasons.map((r) => r.code), ["catalog-missing"]);

  // Role-less rows are skipped, not guessed at.
  assert.ok(!("mystery" in byId));
});

test("collectMaintenance reads cached doc-health reports and fails closed when missing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "collect-maintenance-doc-health-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const appPath = join(root, "pigafetta");
  await mkdir(join(appPath, ".github"), { recursive: true });
  await writeFile(join(appPath, ".github", "archon-setup.json"), JSON.stringify({
    tool: "archon-setup",
    sourceSnapshots: {},
  }), "utf8");

  const docHealthCacheDir = join(root, "doc-health-cache");
  await mkdir(docHealthCacheDir, { recursive: true });
  await writeFile(join(docHealthCacheDir, "pigafetta.json"), JSON.stringify({
    schemaVersion: "doc-health.v1",
    status: "warnings",
    summary: { findings: 2, warnings: 2, blocking: 0 },
    findings: [
      { code: "tool-stub-overbudget", path: "CLAUDE.md", severity: "warning" },
      { code: "dangling-relative-link", path: "README.md", severity: "warning" },
    ],
    issues: [],
  }), "utf8");

  const repos = [
    repoRow({ id: "pigafetta", role: "application", path: appPath }),
    repoRow({ id: "hudson-bend", role: "application", path: join(root, "hudson-bend") }),
  ];
  const events = {
    sources: [
      { path: join(appPath, ".archon", "events.jsonl"), count: 1, lastEventAt: "2026-06-11T00:00:00.000Z" },
      { path: join(root, "hudson-bend", ".archon", "events.jsonl"), count: 1, lastEventAt: "2026-06-11T00:00:00.000Z" },
    ],
  };

  const { byId } = await collectMaintenance({
    repos,
    events,
    now: NOW,
    snapshotManifestPath: join(tmpdir(), "missing-manifest.json"),
    docHealthCacheDir,
    runCommand: async () => ({ code: 128, stdout: "", stderr: "" }),
  });

  assert.deepEqual(
    byId.pigafetta.reasons.map((r) => r.code).sort(),
    ["docs-overbudget", "docs-unswept", "needs-audit"],
  );
  assert.ok(byId["hudson-bend"].reasons.map((r) => r.code).includes("docs-unswept"));
});

test("collectMaintenance: unavailable repo short-circuits without touching git or disk", async () => {
  const { byId } = await collectMaintenance({
    repos: [repoRow({ id: "gone", role: "application", path: "C:/nope", available: false, reason: "not a git worktree" })],
    now: NOW,
    snapshotManifestPath: join(tmpdir(), "missing-manifest.json"),
    runCommand: async () => {
      throw new Error("git must not be called for unavailable repos");
    },
  });
  assert.equal(byId.gone.status, "red");
  assert.deepEqual(byId.gone.reasons.map((r) => r.code), ["repo-unavailable"]);
});

test("collectMaintenance: missing snapshot manifest degrades providers to snapshot-unverified", async () => {
  const { byId } = await collectMaintenance({
    repos: [repoRow({ id: "repo-template", role: "baseline-provider", path: "C:/somewhere" })],
    now: NOW,
    snapshotManifestPath: join(tmpdir(), "definitely-missing-manifest.json"),
    // Isolate from the real ~/.archon doc-health cache so docs-unswept is deterministic (#305 review)
    docHealthCacheDir: join(tmpdir(), "definitely-missing-doc-health-cache"),
    runCommand: fakeGit({ "C:/somewhere": { "rev-parse HEAD": { code: 0, stdout: "abc\n" } } }),
  });
  assert.equal(byId["repo-template"].status, "yellow");
  assert.deepEqual(byId["repo-template"].reasons.map((r) => r.code).sort(), ["docs-unswept", "snapshot-unverified"]);
});
