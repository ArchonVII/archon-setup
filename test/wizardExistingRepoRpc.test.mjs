import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { RPC } from "../src/server/rpc.mjs";

const execFileP = promisify(execFile);
const REPO_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function tempRoot(prefix = "archon-wizard-existing-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function seedGitRepo(root) {
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await writeFile(join(root, "package.json"), "{\"name\":\"seeded\"}\n", "utf8");
  await execFileP("git", ["-C", root, "remote", "add", "origin", "git@github.com:ArchonVII/example.git"]);
}

function byPath(audit, path) {
  const item = audit.items.find((entry) => entry.path === path);
  assert.ok(item, `expected audit item for ${path}`);
  return item;
}

test("wizard RPC accepts populated git repos in existing-repo preflight mode", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const pre = await RPC["preflight.run"]({ target: root, targetMode: "existing-repo" });
  const target = pre.checks.find((check) => check.id === "target");

  assert.equal(target.status, "green");
  assert.equal(target.existingRepo, true);
  assert.equal(target.willCreate, false);
  assert.deepEqual(pre.originDetected, { owner: "ArchonVII", repo: "example" });
});

test("wizard RPC audits the shared existing-repo plan without writing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });

  const prPolicy = await readFile(
    join(REPO_ROOT, "src", "snapshots", "github-workflows", "pr-policy.yml"),
    "utf8"
  );
  await writeFile(join(root, ".github", "workflows", "pr-policy.yml"), prPolicy, "utf8");
  await writeFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "legacy template\n", "utf8");

  const pre = await RPC["preflight.run"]({ target: root, targetMode: "existing-repo" });
  const plan = await RPC["plan.build"]({
    selection: ["foundation.actionlint", "foundation.pr-template", "workflow.pr-policy"],
    options: {},
    context: {
      targetPath: root,
      owner: "",
      repo: "",
      visibility: "private",
      capabilities: pre.capabilities,
      account: pre.capabilities.account,
      originDetected: pre.originDetected,
      sourceSnapshots: {},
    },
  });
  const audit = await RPC["plan.audit"]({ plan });

  assert.equal(byPath(audit, ".github/workflows/pr-policy.yml").status, "present");
  assert.equal(byPath(audit, ".github/PULL_REQUEST_TEMPLATE.md").status, "drifted");
  assert.equal(byPath(audit, ".github/workflows/actionlint.yml").status, "missing");
  assert.equal(audit.summary.present, 1);
  assert.equal(audit.summary.drifted, 1);
  assert.equal(audit.summary.missing, 1);
});

test("wizard plan targets labels and protection for an existing origin without repo creation", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const pre = await RPC["preflight.run"]({ target: root, targetMode: "existing-repo" });

  const plan = await RPC["plan.build"]({
    selection: ["workflow.required-gate", "remote.labels", "remote.branch-protection"],
    options: {},
    context: {
      targetPath: root,
      owner: "",
      repo: "",
      visibility: "private",
      capabilities: pre.capabilities,
      account: pre.capabilities.account,
      originDetected: pre.originDetected,
      sourceSnapshots: {},
    },
  });

  assert.equal(plan.context.githubRepoTarget.status, "known");
  assert.equal(plan.context.owner, "ArchonVII");
  assert.equal(plan.context.repo, "example");
  assert.ok(plan.ordered.some((unit) => unit.taskId === "applyLabels"));
  assert.ok(plan.ordered.some((unit) => unit.taskId === "applyBaselineBranchProtection"));
  assert.ok(!plan.ordered.some((unit) => unit.taskId === "ghRepoCreateAndPush"));
});
