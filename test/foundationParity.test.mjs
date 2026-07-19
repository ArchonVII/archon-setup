import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

const execFileP = promisify(execFile);

const OPTIONAL_FOUNDATION_IDS = [
  "foundation.hooks",
  "foundation.friction-ledger",
  "foundation.changelog",
  "foundation.actionlint",
  "foundation.codeowners",
  "foundation.dependabot",
  "foundation.pr-template",
];

const LOCAL_BASELINE_FILES = [
  "README.md",
  "LICENSE",
  ".gitignore",
  ".claude/friction.md",
  "AGENTS.md",
  "docs/repo-update-log.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".agent/coordination/README.md",
  ".githooks/commit-msg",
  ".githooks/pre-commit",
  ".githooks/scripts/install-githooks.sh",
  ".githooks/scripts/owner-maintenance.sh",
  ".githooks/scripts/test-owner-maintenance.sh",
  ".githooks/scripts/checkout-role.sh",
  ".githooks/scripts/checkout-doctor.sh",
  ".githooks/scripts/test-checkout-role.sh",
  ".gitattributes",
  "CHANGELOG.md",
  ".github/workflows/actionlint.yml",
  ".github/dependabot.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

const FORBIDDEN_OUTPUT_PATTERNS = [
  /hudson-bend/i,
  /pigafetta/i,
  /\bskills\b/i,
  /jma-history/i,
  /F18/,
  /\bF19\b/,
  /repo-template#16/,
  /docs\/phase2\/hook-authority\.md/,
  /docs\/adr\/001-primary-checkout-worktree-policy\.md/,
];

async function tempRoot(prefix = "archon-foundation-") {
  return mkdtemp(join(tmpdir(), prefix));
}

function ctx(targetPath, overrides = {}) {
  return {
    targetPath,
    owner: "octocat",
    account: "octocat",
    repo: "example",
    visibility: "private",
    taskOptions: {},
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
    ...overrides,
  };
}

async function assertFilesExist(root, files) {
  const missing = [];
  for (const file of files) {
    try {
      await readFile(join(root, file), "utf8");
    } catch {
      missing.push(file);
    }
  }
  assert.deepEqual(missing, []);
}

test("optional foundation add-ons remain available without bloating the default setup", async () => {
  const { loadRegistry, buildPlan } = await import("../src/server/planner/buildPlan.mjs");
  const { features } = await loadRegistry();
  const byId = new Map(features.map((feature) => [feature.id, feature]));

  for (const id of OPTIONAL_FOUNDATION_IDS) {
    const feature = byId.get(id);
    assert.ok(feature, `${id} should be registered`);
    assert.equal(feature.group, "foundations");
    assert.equal(feature.default, false, `${id} should be opt-in`);
    assert.ok(!feature.locked, `${id} should not be locked`);
    assert.deepEqual(feature.capabilitiesNeeded || [], [], `${id} should not require remote capabilities`);
  }

  const explicitSelection = [
    "foundation.readme",
    "foundation.license",
    "foundation.gitignore",
    "foundation.agents",
    "foundation.claude-md",
    "foundation.gemini-md",
    "foundation.coordination",
    "foundation.gitattributes",
    ...OPTIONAL_FOUNDATION_IDS,
  ];

  const planWithoutOwner = await buildPlan({
    selection: explicitSelection,
    options: {},
    context: { targetPath: "X", owner: "", repo: "r", visibility: "private", capabilities: {} },
  });

  const plannedPaths = new Set(planWithoutOwner.files.map((file) => file.path));
  for (const file of LOCAL_BASELINE_FILES) {
    assert.ok(plannedPaths.has(file), `expected local baseline plan to create ${file}`);
  }
  assert.deepEqual(
    planWithoutOwner.ordered.find((unit) => unit.featureId === "foundation.actionlint"),
    {
      featureId: "foundation.actionlint",
      taskId: "installWorkflow",
      options: { workflowName: "actionlint", snapshotSource: "repo-template" },
    }
  );
  assert.ok(!plannedPaths.has(".github/CODEOWNERS"), "CODEOWNERS should not be planned without a real owner");
  assert.deepEqual(planWithoutOwner.skippedFiles, [
    { path: ".github/CODEOWNERS", reason: "owner unknown" },
  ]);

  const planWithOwner = await buildPlan({
    selection: explicitSelection,
    options: {},
    context: { targetPath: "X", owner: "ArchonVII", repo: "r", visibility: "private", capabilities: {} },
  });
  assert.ok(
    planWithOwner.files.some((file) => file.path === ".github/CODEOWNERS"),
    "CODEOWNERS should be planned when an owner is known"
  );
});

test("writeGithooks copies scrubbed repo-template hooks", async () => {
  const root = await tempRoot();
  const task = await import("../src/server/tasks/writeGithooks.mjs");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  await assertFilesExist(root, [
    ".githooks/commit-msg",
    ".githooks/pre-commit",
    ".githooks/scripts/install-githooks.sh",
    ".githooks/scripts/owner-maintenance.sh",
    ".githooks/scripts/test-owner-maintenance.sh",
    ".githooks/scripts/checkout-role.sh",
    ".githooks/scripts/checkout-doctor.sh",
    ".githooks/scripts/test-checkout-role.sh",
  ]);

  if (process.platform !== "win32") {
    for (const file of [
      ".githooks/commit-msg",
      ".githooks/pre-commit",
      ".githooks/scripts/install-githooks.sh",
      ".githooks/scripts/owner-maintenance.sh",
      ".githooks/scripts/test-owner-maintenance.sh",
      ".githooks/scripts/checkout-role.sh",
      ".githooks/scripts/checkout-doctor.sh",
      ".githooks/scripts/test-checkout-role.sh",
    ]) {
      assert.equal((await stat(join(root, file))).mode & 0o777, 0o755, `${file} should be executable`);
    }
  }

  const hookFiles = await readdir(join(root, ".githooks"), { recursive: true });
  for (const file of hookFiles.filter((name) => typeof name === "string")) {
    if (!(await stat(join(root, ".githooks", file))).isFile()) continue;
    const body = await readFile(join(root, ".githooks", file), "utf8");
    for (const pattern of FORBIDDEN_OUTPUT_PATTERNS) {
      assert.doesNotMatch(body, pattern, `${file} should not contain ${pattern}`);
    }
  }
});

test("writeGitattributes writes the repo-template attributes file", async () => {
  const root = await tempRoot();
  const task = await import("../src/server/tasks/writeGitattributes.mjs");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  const body = await readFile(join(root, ".gitattributes"), "utf8");
  assert.match(body, /\*\.sh\s+text eol=lf/);
  assert.match(body, /\.githooks\/\*\s+text eol=lf/);
});

test("writeChangelog writes the release-class changelog baseline", async () => {
  const root = await tempRoot();
  const task = await import("../src/server/tasks/writeChangelog.mjs");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  const changelog = await readFile(join(root, "CHANGELOG.md"), "utf8");
  assert.match(changelog, /Keep a Changelog/i);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["docs:changelog"], "node scripts/docs/changelog.mjs");
  assert.equal(await task.check(taskCtx), "already-done");
  const before = await readFile(join(root, "package.json"), "utf8");
  await task.apply(taskCtx);
  assert.equal(await readFile(join(root, "package.json"), "utf8"), before);
});

