import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildDecisionDoc } from "../src/server/decisions/decisionDoc.mjs";
import { confirmationPhraseForRun } from "../src/server/decisions/intake.mjs";
import { listGlobalUpdates } from "../src/server/globalUpdates.mjs";
import { runCommand } from "../src/server/lib/commandRunner.mjs";
import { refreshTarget } from "../src/server/refresh/refreshRepo.mjs";
import { readRunRecord } from "../src/server/prlane/runRecord.mjs";
import { runUpdate } from "../src/server/prlane/runUpdate.mjs";

const BLOCK_ID = "2026-01-01-review-block";
const PHRASE = "APPLY consumer-repo run-2026-06-09-0001";
const BIN = join(process.cwd(), "bin", "archon-setup.mjs");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function managedBlock(inner) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${BLOCK_ID} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${BLOCK_ID} -->`,
    "",
  ].join("\n");
}

function catalog() {
  return {
    entries: [
      {
        id: BLOCK_ID,
        group: "agents",
        provider: "globalUpdates",
        adapter: "markdown",
        targetRelpath: "AGENTS.md",
        wholeFile: false,
        appliesToDefault: "existing-file-only",
        inner: "## Review Block\n\n- Central guidance.",
        markerShape: "global-update",
        anchor: { kind: "eof-append" },
        protectedBranches: ["main", "master"],
      },
    ],
    knownIds: new Set([BLOCK_ID]),
  };
}

async function makeRepo(body = `# Agents\n\n${managedBlock("stale guidance")}`) {
  const root = await mkdtemp(join(tmpdir(), "archon-prlane-repo-"));
  const target = join(root, "consumer-repo");
  const remote = join(root, "consumer-repo.git");
  await mkdir(target, { recursive: true });

  await writeFile(join(target, "AGENTS.md"), body, "utf8");

  git(target, ["init", "-b", "main"]);
  git(target, ["config", "user.email", "agent@example.test"]);
  git(target, ["config", "user.name", "Archon Agent"]);
  git(target, ["add", "AGENTS.md"]);
  git(target, ["commit", "-m", "chore: seed fixture"]);
  git(root, ["init", "--bare", "-b", "main", remote]);
  git(target, ["remote", "add", "origin", remote]);
  git(target, ["push", "-u", "origin", "main"]);

  return { root, target, originalBody: body, baseSha: git(target, ["rev-parse", "HEAD"]) };
}

function applySet(baseSha, overrides = {}) {
  const staleInner = "stale guidance";
  const staleBody = `# Agents\n\n${managedBlock(staleInner)}`;
  const set = {
    schemaVersion: 1,
    kind: "apply-set",
    runId: "run-2026-06-09-0001",
    repo: { owner: "ArchonVII", name: "consumer-repo", defaultBranch: "main", baseSha },
    sourceDecisionDoc: {
      fingerprint: "0123456701234567012345670123456701234567012345670123456701234567",
      issueNumber: 123,
    },
    items: [
      {
        itemId: `agents/AGENTS.md#${BLOCK_ID}`,
        category: "agents",
        regionId: BLOCK_ID,
        file: "AGENTS.md",
        resolution: "apply-central",
        expectedFileSha256: sha256(staleBody),
        expectedRegionInnerSha256: sha256(staleInner),
        writePlan: { kind: "replace-region", sourceCatalogId: BLOCK_ID },
      },
    ],
    guards: {
      allowAutoMerge: true,
      allowedPathPatterns: ["AGENTS.md", "**/AGENTS.md", ".archon/region-ownership.json"],
      requiredConfirmationPhraseHash: sha256(PHRASE),
    },
  };
  return {
    ...set,
    ...overrides,
    repo: { ...set.repo, ...(overrides.repo ?? {}) },
    sourceDecisionDoc: { ...set.sourceDecisionDoc, ...(overrides.sourceDecisionDoc ?? {}) },
    guards: { ...set.guards, ...(overrides.guards ?? {}) },
    items: overrides.items ?? set.items,
  };
}

