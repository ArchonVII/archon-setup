import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  confirmationPhraseFor,
  distribute,
  distributeRepo,
  exitCodeFor,
  repoContextFor,
  writeAtomic,
} from "../src/distributor/distribute.mjs";
import { buildCatalog, ONBOARDING_MANAGED_IDS } from "../src/distributor/catalogSource.mjs";
import { distributeGlobalUpdate, getGlobalUpdate, listGlobalUpdates } from "../src/server/globalUpdates.mjs";

// Regression tests from the #155 adversarial review (run wf_026868bd-3d5).
// Each test pins a confirmed finding so the failure mode cannot return.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "archon-setup.mjs");
const ENTRY_ID = "2026-01-01-review-block";

function guEntry(overrides = {}) {
  return {
    id: ENTRY_ID,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath: "AGENTS.md",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner: "## Review Block\n\n- Managed guidance line.",
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
    ...overrides,
  };
}

function guBlock(inner = "## Review Block\n\n- Managed guidance line.", id = ENTRY_ID) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${id} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${id} -->`,
    "",
  ].join("\n");
}

const ONBOARDING_BLOCK = [
  "<!-- BEGIN ARCHONVII MANAGED BLOCK: agents-start-map -->",
  "## Start map",
  "Onboarding-owned content.",
  "<!-- END ARCHONVII MANAGED BLOCK: agents-start-map -->",
  "",
].join("\n");

function catalogOf(...entries) {
  return { entries, knownIds: new Set([...entries.map((e) => e.id), ...ONBOARDING_MANAGED_IDS]) };
}

async function makeRepo(files = {}, repoOverrides = {}) {
  const path = await mkdtemp(join(tmpdir(), "archon-review-"));
  for (const [relpath, body] of Object.entries(files)) {
    const full = join(path, relpath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  return { name: "review-repo", path, branch: "agent/test/1-review", dirty: false, ...repoOverrides };
}

// ---- A8: onboarding-managed MANAGED BLOCK ids are known, never conflicts ----

test("A8: delegated globalUpdates run treats onboarding MANAGED BLOCKs as known (would-apply, not conflict)", async () => {
  const record = getGlobalUpdate("2026-05-31-browser-backend-preflight");
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${ONBOARDING_BLOCK}` });

  const result = await distributeGlobalUpdate({
    updateId: record.id,
    confirmation: record.confirmationPhrase,
    dryRun: true,
    repos: [repo],
  });

  assert.equal(result.results[0].status, "would-apply");
  assert.equal(result.results[0].reason, "updated");
});

test("A8: buildCatalog knownIds include the onboarding block ids", () => {
  const catalog = buildCatalog({
    manifest: { schemaVersion: 1, entries: [] },
    read: () => {
      throw new Error("unused");
    },
    globalUpdates: listGlobalUpdates(),
  });
  for (const id of ONBOARDING_MANAGED_IDS) assert.ok(catalog.knownIds.has(id), id);
  // Known, but never actionable entries.
  assert.ok(!catalog.entries.some((e) => ONBOARDING_MANAGED_IDS.includes(e.id)));
});

