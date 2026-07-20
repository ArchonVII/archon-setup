import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";

const execFileP = promisify(execFile);

test("git identity fixture restores author and committer values independently", async () => {
  const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const sentinels = {
    GIT_AUTHOR_NAME: "Author Before",
    GIT_AUTHOR_EMAIL: "author-before@example.invalid",
    GIT_COMMITTER_NAME: "Committer Before",
    GIT_COMMITTER_EMAIL: "committer-before@example.invalid",
  };
  Object.assign(process.env, sentinels);
  try {
    await withGitIdentity(async () => {});
    assert.deepEqual(Object.fromEntries(keys.map((key) => [key, process.env[key]])), sentinels);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function withGitIdentity(fn) {
  const before = {
    authorName: process.env.GIT_AUTHOR_NAME,
    authorEmail: process.env.GIT_AUTHOR_EMAIL,
    committerName: process.env.GIT_COMMITTER_NAME,
    committerEmail: process.env.GIT_COMMITTER_EMAIL,
  };
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
      GIT_AUTHOR_NAME: before.authorName,
      GIT_AUTHOR_EMAIL: before.authorEmail,
      GIT_COMMITTER_NAME: before.committerName,
      GIT_COMMITTER_EMAIL: before.committerEmail,
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

async function offlineGhFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "archon-doc-system-gh-"));
  const callsPath = join(fixtureRoot, "calls.jsonl");
  const preloadPath = join(fixtureRoot, "preload.mjs");
  await writeFile(preloadPath, [
    'import childProcess from "node:child_process";',
    'import { appendFileSync } from "node:fs";',
    'import { syncBuiltinESMExports } from "node:module";',
    'const realExecFileSync = childProcess.execFileSync;',
    'childProcess.execFileSync = (command, args = [], options = {}) => {',
    '  if (command !== "gh") return realExecFileSync(command, args, options);',
    '  const operation = `${args[0] || ""} ${args[1] || ""}`;',
    '  if (operation !== "pr list" && operation !== "issue list") {',
    '    throw new Error(`unexpected gh command in documentation execution test: ${args.join(" ")}`);',
    '  }',
    '  appendFileSync(process.env.ARCHON_DOCS_GH_CALLS, `${JSON.stringify(args)}\\n`);',
    '  return options.encoding ? "[]" : Buffer.from("[]");',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join("\n"));
  const importOption = `--import=${pathToFileURL(preloadPath).href}`;
  return {
    callsPath,
    env: {
      ...process.env,
      ARCHON_DOCS_GH_CALLS: callsPath,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, importOption].filter(Boolean).join(" "),
    },
  };
}

async function exerciseDocumentationFloor(root) {
  await execFileP("npm", ["run", "docs:render"], { cwd: root, shell: process.platform === "win32" });
  await execFileP("npm", ["run", "docs:render", "--", "--check"], { cwd: root, shell: process.platform === "win32" });
  const ghFixture = await offlineGhFixture();
  await execFileP("npm", ["run", "docs:status"], {
    cwd: root,
    env: ghFixture.env,
    shell: process.platform === "win32",
  });
  const status = await readFile(join(root, "docs", "STATUS.md"), "utf8");
  assert.match(status, /## Open PRs \(0, 0 draft\)/);
  assert.match(status, /## Open issues \(0\)/);
  assert.doesNotMatch(status, /snapshot failed:/);
  const ghCalls = (await readFile(ghFixture.callsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(ghCalls, [
    ["pr", "list", "--limit", "1000", "--json", "number,title,isDraft,url,labels"],
    ["issue", "list", "--limit", "1000", "--json", "number,title,labels,url"],
  ]);
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
