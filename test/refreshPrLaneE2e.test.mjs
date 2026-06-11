import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildDecisionDoc } from "../src/server/decisions/decisionDoc.mjs";
import { confirmationPhraseForRun, intakeDecisionDoc } from "../src/server/decisions/intake.mjs";
import { runCommand } from "../src/server/lib/commandRunner.mjs";
import { cleanupRun, verifyMergedRun } from "../src/server/prlane/rollback.mjs";
import { runUpdate } from "../src/server/prlane/runUpdate.mjs";
import { refreshRepo } from "../src/server/refresh/refreshRepo.mjs";

const NOW = "2026-06-10T12:00:00.000Z";
const RUN_ID = "run-2026-06-10-m6-e2e";
const APPLY_ID = "2026-06-10-m6-apply";
const KEEP_ID = "2026-06-10-m6-keep";
const MANUAL_ID = "local-manual-block";
const DEFER_ID = "local-deferred-block";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function managedBlock(id, inner) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${id} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${id} -->`,
    "",
  ].join("\n");
}

function catalogEntry({ id, targetRelpath, inner }) {
  return {
    id,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath,
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner,
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
  };
}

function catalog() {
  const entries = [
    catalogEntry({
      id: APPLY_ID,
      targetRelpath: "AGENTS.md",
      inner: "## M6 Applied\n\n- Central guidance landed.",
    }),
    catalogEntry({
      id: KEEP_ID,
      targetRelpath: "docs/AGENTS.md",
      inner: "## M6 Keep\n\n- Central docs guidance.",
    }),
  ];
  return { entries, knownIds: new Set(entries.map((entry) => entry.id)) };
}

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "archon-m6-e2e-"));
  const target = join(root, "consumer-repo");
  const remote = join(root, "consumer-repo.git");
  await mkdir(join(target, "docs"), { recursive: true });
  await writeFile(
    join(target, "AGENTS.md"),
    [
      "# Agents",
      "",
      managedBlock(APPLY_ID, "stale central guidance"),
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(target, "docs", "AGENTS.md"),
    [
      "# Docs agents",
      "",
      "Local docs guidance.",
      "",
      managedBlock(MANUAL_ID, "manual local guidance"),
      managedBlock(DEFER_ID, "deferred local guidance"),
    ].join("\n"),
    "utf8",
  );

  git(target, ["init", "-b", "main"]);
  git(target, ["config", "user.email", "agent@example.test"]);
  git(target, ["config", "user.name", "Archon Agent"]);
  git(target, ["add", "AGENTS.md", "docs/AGENTS.md"]);
  git(target, ["commit", "-m", "chore: seed m6 fixture"]);
  git(root, ["init", "--bare", "-b", "main", remote]);
  git(target, ["remote", "add", "origin", remote]);
  git(target, ["push", "-u", "origin", "main"]);

  return { root, target, remote };
}

async function audit(repo, activeCatalog = catalog()) {
  return refreshRepo({
    repo: {
      name: "consumer-repo",
      path: repo.target,
      branch: "main",
      dirty: false,
      available: true,
    },
    catalog: activeCatalog,
    now: NOW,
    baseSha: git(repo.target, ["rev-parse", "HEAD"]),
  });
}

function completeDecisionDoc(doc) {
  const completed = JSON.parse(JSON.stringify(doc));
  const choices = new Map([
    [APPLY_ID, { choice: "apply-central", rationale: null }],
    [KEEP_ID, { choice: "keep-local", rationale: "docs guidance stays local for this repo" }],
    [MANUAL_ID, { choice: "merge-manual", rationale: "manual block remains owned by the repo" }],
    [DEFER_ID, { choice: "defer", rationale: null }],
  ]);
  for (const item of completed.items) {
    const resolution = choices.get(item.regionId);
    assert.ok(resolution, `unexpected decision item ${item.itemId}`);
    item.resolution = {
      ...resolution,
      freeText: null,
      decidedBy: "m6-test",
      decidedAt: NOW,
    };
  }
  return completed;
}

function fakeGh(calls) {
  // Faithful enough to exercise the lane's real-evidence path (C1): the PR body and
  // labels are captured at create/edit time and echoed back on `pr view`, and `pr checks`
  // emits gh's real `bucket` shape rather than the synthetic `status:"passed"` (C10).
  let createdBody = "";
  const labels = [];
  return async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "pr" && args[1] === "create") {
      createdBody = options.stdin ?? "";
      return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/163\n", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") {
      const at = args.indexOf("--add-label");
      if (at >= 0 && args[at + 1]) labels.push(args[at + 1]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "view") {
      if (args.includes("state,mergeCommit")) {
        // verifyMergedRun's PR merge-state probe (#186, C5): OPEN/null sends it
        // down the recorded assumed-origin-head fallback, matching this fixture
        // where the "merge" happens directly on the bare remote.
        return { code: 0, stdout: JSON.stringify({ state: "OPEN", mergeCommit: null }), stderr: "" };
      }
      return {
        code: 0,
        stdout: JSON.stringify({ labels: labels.map((name) => ({ name })), body: createdBody }),
        stderr: "",
      };
    }
    if (args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([{ name: "test", state: "SUCCESS", bucket: "pass" }]), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "merge") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
}

function mergeRefreshBranch(repo, branch) {
  git(repo.target, ["checkout", "main"]);
  git(repo.target, ["fetch", "origin", branch]);
  git(repo.target, ["merge", "--squash", `origin/${branch}`]);
  git(repo.target, ["commit", "-m", `Squash ${branch}`]);
  git(repo.target, ["push", "origin", "main"]);
  return git(repo.target, ["rev-parse", "HEAD"]);
}

test("M6 e2e: refresh decisions execute merge verify cleanup then second run is no-op", async () => {
  const repo = await makeRepo();
  const activeCatalog = catalog();
  const firstReport = await audit(repo, activeCatalog);
  const firstDoc = await buildDecisionDoc({
    report: firstReport,
    runId: RUN_ID,
    owner: "ArchonVII",
    now: NOW,
  });
  assert.deepEqual(
    firstDoc.items.map((item) => item.resolution.choice),
    [null, null, null, null],
  );

  const completed = completeDecisionDoc(firstDoc);
  assert.deepEqual(
    completed.items.map((item) => item.resolution.choice).sort(),
    ["apply-central", "defer", "keep-local", "merge-manual"],
  );

  const firstIntake = await intakeDecisionDoc({
    input: completed,
    targetPath: repo.target,
    refresh: async () => audit(repo, activeCatalog),
    originRemote: async () => ({ originDetected: { owner: "ArchonVII", repo: "consumer-repo" } }),
    sourceIssueNumber: 163,
    now: NOW,
  });
  assert.equal(firstIntake.ok, true);
  assert.equal(firstIntake.applySet.sourceDecisionDoc.issueNumber, 163);
  assert.equal(firstIntake.applySet.items.length, 2);

  const ghCalls = [];
  const recordPath = join(repo.root, "run.jsonl");
  const run = await runUpdate({
    applySet: firstIntake.applySet,
    targetPath: repo.target,
    mode: "auto",
    confirmationPhrase: confirmationPhraseForRun({ repoName: "consumer-repo", runId: RUN_ID }),
    recordPath,
    workRoot: join(repo.root, "worktrees"),
    catalog: activeCatalog,
    requiredChecks: ["test"],
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });
  assert.equal(run.state, "merge_queued");
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "merge"), true);

  const mergeSha = mergeRefreshBranch(repo, run.branch);
  const agents = await readFile(join(repo.target, "AGENTS.md"), "utf8");
  assert.match(agents, /Central guidance landed/);
  const docsAgents = await readFile(join(repo.target, "docs", "AGENTS.md"), "utf8");
  assert.match(docsAgents, /manual local guidance/);
  assert.match(docsAgents, /deferred local guidance/);
  const ownership = JSON.parse(await readFile(join(repo.target, ".archon", "region-ownership.json"), "utf8"));
  assert.equal(ownership.records.some((record) => record.regionId === KEEP_ID), true);

  const verified = await verifyMergedRun({
    recordPath,
    targetPath: repo.target,
    catalog: activeCatalog,
    runCommand,
    runGh: fakeGh([]),
    now: () => NOW,
  });
  assert.equal(verified.state, "verified_merged");
  assert.equal(verified.report.mergeSha, mergeSha);
  assert.equal(verified.report.verification.postMerge.status, "passed");

  const cleaned = await cleanupRun({ recordPath, targetPath: repo.target, runCommand, now: () => NOW });
  assert.equal(cleaned.state, "cleaned_up");
  assert.equal(git(repo.target, ["status", "--porcelain"]), "");
  assert.equal(git(repo.target, ["ls-remote", "--heads", "origin", run.branch]), "");

  const secondReport = await audit(repo, activeCatalog);
  const secondItems = secondReport.categories.flatMap((category) => category.items);
  assert.equal(secondItems.some((item) => item.recommended !== null), false);
  assert.equal(secondItems.some((item) => item.regionId === KEEP_ID), false);

  const secondDoc = await buildDecisionDoc({
    report: secondReport,
    runId: `${RUN_ID}-second`,
    owner: "ArchonVII",
    now: NOW,
  });
  if (secondDoc) {
    const secondCompleted = JSON.parse(JSON.stringify(secondDoc));
    for (const item of secondCompleted.items) {
      item.resolution = {
        choice: item.options.includes("merge-manual") ? "merge-manual" : "defer",
        rationale: item.options.includes("merge-manual") ? "manual item remains repo-owned" : null,
        freeText: null,
        decidedBy: "m6-test",
        decidedAt: NOW,
      };
    }
    const secondIntake = await intakeDecisionDoc({
      input: secondCompleted,
      targetPath: repo.target,
      refresh: async () => audit(repo, activeCatalog),
      originRemote: async () => ({ originDetected: { owner: "ArchonVII", repo: "consumer-repo" } }),
      sourceIssueNumber: 163,
      now: NOW,
    });
    assert.equal(secondIntake.ok, true);
    assert.equal(secondIntake.applySet, null);
  }
});

// Shared intake pipeline for the auto-path gate tests below (reuses the M6 fixture).
async function applySetFor(repo, activeCatalog) {
  const report = await audit(repo, activeCatalog);
  const doc = await buildDecisionDoc({ report, runId: RUN_ID, owner: "ArchonVII", now: NOW });
  const completed = completeDecisionDoc(doc);
  const intake = await intakeDecisionDoc({
    input: completed,
    targetPath: repo.target,
    refresh: async () => audit(repo, activeCatalog),
    originRemote: async () => ({ originDetected: { owner: "ArchonVII", repo: "consumer-repo" } }),
    sourceIssueNumber: 163,
    now: NOW,
  });
  assert.equal(intake.ok, true);
  return intake.applySet;
}

test("auto refuses (stops at checks_pending) when no required checks resolve from branch protection (C2)", async () => {
  const repo = await makeRepo();
  const activeCatalog = catalog();
  const applySet = await applySetFor(repo, activeCatalog);
  const ghCalls = [];
  const recordPath = join(repo.root, "run-no-checks.jsonl");

  const run = await runUpdate({
    applySet,
    targetPath: repo.target,
    mode: "auto",
    confirmationPhrase: confirmationPhraseForRun({ repoName: "consumer-repo", runId: RUN_ID }),
    recordPath,
    workRoot: join(repo.root, "worktrees-no-checks"),
    catalog: activeCatalog,
    // No explicit requiredChecks -> runUpdate resolves from the target; stub "no protection".
    resolveRequiredChecks: async () => ({ checks: [], source: "branch-protection", status: "missing-protection" }),
    runCommand,
    runGh: fakeGh(ghCalls),
    now: () => NOW,
  });

  assert.equal(run.state, "checks_pending");
  assert.equal(run.requiredChecksStatus, "missing-protection");
  assert.ok(run.autoMerge.reasons.includes("no-required-checks-configured"));
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "merge"), false);
  const ledger = await readFile(recordPath, "utf8");
  assert.match(ledger, /"requiredChecksStatus":"missing-protection"/);
});

test("auto refuses (stops at checks_pending) when the fetched PR is missing its label (C1)", async () => {
  const repo = await makeRepo();
  const activeCatalog = catalog();
  const applySet = await applySetFor(repo, activeCatalog);
  const ghCalls = [];
  const recordPath = join(repo.root, "run-missing-label.jsonl");

  // gh `pr view` reports NO labels (e.g. the label was stripped between create and queue);
  // the body still carries real decision-doc/issue evidence so only the label leg fails.
  const ghNoLabel = async (args, options = {}) => {
    ghCalls.push({ args, options });
    if (args[0] === "pr" && args[1] === "create") {
      return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/163\n", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ labels: [], body: `#163\n${applySet.sourceDecisionDoc.fingerprint}` }), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([{ name: "test", bucket: "pass" }]), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "merge") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

  const run = await runUpdate({
    applySet,
    targetPath: repo.target,
    mode: "auto",
    confirmationPhrase: confirmationPhraseForRun({ repoName: "consumer-repo", runId: RUN_ID }),
    recordPath,
    workRoot: join(repo.root, "worktrees-missing-label"),
    catalog: activeCatalog,
    requiredChecks: ["test"],
    runCommand,
    runGh: ghNoLabel,
    now: () => NOW,
  });

  assert.equal(run.state, "checks_pending");
  assert.ok(run.autoMerge.reasons.includes("missing-pr-label:automated-distribution"));
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "merge"), false);
});
