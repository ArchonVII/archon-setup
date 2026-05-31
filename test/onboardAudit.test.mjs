import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { checkTargetPath } from "../src/server/preflight/checkTargetPath.mjs";

const execFileP = promisify(execFile);
const REPO_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

async function tempRoot(prefix = "archon-audit-") {
  return mkdtemp(join(tmpdir(), prefix));
}

function exists(root, rel) {
  return access(join(root, rel), constants.F_OK).then(
    () => true,
    () => false
  );
}

async function seedGitRepo(root) {
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await writeFile(join(root, "package.json"), "{\"name\":\"seeded\"}\n", "utf8");
}

function byPath(audit, path) {
  const item = audit.items.find((entry) => entry.path === path);
  assert.ok(item, `expected audit item for ${path}`);
  return item;
}

test("audit mode reports present, missing, and drifted baseline files without writing", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });

  const actionlint = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", ".github", "workflows", "actionlint.yml"),
    "utf8"
  );
  await writeFile(join(root, ".github", "workflows", "actionlint.yml"), actionlint, "utf8");
  await writeFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "legacy template\n", "utf8");

  const result = await runOnboard({
    targetPath: root,
    features: ["foundation.actionlint", "foundation.pr-template", "foundation.hooks"],
    audit: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "audit");
  assert.equal(byPath(result.audit, ".github/workflows/actionlint.yml").status, "present");
  assert.equal(byPath(result.audit, ".github/PULL_REQUEST_TEMPLATE.md").status, "drifted");
  assert.equal(byPath(result.audit, ".githooks/pre-commit").status, "missing");
  assert.equal(result.audit.summary.present, 1);
  assert.equal(result.audit.summary.drifted, 1);
  assert.ok(result.audit.summary.missing >= 1);

  assert.equal(await exists(root, ".githooks/pre-commit"), false, "audit must not create missing hooks");
  assert.equal(await exists(root, ".github/archon-setup.json"), false, "audit must not write the manifest");
  assert.equal(await readFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "utf8"), "legacy template\n");
});

test("onboard --audit is exposed by the CLI JSON contract", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, ".github", "workflows"), { recursive: true });

  const actionlint = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", ".github", "workflows", "actionlint.yml"),
    "utf8"
  );
  await writeFile(join(root, ".github", "workflows", "actionlint.yml"), actionlint, "utf8");

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.actionlint", "--audit", "--json"],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "audit");
  assert.equal(byPath(parsed.audit, ".github/workflows/actionlint.yml").status, "present");
});

test("target preflight can explicitly accept a populated existing repo", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const defaultResult = await checkTargetPath(root);
  assert.equal(defaultResult.status, "red");

  const existingResult = await checkTargetPath(root, { mode: "existing-repo" });
  assert.equal(existingResult.status, "green");
  assert.equal(existingResult.existingRepo, true);
  assert.equal(existingResult.willCreate, false);
  assert.match(existingResult.detail, /Existing repository ready/);
});