function recordingRunCommand(calls) {
  return async (cmd, args, options = {}) => {
    calls.push({ cmd, args });
    return runCommand(cmd, args, options);
  };
}

async function makeRepoWithRealGlobalUpdate() {
  const record = listGlobalUpdates().find((item) => item.distribution?.kind === "agents-managed-block");
  assert.ok(record, "expected at least one real agents-managed-block global update");
  const body = [
    "# Agents",
    "",
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
    "stale real global update",
    `<!-- END ARCHONVII GLOBAL UPDATE: ${record.id} -->`,
    "",
  ].join("\n");
  const root = await mkdtemp(join(tmpdir(), "archon-prlane-cli-"));
  const target = join(root, "consumer-repo");
  const remote = join(root, "consumer-repo.git");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "AGENTS.md"), body, "utf8");
  git(target, ["init", "-b", "main"]);
  git(target, ["config", "user.email", "agent@example.test"]);
  git(target, ["config", "user.name", "Archon Agent"]);
  git(target, ["add", "AGENTS.md"]);
  git(target, ["commit", "-m", "chore: seed real fixture"]);
  git(root, ["init", "--bare", "-b", "main", remote]);
  git(target, ["remote", "add", "origin", remote]);
  git(target, ["push", "-u", "origin", "main"]);
  return { root, target, record };
}

function resolveOneApplyCentral(doc, itemId) {
  const out = JSON.parse(JSON.stringify(doc));
  for (const item of out.items) {
    item.resolution = {
      choice: item.itemId === itemId ? "apply-central" : "defer",
      rationale: null,
      freeText: null,
      decidedBy: "test-reviewer",
      decidedAt: "2026-06-10T12:00:00.000Z",
    };
  }
  return out;
}

