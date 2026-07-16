import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOnboardingDecision, intakeOnboardingDecision } from "../src/server/onboard/repairDecision.mjs";
import { runOnboardingRepair, verifyMergedOnboardingRepair } from "../src/server/onboard/repairRun.mjs";
import { readRunRecord } from "../src/server/prlane/runRecord.mjs";
import { loadProfileFeatures, loadStartupBaseline } from "../src/server/tasks/startupBaseline.mjs";

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

test("onboarding repair generates the baseline from the full decision selection", async () => {
  const repo = await fixtureRepo();
  const selectedFeatures = await loadProfileFeatures("agent-standard");
  const doc = await buildOnboardingDecision({
    targetPath: repo.targetPath,
    features: selectedFeatures,
    runId: "repair-run-full-selection",
    owner: "ArchonVII",
    repo: "consumer-repo",
  });
  const selectivelyResolved = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice: item.feature === "foundation.agents" ? "apply-central" : "defer",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
      },
    })),
  };
  const intake = await intakeOnboardingDecision({ input: selectivelyResolved, targetPath: repo.targetPath });
  assert.deepEqual(intake.applyFeatures, ["foundation.agents"]);

  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 123,
    recordPath: join(repo.root, "repair-full-selection.jsonl"),
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async () => ({ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/456\n", stderr: "" }),
  });

  const baseline = JSON.parse(await readFile(join(result.worktreePath, ".agent", "startup-baseline.json"), "utf8"));
  assert.deepEqual(baseline, await loadStartupBaseline(intake.selectedFeatures));
  assert.equal(result.audit.audit.startupReadiness.profile, "agent-standard");
  const manifest = JSON.parse(await readFile(join(result.worktreePath, ".github", "archon-setup.json"), "utf8"));
  assert.deepEqual(manifest.selectedFeatures, intake.selectedFeatures);
  assert.equal(manifest.profile, "agent-standard");
});

test("repair honors non-apply-central resolutions inside an applied feature (#362)", async () => {
  const repo = await fixtureRepo();
  // Byte-exact comparison below: pin autocrlf so checkout-based restore does
  // not translate line endings on Windows hosts.
  git(repo.targetPath, ["config", "core.autocrlf", "false"]);
  // Drifted item in the SAME feature as apply-central items: the first real
  // patient (hudson-bend, decision issue #354) had local AGENTS.md content the
  // decision resolved keep-local, and the feature-level apply clobbered it.
  const localAgents = "# Local AGENTS\n\nRepo-specific rules that must survive the repair.\n";
  await writeFile(join(repo.targetPath, "AGENTS.md"), localAgents, "utf8");
  git(repo.targetPath, ["add", "AGENTS.md"]);
  git(repo.targetPath, ["commit", "-m", "docs: local agents contract"]);
  git(repo.targetPath, ["push", "origin", "main"]);

  const doc = await buildOnboardingDecision({
    targetPath: repo.targetPath,
    features: ["foundation.agents"],
    runId: "repair-run-mixed",
    owner: "ArchonVII",
    repo: "consumer-repo",
  });
  const agentsItem = doc.items.find((item) => item.path === "AGENTS.md");
  assert.equal(agentsItem?.status, "drifted");
  const mixed = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice:
          item.path === "AGENTS.md"
            ? "keep-local"
            : item.path === "docs/repo-update-log.md"
              ? "defer"
              : "apply-central",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
      },
    })),
  };
  const intake = await intakeOnboardingDecision({ input: mixed, targetPath: repo.targetPath });
  assert.equal(intake.ok, true);

  const ghCalls = [];
  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 321,
    recordPath: join(repo.root, "repair-mixed.jsonl"),
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async (args, options = {}) => {
      ghCalls.push({ args, options });
      return { code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/789\n", stderr: "" };
    },
  });

  // The mixed-resolution feature must still pass the post-apply gate.
  assert.equal(result.state, "pr_created");
  // keep-local: byte-identical to the local content.
  assert.equal(await readFile(join(result.worktreePath, "AGENTS.md"), "utf8"), localAgents);
  // defer on a missing item: the feature run writes it, the repair must not ship it.
  assert.equal(existsSync(join(result.worktreePath, "docs", "repo-update-log.md")), false);
  // The repair commit carries apply-central items only — no decision-overridden paths.
  const committed = git(result.worktreePath, ["show", "--name-only", "--format=", "HEAD"])
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(committed.includes("AGENTS.md"), false);
  assert.equal(committed.includes("docs/repo-update-log.md"), false);
  assert.equal(committed.includes("docs/agent-process/document-policy.md"), true);
  // PR body reports the manual decisions instead of "none".
  assert.match(ghCalls[0].options.stdin, /foundation\.agents:AGENTS\.md`: keep-local/);
  assert.match(ghCalls[0].options.stdin, /foundation\.agents:docs\/repo-update-log\.md`: defer/);
});

test("repair commit survives a tracked-modified file as the first status line (#364)", async () => {
  const repo = await fixtureRepo();
  // Pre-seed a committed manifest so the apply's manifest merge produces a
  // tracked-modified ` M .github/archon-setup.json` that sorts FIRST in
  // `git status --porcelain` — the stdout-trimmed first line used to lose its
  // leading space and parse as `github/archon-setup.json` (#364).
  const fsp = await import("node:fs/promises");
  await fsp.mkdir(join(repo.targetPath, ".github"), { recursive: true });
  await writeFile(join(repo.targetPath, ".github", "archon-setup.json"), JSON.stringify({ tool: "archon-setup", selectedFeatures: [] }, null, 2) + "\n", "utf8");
  git(repo.targetPath, ["add", ".github/archon-setup.json"]);
  git(repo.targetPath, ["commit", "-m", "chore: seed manifest"]);
  git(repo.targetPath, ["push", "origin", "main"]);

  const doc = await buildOnboardingDecision({ targetPath: repo.targetPath, features: ["foundation.readme"], runId: "repair-run-trim", owner: "ArchonVII", repo: "consumer-repo" });
  const intake = await intakeOnboardingDecision({ input: resolved(doc), targetPath: repo.targetPath });

  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 654,
    recordPath: join(repo.root, "repair-trim.jsonl"),
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async () => ({ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/111\n", stderr: "" }),
  });

  assert.equal(result.state, "pr_created");
  const committed = git(result.worktreePath, ["show", "--name-only", "--format=", "HEAD"])
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(committed.includes(".github/archon-setup.json"), true);
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
