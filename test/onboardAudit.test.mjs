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

test("onboard --audit reports warning-level startup readiness in JSON", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  await mkdir(join(root, "docs", "superpowers", "plans"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Local agent guide\n\n## Workflow\n\nOld process.\n", "utf8");

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit", "--json"],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "audit");
  assert.equal(parsed.audit.startupReadiness.status, "incomplete");
  assert.equal(parsed.audit.startupReadiness.baselineVersion, "2026-06-08-agent-start-map");
  assert.ok(parsed.audit.startupReadiness.missing.includes("docs/plans/README.md"));
  assert.ok(parsed.audit.startupReadiness.stale.includes("AGENTS.md"));
  assert.ok(parsed.audit.startupReadiness.legacyDetected.includes("docs/superpowers/plans/"));
  assert.match(parsed.audit.startupReadiness.repairCommand, /onboard\.mjs .* --dry-run/);
});

test("startup readiness accepts repo-specific AGENTS when the managed start map is current", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);
  const snapshotAgents = await readFile(join(REPO_ROOT, "src", "snapshots", "repo-template", "AGENTS.md"), "utf8");
  const startMap = snapshotAgents.match(/<!-- BEGIN MANAGED AGENT START MAP -->[\s\S]*?<!-- END MANAGED AGENT START MAP -->/)[0];
  const startupBaseline = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", ".agent", "startup-baseline.json"),
    "utf8"
  );
  const plansReadme = await readFile(
    join(REPO_ROOT, "src", "snapshots", "repo-template", "docs", "plans", "README.md"),
    "utf8"
  );

  await mkdir(join(root, ".agent", "coordination"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  await mkdir(join(root, "docs", "plans"), { recursive: true });
  await mkdir(join(root, "docs", "agent-process"), { recursive: true });
  await mkdir(join(root, "scripts", "agent"), { recursive: true });
  await mkdir(join(root, "scripts", "doc-sweep"), { recursive: true });
  await writeFile(
    join(root, "AGENTS.md"),
    `# Local agent guide\n\n<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->\n${startMap}\n<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->\n\n## Local workflow\n\nKeep repo-specific rules.\n`,
    "utf8"
  );
  await writeFile(join(root, ".agent", "startup-baseline.json"), startupBaseline, "utf8");
  await writeFile(join(root, "docs", "plans", "README.md"), plansReadme, "utf8");
  await writeFile(join(root, "docs", "repo-update-log.md"), "# Repository Update Log\n\nLocal entries.\n", "utf8");
  await writeFile(join(root, ".agent", "check-map.yml"), "version: 1\n", "utf8");
  await writeFile(join(root, ".agent", "coordination", "README.md"), "# Coordination\n", "utf8");
  await writeFile(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Summary\n", "utf8");

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit", "--json"],
    { cwd: REPO_ROOT }
  );
  const parsed = JSON.parse(stdout);

  assert.equal(parsed.audit.startupReadiness.status, "complete");
  assert.deepEqual(parsed.audit.startupReadiness.missing, []);
  assert.deepEqual(parsed.audit.startupReadiness.stale, []);
  assert.ok(parsed.audit.startupReadiness.present.includes("AGENTS.md"));
  assert.ok(parsed.audit.startupReadiness.present.includes("docs/repo-update-log.md"));
});

test("human audit output distinguishes startup audit from workflow-only update", async () => {
  const root = await tempRoot();
  await seedGitRepo(root);

  const { stdout } = await execFileP(
    process.execPath,
    [join(REPO_ROOT, "bin", "onboard.mjs"), root, "--features", "foundation.agents", "--audit"],
    { cwd: REPO_ROOT }
  );

  assert.match(stdout, /Startup readiness:/);
  assert.match(stdout, /This is the full startup\/process baseline audit/i);
  assert.match(stdout, /workflow-only update/i);
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