test("runUpdate local-only applies in a temp worktree, records states, and never calls gh", async () => {
  const repo = await makeRepo();
  const workRoot = join(repo.root, "worktrees");
  const recordPath = join(repo.root, "run.jsonl");
  const gitCalls = [];
  const ghCalls = [];

  const result = await runUpdate({
    applySet: applySet(repo.baseSha),
    targetPath: repo.target,
    mode: "local-only",
    confirmationPhrase: PHRASE,
    recordPath,
    workRoot,
    catalog: catalog(),
    runCommand: recordingRunCommand(gitCalls),
    runGh: async (args) => {
      ghCalls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
    now: () => "2026-06-10T12:00:00.000Z",
  });

  assert.equal(result.state, "verified_local");
  assert.match(result.branch, /^agent\/refresh\/run-2026-06-09-0001-/);
  assert.equal(ghCalls.length, 0);
  assert.equal(gitCalls.some((call) => call.args.some((arg) => /force/i.test(arg))), false);

  assert.equal(await readFile(join(repo.target, "AGENTS.md"), "utf8"), repo.originalBody);
  assert.match(await readFile(join(result.worktreePath, "AGENTS.md"), "utf8"), /Central guidance/);

  const record = await readRunRecord(recordPath);
  assert.deepEqual(
    record.entries.map((entry) => entry.state),
    ["planned", "preflight_started", "preflight_passed", "issue_created", "worktree_created", "applied", "verified_local"],
  );
});

test("runUpdate local-only rejects disallowed paths before creating a worktree", async () => {
  const repo = await makeRepo();
  const recordPath = join(repo.root, "run-disallowed.jsonl");
  const workRoot = join(repo.root, "worktrees-disallowed");
  const badSet = applySet(repo.baseSha, {
    items: [{ ...applySet(repo.baseSha).items[0], file: "README.md" }],
  });

  await assert.rejects(
    runUpdate({
      applySet: badSet,
      targetPath: repo.target,
      mode: "local-only",
      confirmationPhrase: PHRASE,
      recordPath,
      workRoot,
      catalog: catalog(),
      runCommand,
      now: () => "2026-06-10T12:00:00.000Z",
    }),
    /apply path is outside the allowlist: README.md/,
  );

  assert.equal(await readFile(join(repo.target, "AGENTS.md"), "utf8"), repo.originalBody);
  const record = await readRunRecord(recordPath);
  assert.deepEqual(
    record.entries.map((entry) => entry.state),
    ["planned", "preflight_started", "failed"],
  );
});

test("runUpdate local-only keeps the source checkout untouched when temp-worktree apply fails", async () => {
  const malformed = [
    "# Agents",
    "",
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${BLOCK_ID} -->`,
    "stale guidance without an end marker",
    "",
  ].join("\n");
  const repo = await makeRepo(malformed);
  const recordPath = join(repo.root, "run-apply-fail.jsonl");

  await assert.rejects(
    runUpdate({
      applySet: applySet(repo.baseSha),
      targetPath: repo.target,
      mode: "local-only",
      confirmationPhrase: PHRASE,
      recordPath,
      workRoot: join(repo.root, "worktrees-apply-fail"),
      catalog: catalog(),
      runCommand,
      now: () => "2026-06-10T12:00:00.000Z",
    }),
    /distribute apply did not cleanly apply AGENTS.md: conflict\/malformed-markers/,
  );

  assert.equal(await readFile(join(repo.target, "AGENTS.md"), "utf8"), malformed);
  const record = await readRunRecord(recordPath);
  assert.deepEqual(
    record.entries.map((entry) => entry.state),
    ["planned", "preflight_started", "preflight_passed", "issue_created", "worktree_created", "failed"],
  );
});

test("runUpdate pr-only commits, pushes, creates a labeled draft PR, and does not auto-merge", async () => {
  const repo = await makeRepo();
  const recordPath = join(repo.root, "run-pr-only.jsonl");
  const ghCalls = [];
  const runGh = async (args, options = {}) => {
    ghCalls.push({ args, options });
    if (args[0] === "pr" && args[1] === "create") {
      return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/457\n", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") {
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

  const result = await runUpdate({
    applySet: applySet(repo.baseSha),
    targetPath: repo.target,
    mode: "pr-only",
    confirmationPhrase: PHRASE,
    recordPath,
    workRoot: join(repo.root, "worktrees-pr-only"),
    catalog: catalog(),
    runCommand,
    runGh,
    now: () => "2026-06-10T12:00:00.000Z",
  });

  assert.equal(result.state, "pr_created");
  assert.deepEqual(result.pr, { number: 457, url: "https://github.com/ArchonVII/consumer-repo/pull/457" });
  assert.match(git(repo.target, ["ls-remote", "--heads", "origin", result.branch]), new RegExp(result.branch.replaceAll("/", "\\/")));

  assert.equal(ghCalls.some((call) => call.args.includes("merge")), false);
  assert.deepEqual(ghCalls[0].args.slice(0, 8), [
    "pr",
    "create",
    "--repo",
    "ArchonVII/consumer-repo",
    "--base",
    "main",
    "--head",
    result.branch,
  ]);
  assert.match(ghCalls[0].options.stdin, /Closes #123/);
  assert.match(ghCalls[0].options.stdin, /0123456701234567012345670123456701234567012345670123456701234567/);
  assert.deepEqual(ghCalls[1].args, [
    "pr",
    "edit",
    "457",
    "--repo",
    "ArchonVII/consumer-repo",
    "--add-label",
    "automated-distribution",
  ]);

  const record = await readRunRecord(recordPath);
  assert.deepEqual(
    record.entries.map((entry) => entry.state),
    [
      "planned",
      "preflight_started",
      "preflight_passed",
      "issue_created",
      "worktree_created",
      "applied",
      "verified_local",
      "committed",
      "pushed",
      "pr_created",
    ],
  );
});

test("runUpdate auto mode queues auto-merge when the gate is eligible", async () => {
  const repo = await makeRepo();
  const ghCalls = [];
  let createdBody = "";
  const labels = [];
  const runGh = async (args, options = {}) => {
    ghCalls.push({ args, options });
    if (args[0] === "pr" && args[1] === "create") {
      createdBody = options.stdin ?? "";
      return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/457\n", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") {
      const at = args.indexOf("--add-label");
      if (at >= 0 && args[at + 1]) labels.push(args[at + 1]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ labels: labels.map((name) => ({ name })), body: createdBody }), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([{ name: "test", bucket: "pass" }]), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "merge") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

  const result = await runUpdate({
    applySet: applySet(repo.baseSha),
    targetPath: repo.target,
    mode: "auto",
    confirmationPhrase: PHRASE,
    recordPath: join(repo.root, "run-auto.jsonl"),
    workRoot: join(repo.root, "worktrees-auto"),
    catalog: catalog(),
    requiredChecks: ["test"],
    runCommand,
    runGh,
    now: () => "2026-06-10T12:00:00.000Z",
  });

  assert.equal(result.state, "merge_queued");
  const createCall = ghCalls.find((call) => call.args[0] === "pr" && call.args[1] === "create");
  assert.equal(createCall.args.includes("--draft"), false);
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "merge" && call.args.includes("--auto")), true);
});

test("runUpdate auto mode leaves the PR open when required checks are pending", async () => {
  const repo = await makeRepo();
  const ghCalls = [];
  let createdBody = "";
  const labels = [];
  const runGh = async (args, options = {}) => {
    ghCalls.push({ args, options });
    if (args[0] === "pr" && args[1] === "create") {
      createdBody = options.stdin ?? "";
      return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/458\n", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") {
      const at = args.indexOf("--add-label");
      if (at >= 0 && args[at + 1]) labels.push(args[at + 1]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "view") {
      return { code: 0, stdout: JSON.stringify({ labels: labels.map((name) => ({ name })), body: createdBody }), stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "checks") {
      return { code: 0, stdout: JSON.stringify([{ name: "test", bucket: "pending" }]), stderr: "" };
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };

  const result = await runUpdate({
    applySet: applySet(repo.baseSha),
    targetPath: repo.target,
    mode: "auto",
    confirmationPhrase: PHRASE,
    recordPath: join(repo.root, "run-auto-pending.jsonl"),
    workRoot: join(repo.root, "worktrees-auto-pending"),
    catalog: catalog(),
    requiredChecks: ["test"],
    runCommand,
    runGh,
    now: () => "2026-06-10T12:00:00.000Z",
  });

  assert.equal(result.state, "checks_pending");
  assert.deepEqual(result.autoMerge.reasons, ["required-check-not-passing:test"]);
  assert.equal(ghCalls.some((call) => call.args[0] === "pr" && call.args[1] === "merge"), false);
});

test("CLI refresh --intake --execute --local-only runs the PR lane from a completed DecisionDoc", async () => {
  const repo = await makeRepoWithRealGlobalUpdate();
  const runId = `run-cli-exec-${process.pid}-${Date.now()}`;
  const report = await refreshTarget({ targetPath: repo.target, now: "2026-06-10T12:00:00.000Z" });
  const doc = await buildDecisionDoc({ report, runId, now: "2026-06-10T12:00:00.000Z" });
  const targetItem = doc.items.find((item) => item.regionId === repo.record.id);
  assert.ok(targetItem, `expected decision item for ${repo.record.id}`);
  const completed = resolveOneApplyCentral(doc, targetItem.itemId);
  const docPath = join(repo.root, "completed-decision.json");
  await writeFile(docPath, JSON.stringify(completed), "utf8");

  const result = spawnSync(
    process.execPath,
    [
      BIN,
      "refresh",
      "--target",
      repo.target,
      "--intake",
      docPath,
      "--execute",
      "--local-only",
      "--confirm",
      confirmationPhraseForRun({ repoName: "consumer-repo", runId }),
      "--json",
    ],
    { env: process.env, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.state, "verified_local");
  assert.match(await readFile(join(payload.worktreePath, "AGENTS.md"), "utf8"), new RegExp(repo.record.distribution.body.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
