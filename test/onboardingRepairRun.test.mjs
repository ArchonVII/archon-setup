import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOnboardingDecision, intakeOnboardingDecision } from "../src/server/onboard/repairDecision.mjs";
import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
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

test("onboarding repair persists manifest-only owner decisions without applying defaults", async () => {
  const repo = await fixtureRepo();
  const doc = await buildOnboardingDecision({
    targetPath: repo.targetPath,
    features: ["foundation.readme"],
    runId: "repair-run-manifest-only",
    owner: "ArchonVII",
    repo: "consumer-repo",
  });
  const decision = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice: "declined",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
        review: null,
      },
    })),
  };
  const intake = await intakeOnboardingDecision({ input: decision, targetPath: repo.targetPath });
  assert.deepEqual(intake.applyFeatures, []);
  assert.deepEqual(intake.effectiveSelectedFeatures, []);

  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 123,
    recordPath: join(repo.root, "repair-manifest-only.jsonl"),
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async () => ({ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/456\n", stderr: "" }),
  });

  assert.equal(result.state, "pr_created");
  assert.equal(existsSync(join(result.worktreePath, "README.md")), false);
  const manifest = JSON.parse(await readFile(join(result.worktreePath, ".github", "archon-setup.json"), "utf8"));
  assert.deepEqual(manifest.selectedFeatures, []);
  assert.equal(manifest.onboardingDispositions.items[0].choice, "declined");
  assert.equal(result.audit.audit.onboardingCompletion.manifestStatus, "complete");
  assert.deepEqual(result.audit.audit.onboardingCompletion.manifestMissingFeatures, []);
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
        review: item.feature === "foundation.agents"
          ? null
          : { trigger: "review when the deferred capability is scheduled" },
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
        review: item.path === "docs/repo-update-log.md"
          ? { expiresAt: "2000-01-01T00:00:00.000Z" }
          : null,
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
  assert.doesNotMatch(
    await readFile(join(result.worktreePath, "docs", "INDEX.md"), "utf8"),
    /repo-update-log\.md/,
    "selection-aware seeds must not link a missing deferred path"
  );
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
  assert.equal(
    result.audit.audit.items.find((item) => item.path === "AGENTS.md")?.disposition?.state,
    "accepted"
  );
  assert.equal(
    result.audit.audit.dispositions.find((item) => item.path === "docs/repo-update-log.md")?.state,
    "expired"
  );
  assert.match(
    result.audit.audit.onboardingCompletion.blockers.join("\n"),
    /onboarding disposition expired: foundation\.agents:docs\/repo-update-log\.md/
  );
  const acceptedDecision = await buildOnboardingDecision({
    targetPath: result.worktreePath,
    features: intake.effectiveSelectedFeatures,
    runId: "repair-run-mixed-follow-up",
  });
  assert.equal(acceptedDecision.items.some((item) => item.path === "AGENTS.md"), false);
  assert.equal(acceptedDecision.items.some((item) => item.path === "docs/repo-update-log.md"), true);

  await writeFile(join(result.worktreePath, "AGENTS.md"), `${localAgents}\nNew unapproved policy.\n`, "utf8");
  const staleAudit = await runOnboard({
    targetPath: result.worktreePath,
    features: intake.effectiveSelectedFeatures,
    audit: true,
  });
  assert.equal(
    staleAudit.audit.items.find((item) => item.path === "AGENTS.md")?.disposition?.state,
    "stale"
  );
  assert.match(
    staleAudit.audit.onboardingCompletion.blockers.join("\n"),
    /onboarding disposition stale: foundation\.agents:AGENTS\.md/
  );
  const staleDecision = await buildOnboardingDecision({
    targetPath: result.worktreePath,
    features: intake.effectiveSelectedFeatures,
    runId: "repair-run-mixed-stale-follow-up",
  });
  assert.equal(staleDecision.items.some((item) => item.path === "AGENTS.md"), true);
});

test("repair persists declined capabilities and decision provenance in the setup manifest", async () => {
  const repo = await fixtureRepo();
  const doc = await buildOnboardingDecision({
    targetPath: repo.targetPath,
    features: ["foundation.readme", "foundation.license"],
    runId: "repair-run-declined",
    owner: "ArchonVII",
    repo: "consumer-repo",
  });
  const decision = {
    ...doc,
    items: doc.items.map((item) => ({
      ...item,
      resolution: {
        choice: item.feature === "foundation.license" ? "declined" : "apply-central",
        decidedBy: "owner",
        decidedAt: "2026-07-10T00:00:00.000Z",
        review: null,
      },
    })),
  };
  const intake = await intakeOnboardingDecision({ input: decision, targetPath: repo.targetPath });

  const result = await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 777,
    recordPath: join(repo.root, "repair-declined.jsonl"),
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async () => ({ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/778\n", stderr: "" }),
    now: () => "2026-07-10T01:00:00.000Z",
  });

  const manifest = JSON.parse(await readFile(join(result.worktreePath, ".github", "archon-setup.json"), "utf8"));
  assert.deepEqual(manifest.selectedFeatures, ["foundation.readme"]);
  assert.equal(manifest.onboardingDispositions.schemaVersion, 1);
  const declined = manifest.onboardingDispositions.items.find((item) => item.choice === "declined");
  assert.deepEqual(declined.decisionSource, {
    type: "github-issue",
    owner: "ArchonVII",
    repo: "consumer-repo",
    number: 777,
    url: "https://github.com/ArchonVII/consumer-repo/issues/777",
  });
  assert.equal(declined.runId, "repair-run-declined");
  assert.equal(declined.baseSha, intake.baseSha);
  assert.equal(result.audit.audit.dispositions.find((item) => item.choice === "declined")?.state, "declined");
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
  assert.equal(verified.selectionValidation.ok, true);
  assert.deepEqual(verified.selectionValidation.findings, []);
  assert.equal(verified.audit.onboardingCompletion.status, "incomplete");
  const record = await readRunRecord(recordPath);
  assert.deepEqual(record.entries.slice(-2).map((entry) => entry.state), ["merged", "verified_merged"]);
});