test("A8: distributeRepo reports adoption (not conflict) for a repo whose AGENTS.md has onboarding blocks", async () => {
  const catalog = buildCatalog({
    manifest: { schemaVersion: 1, entries: [] },
    read: () => {
      throw new Error("unused");
    },
    globalUpdates: listGlobalUpdates(),
  });
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${ONBOARDING_BLOCK}` });

  const result = await distributeRepo({ repo, catalog, mode: "dry-run" });

  assert.equal(result.files[0].status, "adoption_needed");
  assert.ok(!result.files[0].regions.some((r) => r.reason === "unknown-id"));
});

// ---- Fail closed on unknown repo state ----

test("repoContextFor marks a non-git directory unavailable", async () => {
  const path = await mkdtemp(join(tmpdir(), "archon-nongit-"));
  const ctx = await repoContextFor(path);
  assert.equal(ctx.available, false);
});

test("distributeRepo skips unavailable repos and unknown branches instead of writing", async () => {
  const unavailable = await makeRepo({ "AGENTS.md": "# A\n" }, { available: false });
  const unknownBranch = await makeRepo({ "AGENTS.md": "# A\n" }, { branch: null });

  const first = await distributeRepo({ repo: unavailable, catalog: catalogOf(guEntry()), mode: "apply" });
  assert.equal(first.status, "skipped");
  assert.equal(first.reason, "repo-unavailable");

  const second = await distributeRepo({ repo: unknownBranch, catalog: catalogOf(guEntry()), mode: "apply" });
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "unknown-branch");
  assert.equal(await readFile(join(unknownBranch.path, "AGENTS.md"), "utf8"), "# A\n");
});

// ---- writeAtomic cleanup ----

test("writeAtomic removes its tmp file when the rename fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-atomic-"));
  const targetDir = join(root, "AGENTS.md");
  await mkdir(targetDir); // rename(file -> existing dir) fails on every platform

  await assert.rejects(() => writeAtomic(targetDir, "content\n"));
  const leftovers = (await readdir(root)).filter((name) => name.includes(".archon-tmp-"));
  assert.deepEqual(leftovers, []);
});

// ---- Per-file failures never abort the fleet ----

test("a preview-write failure in one repo is isolated; the fleet run and log continue", async () => {
  const broken = await makeRepo({ "AGENTS.md": "# Local\n", ".archon": "a regular file\n" });
  const healthy = await makeRepo({ "AGENTS.md": "# Local\n" });
  const logPath = join(await mkdtemp(join(tmpdir(), "archon-prevlog-")), "log.jsonl");

  const run = await distribute({
    repos: [broken, healthy],
    catalog: catalogOf(guEntry()),
    writePreview: true,
    logPath,
  });

  assert.equal(run.results[0].files[0].status, "failed");
  assert.equal(run.results[0].files[0].reason, "preview-write-failed");
  // The second repo was still processed and the run-log still written.
  assert.equal(run.results[1].files[0].status, "adoption_needed");
  assert.ok(existsSync(logPath));
  assert.equal(exitCodeFor(run), 1);
});

test("existing-file applicability failures are skipped before replacing present regions", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock("old content")}` });
  const entry = guEntry({ inner: "new content", appliesToDefault: "future-policy" });

  const result = await distributeRepo({ repo, catalog: catalogOf(entry), mode: "apply" });

  assert.equal(result.files[0].status, "skip");
  assert.equal(result.files[0].reason, "unknown-applies-to-default");
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), `# Agents\n\n${guBlock("old content")}`);
});

test("capability gating does not bypass unknown-region conflict auditing", async () => {
  const repo = await makeRepo({
    "AGENTS.md": `# Agents\n\n${guBlock("stale gated content")}${guBlock("orphaned content", "unknown.region")}`,
    ".github/archon-setup.json": `${JSON.stringify({
      tool: "archon-setup",
      selectedFeatures: ["foundation.agents"],
    }, null, 2)}\n`,
  });
  const entry = guEntry({
    capabilityIds: ["foundation.agents", "agent-lifecycle.baseline"],
    requireSelectedCapabilities: true,
  });

  const result = await distributeRepo({
    repo,
    catalog: catalogOf(entry),
    ids: [ENTRY_ID],
    mode: "dry-run",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.files[0].status, "conflict");
  assert.ok(
    result.files[0].regions.some(
      (region) => region.id === "unknown.region" && region.status === "conflict" && region.reason === "unknown-id",
    ),
  );
  assert.ok(
    result.files[0].regions.some(
      (region) => region.id === ENTRY_ID && region.status === "skip" && region.reason === "capability-not-selected",
    ),
  );
});

test("write-preview refuses a symlinked .archon path before writing outside the repo", { skip: process.platform === "win32" }, async () => {
  const outside = await mkdtemp(join(tmpdir(), "archon-preview-outside-"));
  const repo = await makeRepo({ "AGENTS.md": "# Local\n" });
  await symlink(outside, join(repo.path, ".archon"), "dir");

  const result = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry()),
    mode: "dry-run",
    writePreview: true,
  });

  assert.equal(result.files[0].status, "failed");
  assert.equal(result.files[0].reason, "preview-write-failed");
  assert.equal(existsSync(join(outside, "distribute-preview", "AGENTS.md.patch")), false);
});

// ---- EOL preservation inside the managed inner ----

test("a CRLF file whose region equals the catalog inner modulo EOL is changed:false", async () => {
  const crlfBlock = guBlock().replaceAll("\n", "\r\n");
  const repo = await makeRepo({ "AGENTS.md": `# Agents\r\n\r\n${crlfBlock}` });

  const result = await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "dry-run" });

  assert.equal(result.files[0].status, "clean_apply");
  assert.equal(result.files[0].changed, false);
});

