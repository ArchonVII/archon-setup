import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOnboardingDecision, intakeOnboardingDecision } from "../src/server/onboard/repairDecision.mjs";
import { runOnboardingRepair, verifyMergedOnboardingRepair } from "../src/server/onboard/repairRun.mjs";
import { readRunRecord } from "../src/server/prlane/runRecord.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function fixtureRepo() {
  const root = await mkdtemp(join(tmpdir(), "archon-onboarding-repair-run-"));
  const targetPath = join(root, "consumer-repo");
  const remotePath = join(root, "consumer-repo.git");
  await (await import("node:fs/promises")).mkdir(targetPath, { recursive: true });
  await writeFile(join(targetPath, "seed.txt"), "seed\n", "utf8");
  git(targetPath, ["init", "-b", "main"]);
  git(targetPath, ["config", "user.email", "agent@example.test"]);
  git(targetPath, ["config", "user.name", "Archon Agent"]);
  git(targetPath, ["add", "seed.txt"]);
  git(targetPath, ["commit", "-m", "chore: seed"]);
  git(root, ["init", "--bare", "-b", "main", remotePath]);
  git(targetPath, ["remote", "add", "origin", remotePath]);
  git(targetPath, ["push", "-u", "origin", "main"]);
  return { root, targetPath };
}

function resolved(doc) {
  return {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: { choice: "apply-central", decidedBy: "owner", decidedAt: "2026-07-10T00:00:00.000Z" },
    })),
  };
}

test("onboarding repair creates a draft PR from a fresh worktree and never queues a merge", async () => {
  const repo = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath: repo.targetPath, features: ["foundation.readme"], runId: "repair-run-1", owner: "ArchonVII", repo: "consumer-repo" });
  const intake = await intakeOnboardingDecision({ input: resolved(doc), targetPath: repo.targetPath });
  const recordPath = join(repo.root, "repair.jsonl");
  const ghCalls = [];
  const runGh = async (args, options = {}) => {
    ghCalls.push({ args, options });
    assert.deepEqual(args.slice(0, 2), ["pr", "create"]);
    return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/456\n", stderr: "" };
  };

  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 123,
    recordPath,
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh,
    now: () => "2026-07-10T00:00:00.000Z",
  });

  assert.equal(result.state, "pr_created");
  assert.equal(result.pr.number, 456);
  assert.match(git(repo.targetPath, ["ls-remote", "--heads", "origin", result.branch]), new RegExp(result.branch.replaceAll("/", "\\/")));
  assert.equal(ghCalls[0].args.includes("--draft"), true);
  assert.equal(ghCalls.some((call) => call.args.includes("merge")), false);
  assert.match(ghCalls[0].options.stdin, /Closes #123/);
  assert.match(ghCalls[0].options.stdin, /manual decisions: none/);

  const record = await readRunRecord(recordPath);
  assert.deepEqual(record.entries.map((entry) => entry.state), [
    "planned", "preflight_started", "preflight_passed", "issue_created", "worktree_created", "applied", "verified_local", "committed", "pushed", "pr_created",
  ]);
});

test("merged verification audits the fetched default branch rather than the source checkout", async () => {
  const repo = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath: repo.targetPath, features: ["foundation.readme"], runId: "repair-run-2", owner: "ArchonVII", repo: "consumer-repo" });
  const intake = await intakeOnboardingDecision({ input: resolved(doc), targetPath: repo.targetPath });
  const recordPath = join(repo.root, "repair.jsonl");
  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 123,
    recordPath,
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async () => ({ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/456\n", stderr: "" }),
  });

  git(repo.targetPath, ["fetch", "origin", result.branch]);
  git(repo.targetPath, ["merge", "--ff-only", result.branch]);
  git(repo.targetPath, ["push", "origin", "main"]);

  const verified = await verifyMergedOnboardingRepair({
    targetPath: repo.targetPath,
    recordPath,
    workRoot: join(repo.root, "verify-worktrees"),
    resolveRequiredChecks: async () => ({ status: "ok", checks: [] }),
  });

  assert.equal(verified.status, "partial_onboarding");
  assert.equal(verified.audit.onboardingCompletion.status, "incomplete");
  const record = await readRunRecord(recordPath);
  assert.deepEqual(record.entries.slice(-2).map((entry) => entry.state), ["merged", "verified_merged"]);
});
