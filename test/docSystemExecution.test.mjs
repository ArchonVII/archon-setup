import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";

const execFileP = promisify(execFile);

async function withGitIdentity(fn) {
  const before = { name: process.env.GIT_AUTHOR_NAME, email: process.env.GIT_AUTHOR_EMAIL };
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "Archon Setup Test",
    GIT_AUTHOR_EMAIL: "archon-setup@example.invalid",
    GIT_COMMITTER_NAME: "Archon Setup Test",
    GIT_COMMITTER_EMAIL: "archon-setup@example.invalid",
  });
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries({
      GIT_AUTHOR_NAME: before.name,
      GIT_AUTHOR_EMAIL: before.email,
      GIT_COMMITTER_NAME: before.name,
      GIT_COMMITTER_EMAIL: before.email,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function onboardConsumer(features, name) {
  const root = await mkdtemp(join(tmpdir(), "archon-doc-system-execution-"));
  const originalFetch = globalThis.fetch;
  const originalGitignoreBody = process.env.ARCHON_GITIGNORE_BODY_JSON;
  globalThis.fetch = async (input) => {
    throw new Error(`unexpected network request in documentation execution test: ${input}`);
  };
  process.env.ARCHON_GITIGNORE_BODY_JSON = JSON.stringify({ Node: "node_modules/\n" });
  let result;
  try {
    result = await withGitIdentity(() => runOnboard({
      targetPath: root,
      features: [...features, "foundation.git-init"],
      owner: "ArchonVII",
      repo: name,
    }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGitignoreBody === undefined) delete process.env.ARCHON_GITIGNORE_BODY_JSON;
    else process.env.ARCHON_GITIGNORE_BODY_JSON = originalGitignoreBody;
  }
  assert.equal(result.ok, true, JSON.stringify(result.blockingWarnings || []));
  return root;
}

async function exerciseDocumentationFloor(root) {
  await execFileP("npm", ["run", "docs:render"], { cwd: root, shell: process.platform === "win32" });
  await execFileP("npm", ["run", "docs:render", "--", "--check"], { cwd: root, shell: process.platform === "win32" });
  await execFileP("npm", ["run", "docs:status"], { cwd: root, shell: process.platform === "win32" });
  const health = await execFileP(process.execPath, ["scripts/doc-health/health.mjs", "--repo", ".", "--json"], { cwd: root });
  const report = JSON.parse(health.stdout);
  assert.equal(report.summary.blocking, 0, health.stdout);
}

test("minimum documentation consumer can execute every command it declares", async () => {
  const root = await onboardConsumer(["foundation.doc-system"], "doc-system-minimum-consumer");

  await exerciseDocumentationFloor(root);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["docs:changelog"], undefined);
  const docMap = await readFile(join(root, ".agent", "doc-map.yml"), "utf8");
  assert.doesNotMatch(docMap, /generator: "docs:changelog"/);
});

test("changelog extension owns and executes the release command", async () => {
  const root = await onboardConsumer(
    ["foundation.doc-system", "foundation.changelog"],
    "doc-system-release-consumer"
  );

  await exerciseDocumentationFloor(root);
  await execFileP("npm", ["run", "docs:changelog"], { cwd: root, shell: process.platform === "win32" });
  await execFileP("npm", ["run", "docs:changelog", "--", "--check"], { cwd: root, shell: process.platform === "win32" });

  const docMap = await readFile(join(root, ".agent", "doc-map.yml"), "utf8");
  assert.match(docMap, /generator: "docs:render"/);
  assert.match(docMap, /generator: "docs:status"/);
  assert.match(docMap, /generator: "docs:changelog"/);
});