test("merged verification recognizes a squash merge of the repair PR (#367)", async () => {
  const repo = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath: repo.targetPath, features: ["foundation.readme"], runId: "repair-run-squash", owner: "ArchonVII", repo: "consumer-repo" });
  const intake = await intakeOnboardingDecision({ input: resolved(doc), targetPath: repo.targetPath });
  const recordPath = join(repo.root, "repair-squash.jsonl");
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

  // Simulate GitHub's squash merge — the ecosystem's standard merge method:
  // commit the PR branch's tree as a single NEW commit on the bare origin's
  // main. The rewritten commit means the PR head is not an ancestor of main.
  const prHeadSha = git(repo.targetPath, ["rev-parse", result.branch]);
  const baseSha = git(repo.targetPath, ["rev-parse", "origin/main"]);
  const squashTree = git(repo.targetPath, ["rev-parse", `${result.branch}^{tree}`]);
  const squashSha = git(repo.targetPath, ["commit-tree", squashTree, "-p", baseSha, "-m", "feat(onboarding): repair #123 (squash)"]);
  git(repo.targetPath, ["push", "origin", `${squashSha}:refs/heads/main`]);
  // Fixture sanity: the squash rewrote the commit, so the PR head must NOT be
  // an ancestor of the squashed main (merge-base --is-ancestor exits non-zero).
  assert.throws(() => git(repo.targetPath, ["merge-base", "--is-ancestor", prHeadSha, squashSha]));

  const ghCalls = [];
  const verified = await verifyMergedOnboardingRepair({
    targetPath: repo.targetPath,
    recordPath,
    workRoot: join(repo.root, "verify-worktrees"),
    resolveRequiredChecks: async () => ({ status: "ok", checks: [] }),
    runGh: async (args) => {
      ghCalls.push(args);
      return { code: 0, stdout: JSON.stringify({ state: "MERGED", mergeCommit: { oid: squashSha } }), stderr: "" };
    },
  });

  assert.equal(verified.status, "partial_onboarding");
  assert.equal(verified.selectionValidation.ok, true);
  assert.equal(verified.audit.onboardingCompletion.status, "incomplete");
  assert.deepEqual(ghCalls, [["pr", "view", "456", "--repo", "ArchonVII/consumer-repo", "--json", "state,mergeCommit"]]);
  const record = await readRunRecord(recordPath);
  assert.deepEqual(record.entries.slice(-2).map((entry) => entry.state), ["merged", "verified_merged"]);
});

test("merged verification stays blocked when the PR is neither an ancestor nor recorded MERGED (#367)", async () => {
  const repo = await fixtureRepo();
  const doc = await buildOnboardingDecision({ targetPath: repo.targetPath, features: ["foundation.readme"], runId: "repair-run-open", owner: "ArchonVII", repo: "consumer-repo" });
  const intake = await intakeOnboardingDecision({ input: resolved(doc), targetPath: repo.targetPath });
  const recordPath = join(repo.root, "repair-open.jsonl");
  await runOnboardingRepair({
    intake,
    targetPath: repo.targetPath,
    sourceIssueNumber: 123,
    recordPath,
    workRoot: join(repo.root, "worktrees"),
    owner: "ArchonVII",
    repo: "consumer-repo",
    runGh: async () => ({ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/456\n", stderr: "" }),
  });

  // No merge of any kind happened; the PR metadata still reports OPEN, so the
  // squash fallback must not report merged.
  const verified = await verifyMergedOnboardingRepair({
    targetPath: repo.targetPath,
    recordPath,
    workRoot: join(repo.root, "verify-worktrees"),
    resolveRequiredChecks: async () => ({ status: "ok", checks: [] }),
    runGh: async () => ({ code: 0, stdout: JSON.stringify({ state: "OPEN", mergeCommit: null }), stderr: "" }),
  });

  assert.equal(verified.status, "blocked");
  assert.match(verified.reason, /not merged/);
  const record = await readRunRecord(recordPath);
  assert.equal(record.entries.some((entry) => entry.state === "merged"), false);
});
