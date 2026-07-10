import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { executePlan } from "../src/server/executor/executePlan.mjs";
import { loadRegistry, buildPlan } from "../src/server/planner/buildPlan.mjs";
import * as installWorkflow from "../src/server/tasks/installWorkflow.mjs";
import * as writeAgentsMd from "../src/server/tasks/writeAgentsMd.mjs";
import * as writeChangelog from "../src/server/tasks/writeChangelog.mjs";
import * as writeCheckMap from "../src/server/tasks/writeCheckMap.mjs";
import * as writeClaudeMd from "../src/server/tasks/writeClaudeMd.mjs";
import * as writeCodeowners from "../src/server/tasks/writeCodeowners.mjs";
import * as writeCoordinationBoard from "../src/server/tasks/writeCoordinationBoard.mjs";
import * as writeCoordinationReadme from "../src/server/tasks/writeCoordinationReadme.mjs";
import * as writeDependabot from "../src/server/tasks/writeDependabot.mjs";
import * as writeGeminiMd from "../src/server/tasks/writeGeminiMd.mjs";
import * as writeGitattributes from "../src/server/tasks/writeGitattributes.mjs";
import * as writeGitignore from "../src/server/tasks/writeGitignore.mjs";
import * as writeGithooks from "../src/server/tasks/writeGithooks.mjs";
import * as writeLicense from "../src/server/tasks/writeLicense.mjs";
import * as writePrTemplate from "../src/server/tasks/writePrTemplate.mjs";
import * as writeReadme from "../src/server/tasks/writeReadme.mjs";

async function tempRoot(prefix = "archon-manifest-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function seed(root, relativePath, body = "existing\n") {
  await mkdir(dirname(join(root, relativePath)), { recursive: true });
  await writeFile(join(root, relativePath), body, "utf8");
}

function ctx(targetPath, overrides = {}) {
  return {
    targetPath,
    owner: "ArchonVII",
    account: "ArchonVII",
    repo: "example",
    visibility: "private",
    taskOptions: {},
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
    ...overrides,
  };
}

async function withFetchStub(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    async json() {
      if (String(url).includes("/licenses/")) return { body: "Existing License\n" };
      return { source: "node_modules/\n" };
    },
  });
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withGitIdentity(fn) {
  const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GIT_AUTHOR_NAME = "Archon Setup Test";
  process.env.GIT_AUTHOR_EMAIL = "archon-setup-test@example.invalid";
  process.env.GIT_COMMITTER_NAME = "Archon Setup Test";
  process.env.GIT_COMMITTER_EMAIL = "archon-setup-test@example.invalid";
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("tasks do not record existing files as created during apply", async () => {
  const cases = [
    { name: "writeReadme", task: writeReadme, files: ["README.md"] },
    { name: "writeLicense", task: writeLicense, files: ["LICENSE"], fetch: true },
    { name: "writeGitignore", task: writeGitignore, files: [".gitignore"], fetch: true },
    {
      name: "writeAgentsMd",
      task: writeAgentsMd,
      files: ["AGENTS.md", "docs/repo-update-log.md", ".agent/startup-baseline.json", "docs/plans/README.md", "docs/agent-process/document-policy.md", "docs/agent-process/message-protocol.md"],
    },
    { name: "writeClaudeMd", task: writeClaudeMd, files: ["CLAUDE.md"] },
    { name: "writeGeminiMd", task: writeGeminiMd, files: ["GEMINI.md"] },
    { name: "writeCheckMap", task: writeCheckMap, files: [".agent/check-map.yml"] },
    {
      name: "writeCoordinationReadme",
      task: writeCoordinationReadme,
      files: [".agent/coordination/README.md"],
    },
    {
      name: "writeCoordinationBoard",
      task: writeCoordinationBoard,
      files: [".agent/coordination/board.md"],
    },
    {
      name: "writeGithooks",
      task: writeGithooks,
      files: [
        ".githooks/commit-msg",
        ".githooks/pre-commit",
        ".githooks/scripts/install-githooks.sh",
        ".githooks/scripts/owner-maintenance.sh",
        ".githooks/scripts/test-owner-maintenance.sh",
        ".githooks/scripts/checkout-role.sh",
        ".githooks/scripts/checkout-doctor.sh",
        ".githooks/scripts/test-checkout-role.sh",
      ],
    },
    { name: "writeGitattributes", task: writeGitattributes, files: [".gitattributes"] },
    {
      name: "writeChangelog",
      task: writeChangelog,
      files: ["CHANGELOG.md"],
    },
    { name: "writeCodeowners", task: writeCodeowners, files: [".github/CODEOWNERS"] },
    { name: "writeDependabot", task: writeDependabot, files: [".github/dependabot.yml"] },
    {
      name: "writePrTemplate",
      task: writePrTemplate,
      files: [".github/PULL_REQUEST_TEMPLATE.md"],
    },
    {
      name: "installWorkflow",
      task: installWorkflow,
      files: [".github/workflows/actionlint.yml"],
      taskOptions: { workflowName: "actionlint", snapshotSource: "repo-template" },
    },
  ];

  for (const { name, task, files, taskOptions = {}, fetch = false } of cases) {
    const root = await tempRoot();
    for (const file of files) await seed(root, file);
    const taskCtx = ctx(root, { taskOptions });
    const run = () => task.apply(taskCtx);

    if (fetch) await withFetchStub(run);
    else await run();

    assert.deepEqual(taskCtx.manifest.createdFiles, [], `${name} should not over-report created files`);
  }
});

test("tasks record only the files actually written during a mixed apply", async () => {
  const root = await tempRoot();
  await seed(root, "AGENTS.md");
  const taskCtx = ctx(root);

  await writeAgentsMd.apply(taskCtx);

  assert.deepEqual(taskCtx.manifest.createdFiles, [
    {
      path: "docs/repo-update-log.md",
      source: "snapshot:repo-template/docs/repo-update-log.md",
    },
    {
      path: ".agent/startup-baseline.json",
      source: "snapshot:repo-template/.agent/startup-baseline.json",
    },
    {
      path: "docs/plans/README.md",
      source: "snapshot:repo-template/docs/plans/README.md",
    },
    {
      path: "docs/agent-process/document-policy.md",
      source: "snapshot:repo-template/docs/agent-process/document-policy.md",
    },
    {
      path: "docs/agent-process/message-protocol.md",
      source: "snapshot:repo-template/docs/agent-process/message-protocol.md",
    },
  ]);
});

test("executing the same local setup plan twice reports existing files as already-done or skipped", async () => {
  const root = await tempRoot();
  const { features } = await loadRegistry();
  const selection = features
    .filter((feature) => feature.default && !feature.remoteRequirement)
    .map((feature) => feature.id);
  const planInput = {
    selection,
    options: { license: { spdx: "MIT" }, gitignore: { language: "Node" } },
    context: {
      targetPath: root,
      owner: "",
      repo: "example",
      visibility: "private",
      capabilities: {},
    },
  };

  await withFetchStub(() => withGitIdentity(async () => {
    const firstPlan = await buildPlan(planInput);
    const first = await executePlan(firstPlan);
    assert.equal(first.ok, true);

    const secondPlan = await buildPlan(planInput);
    const second = await executePlan(secondPlan);

    assert.equal(second.ok, true);
    assert.ok(second.results.every((result) => ["already-done", "skipped"].includes(result.status)));
    assert.deepEqual(second.manifest.createdFiles, []);
    assert.deepEqual(second.manifest.skippedFiles, []);
  }));
});