test("apply writes the replacement inner in the target file's EOL style (no mixed EOLs)", async () => {
  const crlfStale = guBlock("stale line").replaceAll("\n", "\r\n");
  const repo = await makeRepo({ "AGENTS.md": `# Agents\r\n\r\n${crlfStale}` });

  await distributeRepo({ repo, catalog: catalogOf(guEntry()), mode: "apply" });

  const after = await readFile(join(repo.path, "AGENTS.md"), "utf8");
  assert.match(after, /- Managed guidance line\.\r\n/);
  assert.ok(!/[^\r]\n/.test(after), "found a bare LF in a CRLF file");
});

// ---- Diffs (§9/DL5/§5) ----

test("changed regions carry a unified diff; the run-log never does", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock("stale content")}` });
  const logPath = join(await mkdtemp(join(tmpdir(), "archon-difflog-")), "log.jsonl");

  const run = await distribute({ repos: [repo], catalog: catalogOf(guEntry()), logPath });

  const region = run.results[0].files[0].regions.find((r) => r.id === ENTRY_ID);
  assert.match(region.diff, /^-stale content$/m);
  assert.match(region.diff, /^\+- Managed guidance line\.$/m);
  const logLine = (await readFile(logPath, "utf8")).trim();
  assert.doesNotMatch(logLine, /stale content/);
  assert.doesNotMatch(logLine, /Managed guidance line/);
});

test("write-preview emits an applicable unified diff", async () => {
  const repo = await makeRepo({ "AGENTS.md": "# Local\n" });

  const run = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry()),
    mode: "dry-run",
    writePreview: true,
  });

  const patch = await readFile(run.files[0].previewPath, "utf8");
  assert.match(patch, /^--- a\/AGENTS\.md$/m);
  assert.match(patch, /^\+\+\+ b\/AGENTS\.md$/m);
  assert.match(patch, /^\+<!-- BEGIN ARCHONVII GLOBAL UPDATE: 2026-01-01-review-block -->$/m);
});

// ---- CLI group/id validation ----

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(repoPath, ...args) {
  const result = spawnSync("git", ["-C", repoPath, ...args], { env: GIT_ENV, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

async function makeGitRepo(agentsBody) {
  const path = await mkdtemp(join(tmpdir(), "archon-cli-fix-"));
  git(path, "init");
  git(path, "checkout", "-b", "agent/test/1-cli");
  await writeFile(join(path, "AGENTS.md"), agentsBody, "utf8");
  git(path, "add", "AGENTS.md");
  git(path, "commit", "-m", "chore: fixture");
  return path;
}

test("--group all means every group (same result as no filter), not a silent no-op", async () => {
  const path = await makeGitRepo("# Agents\n\nLocal content.\n");
  const logPath = join(await mkdtemp(join(tmpdir(), "archon-cli-log-")), "log.jsonl");

  const result = spawnSync(
    process.execPath,
    [BIN, "distribute", "--target", path, "--group", "all", "--log", logPath, "--json"],
    { env: GIT_ENV, encoding: "utf8" },
  );

  assert.equal(result.status, 20, result.stderr);
  const run = JSON.parse(result.stdout);
  assert.ok(run.counts.adoptionNeeded >= 1);
});

test("CLI apply skips startup guidance when the consumer did not select lifecycle", async () => {
  const updateId = "2026-06-09-agent-startup-baseline";
  const staleBody = [
    "# Agents",
    "",
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${updateId} -->`,
    "## Stale startup guidance",
    "",
    "Run lifecycle scripts that this repo did not select.",
    `<!-- END ARCHONVII GLOBAL UPDATE: ${updateId} -->`,
    "",
  ].join("\n");
  const path = await makeGitRepo(staleBody);
  await mkdir(join(path, ".github"), { recursive: true });
  await writeFile(
    join(path, ".github", "archon-setup.json"),
    `${JSON.stringify({ tool: "archon-setup", selectedFeatures: ["foundation.agents"] }, null, 2)}\n`,
    "utf8",
  );
  git(path, "add", ".github/archon-setup.json");
  git(path, "commit", "-m", "chore: add docs-min manifest");
  const logPath = join(await mkdtemp(join(tmpdir(), "archon-cli-log-")), "log.jsonl");

  const result = spawnSync(
    process.execPath,
    [BIN, "distribute", "--target", path, "--id", updateId, "--apply", "--log", logPath, "--json"],
    { env: GIT_ENV, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(result.stdout);
  assert.equal(run.results[0].status, "ok");
  assert.equal(run.results[0].files[0].status, "skip");
  assert.equal(run.results[0].files[0].reason, "capability-not-selected");
  assert.deepEqual(run.results[0].files[0].regions[0].missingCapabilities, ["agent-lifecycle.baseline"]);
  assert.equal(await readFile(join(path, "AGENTS.md"), "utf8"), staleBody);
  const logged = JSON.parse((await readFile(logPath, "utf8")).trim());
  assert.equal(logged.results[0].files[0].reason, "capability-not-selected");
  assert.deepEqual(logged.results[0].files[0].regions[0].missingCapabilities, ["agent-lifecycle.baseline"]);
});