test("writeCodeowners writes a known owner and records an intentional skip without one", async () => {
  const ownedRoot = await tempRoot();
  const skippedRoot = await tempRoot();
  const task = await import("../src/server/tasks/writeCodeowners.mjs");

  const ownedCtx = ctx(ownedRoot, { owner: "ArchonVII" });
  await task.apply(ownedCtx);
  assert.deepEqual(await task.verify(ownedCtx), { ok: true });
  assert.equal(await readFile(join(ownedRoot, ".github/CODEOWNERS"), "utf8"), "* @ArchonVII\n");

  const skippedCtx = ctx(skippedRoot, { owner: "", account: "" });
  await task.apply(skippedCtx);
  assert.deepEqual(await task.verify(skippedCtx), { ok: true });
  assert.deepEqual(skippedCtx.manifest.skippedFiles, [
    { path: ".github/CODEOWNERS", reason: "owner unknown" },
  ]);
});

test("writeDependabot and writePrTemplate copy repo-template baseline files", async () => {
  const root = await tempRoot();
  const dependabot = await import("../src/server/tasks/writeDependabot.mjs");
  const prTemplate = await import("../src/server/tasks/writePrTemplate.mjs");
  const taskCtx = ctx(root);

  await dependabot.apply(taskCtx);
  await prTemplate.apply(taskCtx);

  assert.deepEqual(await dependabot.verify(taskCtx), { ok: true });
  assert.deepEqual(await prTemplate.verify(taskCtx), { ok: true });
  const dependabotBody = await readFile(join(root, ".github/dependabot.yml"), "utf8");
  const prBody = await readFile(join(root, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8");
  assert.match(dependabotBody, /package-ecosystem:\s*"?github-actions"?/);
  assert.match(dependabotBody, /interval:\s*"?weekly"?/);
  assert.match(prBody, /## Verification/);
});

test("installWorkflow can install the repo-template actionlint caller without a remote", async () => {
  const root = await tempRoot();
  const task = await import("../src/server/tasks/installWorkflow.mjs");
  const taskCtx = ctx(root, {
    taskOptions: { workflowName: "actionlint", snapshotSource: "repo-template" },
  });

  await task.apply(taskCtx);
  assert.deepEqual(await task.verify(taskCtx), { ok: true });
  const body = await readFile(join(root, ".github/workflows/actionlint.yml"), "utf8");
  assert.match(body, /ArchonVII\/github-workflows\/\.github\/workflows\/actionlint\.yml@v1/);
  assert.doesNotMatch(body, /\b(node|python|npm|pnpm|uv|pytest|ruff)\b/i);
});

test("checkHooksPath warns on a custom hooksPath", async () => {
  const root = await tempRoot();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "config", "core.hooksPath", "custom-hooks"]);

  const { checkHooksPath } = await import("../src/server/preflight/checkHooksPath.mjs");
  const result = await checkHooksPath(root);

  assert.equal(result.id, "hooksPath");
  assert.equal(result.status, "yellow");
  assert.match(result.detail, /custom-hooks/);
});

test("initGitAndCommit activates .githooks when hooksPath is unset", async () => {
  const root = await tempRoot();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  await execFileP("git", ["-C", root, "config", "user.name", "Test User"]);
  await mkdir(join(root, ".githooks"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Test\n", "utf8");

  const task = await import("../src/server/tasks/initGitAndCommit.mjs");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);

  const { stdout } = await execFileP("git", ["-C", root, "config", "--get", "core.hooksPath"]);
  assert.equal(stdout.trim(), ".githooks");
  await rm(root, { recursive: true, force: true });
});

test("initGitAndCommit leaves hooksPath unset when hooks were not installed", async () => {
  const root = await tempRoot();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  await execFileP("git", ["-C", root, "config", "user.name", "Test User"]);
  await writeFile(join(root, "README.md"), "# Test\n", "utf8");

  const task = await import("../src/server/tasks/initGitAndCommit.mjs");
  const taskCtx = ctx(root);

  await task.apply(taskCtx);

  await assert.rejects(
    execFileP("git", ["-C", root, "config", "--get", "core.hooksPath"]),
    /Command failed/
  );
  await rm(root, { recursive: true, force: true });
});