test("unknown --group or --id tokens are rejected with exit 1", async () => {
  const path = await makeGitRepo("# Agents\n");

  const badGroup = spawnSync(process.execPath, [BIN, "distribute", "--target", path, "--group", "bogus"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(badGroup.status, 1);
  assert.match(badGroup.stderr, /unknown group/);

  const badId = spawnSync(process.execPath, [BIN, "distribute", "--target", path, "--id", "no-such-id"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(badId.status, 1);
  assert.match(badId.stderr, /unknown id/);
});

test("missing option values and mutually exclusive target modes are rejected", async () => {
  const path = await makeGitRepo("# Agents\n");

  const missingTargetValue = spawnSync(process.execPath, [BIN, "distribute", "--target", "--apply"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(missingTargetValue.status, 1);
  assert.match(missingTargetValue.stderr, /missing value for --target/);

  const bothModes = spawnSync(process.execPath, [BIN, "distribute", "--target", path, "--all"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(bothModes.status, 1);
  assert.match(bothModes.stderr, /choose exactly one/);
});

// ---- Path safety (§10 NFR / §11 matrix) ----

test("a traversal targetRelpath is skipped as path-safety and never written", async () => {
  const escapeName = `escape-${Date.now()}-${Math.floor(Math.random() * 1e6)}.md`;
  const repo = await makeRepo({ "AGENTS.md": "# A\n" });

  for (const mode of ["dry-run", "apply"]) {
    const result = await distributeRepo({
      repo,
      catalog: catalogOf(guEntry({ targetRelpath: `../${escapeName}` })),
      mode,
    });
    assert.equal(result.files[0].status, "skip");
    assert.equal(result.files[0].reason, "path-safety");
  }
  assert.equal(existsSync(join(repo.path, "..", escapeName)), false);
});

test("an absolute targetRelpath is skipped as path-safety", async () => {
  const repo = await makeRepo({ "AGENTS.md": "# A\n" });
  const absolute = process.platform === "win32" ? "C:\\elsewhere\\escape.md" : "/elsewhere/escape.md";

  const result = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry({ targetRelpath: absolute })),
    mode: "apply",
  });

  assert.equal(result.files[0].status, "skip");
  assert.equal(result.files[0].reason, "path-safety");
});

// ---- Shell metadata end-to-end (§10/§11) ----

const SHELL_BODY = [
  "#!/usr/bin/env bash",
  "# BEGIN ARCHONVII MANAGED: hooks.pre-push.core",
  "echo old",
  "# END ARCHONVII MANAGED: hooks.pre-push.core",
  "exit 0",
  "",
].join("\n");

function shellEntry() {
  return guEntry({
    id: "hooks.pre-push.core",
    group: "hooks",
    adapter: "shell",
    markerShape: "managed",
    anchor: null,
    targetRelpath: ".githooks/pre-push",
    inner: "echo new",
  });
}

test("shell apply keeps the shebang on line 1 and the hash markers intact", async () => {
  const repo = await makeRepo({ ".githooks/pre-push": SHELL_BODY });

  const result = await distributeRepo({ repo, catalog: catalogOf(shellEntry()), mode: "apply" });

  assert.equal(result.files[0].written, true);
  const after = await readFile(join(repo.path, ".githooks/pre-push"), "utf8");
  assert.ok(after.startsWith("#!/usr/bin/env bash\n"));
  assert.match(after, /# BEGIN ARCHONVII MANAGED: hooks\.pre-push\.core\necho new\n# END ARCHONVII MANAGED: hooks\.pre-push\.core/);
});

test("shell apply preserves the exec bit", { skip: process.platform === "win32" }, async () => {
  const repo = await makeRepo({ ".githooks/pre-push": SHELL_BODY });
  const hookPath = join(repo.path, ".githooks/pre-push");
  await chmod(hookPath, 0o755);

  await distributeRepo({ repo, catalog: catalogOf(shellEntry()), mode: "apply" });

  assert.equal((await stat(hookPath)).mode & 0o777, 0o755);
});

// ---- Run-log allowlist + redaction ----

test("the run-log file objects carry only allowlisted keys and never leak secret-shaped content", async () => {
  const secret = `ghp_${"x".repeat(30)}`;
  const repo = await makeRepo({ "AGENTS.md": `# Agents\n\n${guBlock(`stale ${secret}`)}` });
  const logPath = join(await mkdtemp(join(tmpdir(), "archon-redact-")), "log.jsonl");

  await distribute({ repos: [repo], catalog: catalogOf(guEntry()), logPath });

  const raw = (await readFile(logPath, "utf8")).trim();
  assert.doesNotMatch(raw, /ghp_x/);
  const logged = JSON.parse(raw);
  const fileKeys = Object.keys(logged.results[0].files[0]).sort();
  for (const key of fileKeys) {
    assert.ok(["changed", "reason", "regions", "relpath", "status", "written"].includes(key), key);
  }
});

// ---- Operational failure path (exit 1) ----

test("a read failure yields failed/read-failed, completed-with-errors, and exit 1 over a sibling's 20", async () => {
  const failing = await makeRepo({});
  await mkdir(join(failing.path, "AGENTS.md")); // directory at the target path -> non-ENOENT read error
  const sibling = await makeRepo({ "AGENTS.md": "# Local only\n" });

  const run = await distribute({ repos: [failing, sibling], catalog: catalogOf(guEntry()), logPath: null });

  assert.equal(run.results[0].files[0].status, "failed");
  assert.equal(run.results[0].files[0].reason, "read-failed");
  assert.equal(run.status, "completed-with-errors");
  assert.equal(run.ok, false);
  assert.equal(exitCodeFor(run), 1);
});

// ---- Unsupported adapter + YAML danger gate ----

test("an unknown adapter is skipped as unsupported-file-type", async () => {
  const repo = await makeRepo({ "data.json": "{}\n" });

  const result = await distributeRepo({
    repo,
    catalog: catalogOf(guEntry({ adapter: "json", targetRelpath: "data.json" })),
    mode: "dry-run",
  });

  assert.equal(result.files[0].status, "skip");
  assert.equal(result.files[0].reason, "unsupported-file-type");
});

test("a replacement that introduces a duplicate YAML key is a danger conflict and is never written", async () => {
  const yamlBody = [
    "jobs:",
    "  decision:",
    "    permissions:",
    "      # BEGIN ARCHONVII MANAGED: workflow.gate.permissions.base",
    "      contents: read",
    "      # END ARCHONVII MANAGED: workflow.gate.permissions.base",
    "      pull-requests: write",
    "",
  ].join("\n");
  const repo = await makeRepo({ ".github/workflows/gate.yml": yamlBody });
  const entry = guEntry({
    id: "workflow.gate.permissions.base",
    group: "callers",
    adapter: "yaml",
    markerShape: "managed",
    anchor: null,
    targetRelpath: ".github/workflows/gate.yml",
    inner: "      contents: read\n      pull-requests: read",
  });

  const result = await distributeRepo({ repo, catalog: catalogOf(entry), mode: "apply" });

  assert.equal(result.files[0].status, "conflict");
  assert.equal(result.files[0].reason, "danger-detected");
  assert.equal(await readFile(join(repo.path, ".github/workflows/gate.yml"), "utf8"), yamlBody);
});

// ---- Confirmation phrase literals + scope binding ----

test("the three confirmation phrase forms are pinned literally", () => {
  assert.equal(confirmationPhraseFor(), "DISTRIBUTE ALL");
  assert.equal(confirmationPhraseFor({ groups: ["agents"] }), "DISTRIBUTE ALL --group agents");
  assert.equal(confirmationPhraseFor({ ids: ["x", "y"] }), "DISTRIBUTE ALL --id x,y");
});

test("a phrase issued for one scope never authorizes a broader run", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("old")}` });
  const before = await readFile(join(repo.path, "AGENTS.md"), "utf8");

  const refused = await distribute({
    repos: [repo],
    all: true,
    apply: true,
    catalog: catalogOf(guEntry()),
    groups: ["agents", "hooks"],
    confirmation: "DISTRIBUTE ALL --group agents",
  });

  assert.equal(refused.status, "confirmation-required");
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), before);
});
