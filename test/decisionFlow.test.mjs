import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { refreshRepo, refreshTarget } from "../src/server/refresh/refreshRepo.mjs";
import { ONBOARDING_MANAGED_IDS } from "../src/distributor/catalogSource.mjs";
import {
  REVIEW_BUNDLE_INSTRUCTIONS,
  buildDecisionDoc,
  canonicalJson,
  contentFingerprint,
  decisionDocFingerprint,
} from "../src/server/decisions/decisionDoc.mjs";
import {
  FACE_DIFF_LIMIT,
  extractDecisionDoc,
  renderDecisionHtml,
  writeDecisionReport,
} from "../src/server/decisions/renderHtml.mjs";
import { confirmationPhraseForRun, intakeDecisionDoc } from "../src/server/decisions/intake.mjs";
import {
  DECISION_FENCE_TAG,
  parseDecisionIssueBody,
  resumeDecisionIssue,
  saveDecisionIssue,
  serializeDecisionIssue,
} from "../src/server/decisions/issueSync.mjs";
import { validate } from "../src/contracts/validate.mjs";

// M2 decision flow (#158): doc build + fingerprints, HTML round-trip golden,
// intake rejection matrix + allow-partial, canonical-fence issue transport,
// and CLI surfaces. Hermetic: no live GitHub; gh goes through injected
// runners; fixture repos live in tmpdirs.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "archon-setup.mjs");
const APPLY_SET_SCHEMA = JSON.parse(
  readFileSync(join(ROOT, "src", "contracts", "schemas", "apply-set.schema.json"), "utf8"),
);

const NOW = "2026-06-09T12:00:00.000Z";
const BASE_SHA = "deadbeef".repeat(5);
const PROVENANCE = { managedRegionsSha256: "0123456701234567".repeat(4) };
const DRIFT_ID = "2026-01-01-decision-block";
const ADOPT_ID = "2026-02-02-adoption-block";
const CREATE_ID = "agents.core";
const CREATE_SNAPSHOT = [
  "# AGENTS",
  "",
  `<!-- BEGIN ARCHONVII MANAGED: ${CREATE_ID} -->`,
  "Managed core guidance.",
  `<!-- END ARCHONVII MANAGED: ${CREATE_ID} -->`,
  "",
].join("\n");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function guEntry(overrides = {}) {
  return {
    id: DRIFT_ID,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath: "AGENTS.md",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner: "## Decision Block\n\n- Managed guidance line.",
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
    ...overrides,
  };
}

function guBlock(inner, id = DRIFT_ID) {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${id} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${id} -->`,
    "",
  ].join("\n");
}

function createEntry() {
  return guEntry({
    id: CREATE_ID,
    markerShape: "managed",
    anchor: null,
    wholeFile: true,
    appliesToDefault: "always",
    inner: "Managed core guidance.",
    snapshotBody: CREATE_SNAPSHOT,
  });
}

function catalogOf(...entries) {
  return { entries, knownIds: new Set([...entries.map((e) => e.id), ...ONBOARDING_MANAGED_IDS]) };
}

async function makeRepo(files = {}) {
  const path = await mkdtemp(join(tmpdir(), "archon-decision-"));
  for (const [relpath, body] of Object.entries(files)) {
    const full = join(path, relpath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  return { name: "decision-repo", path, branch: "main", dirty: false };
}

async function auditOf(repo, catalog) {
  return refreshRepo({ repo, catalog, now: NOW, baseSha: BASE_SHA });
}

async function docOf(repo, catalog, { runId = "run-test-0001" } = {}) {
  const report = await auditOf(repo, catalog);
  return buildDecisionDoc({ report, runId, now: NOW, provenance: PROVENANCE });
}

function resolveAll(doc, choice, { rationale = null } = {}) {
  const out = JSON.parse(JSON.stringify(doc));
  for (const item of out.items) {
    item.resolution = {
      choice,
      rationale,
      freeText: null,
      decidedBy: "test-reviewer",
      decidedAt: NOW,
    };
  }
  return out;
}

function intakeDeps(repo, catalog) {
  return {
    targetPath: repo.path,
    repoContext: async () => repo,
    refresh: async () => auditOf(repo, catalog),
  };
}

// ---- build ----

test("buildDecisionDoc: actionable items only, fingerprints, options, instructions (AC4)", async () => {
  const body = `# Agents\n\n${guBlock("stale content")}${guBlock("rogue", "mystery-block")}`;
  const repo = await makeRepo({ "AGENTS.md": body });
  const doc = await docOf(repo, catalogOf(guEntry()));

  // already-current/not-applicable items never enter; merge + blocked do.
  assert.deepEqual(
    doc.items.map((i) => [i.itemId, i.operation.action]),
    [
      [`agents/AGENTS.md#${DRIFT_ID}`, "merge"],
      ["agents/AGENTS.md#mystery-block", "blocked"],
    ],
  );
  assert.equal(doc.reviewBundle.instructions, REVIEW_BUNDLE_INSTRUCTIONS);
  assert.ok(doc.reviewBundle.instructions.length > 0);

  const [merge, blocked] = doc.items;
  assert.equal(merge.fingerprints.fileSha256, contentFingerprint(body));
  assert.equal(merge.fingerprints.regionInnerSha256, contentFingerprint("stale content"));
  assert.deepEqual(merge.options, ["apply-central", "keep-local", "defer"]);
  assert.deepEqual(blocked.options, ["apply-central", "keep-local", "merge-manual", "defer"]);
  assert.equal(doc.repoFingerprint.headSha, BASE_SHA);
  assert.equal(doc.repoFingerprint.files["AGENTS.md"], contentFingerprint(body));
  assert.match(merge.evidence.diff, /stale content/);
});

test("buildDecisionDoc: clean repo yields no doc; secret-shaped diff content is redacted", async () => {
  const clean = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock(guEntry().inner)}` });
  assert.equal(await docOf(clean, catalogOf(guEntry())), null);

  const secret = `ghp_${"x".repeat(30)}`;
  const leaky = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock(`stale ${secret}`)}` });
  const doc = await docOf(leaky, catalogOf(guEntry()));
  assert.equal(doc.items[0].evidence.redacted, true);
  assert.doesNotMatch(canonicalJson(doc), /ghp_x/);
});

// ---- HTML face round-trip (AC1) ----

const HOSTILE_INNER = 'evil </script><script>alert(1)</script> ``` "quotes" \\u2028 ünïcode   ';

test("round-trip golden: doc -> HTML -> extracted JSON byte-equal, incl. hostile diff content", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock(HOSTILE_INNER)}` });
  const doc = await docOf(repo, catalogOf(guEntry()));
  assert.match(doc.items[0].evidence.diff, /evil/);

  const html = renderDecisionHtml(doc);
  // The face never lets the embedded JSON terminate the script element early.
  const embedded = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.doesNotMatch(embedded, /<\/script/);

  const extracted = extractDecisionDoc(html);
  assert.equal(extracted.ok, true);
  assert.equal(extracted.canonicalJson, canonicalJson(doc), "round-trip must be byte-equal");
});

test("oversized diffs truncate in the face only; the embedded machine JSON stays complete (F19)", async () => {
  const bigInner = `big\n${"x".repeat(FACE_DIFF_LIMIT + 5_000)}`;
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock(bigInner)}` });
  const doc = await docOf(repo, catalogOf(guEntry()));
  assert.ok(doc.items[0].evidence.diff.length > FACE_DIFF_LIMIT);

  const html = renderDecisionHtml(doc);
  assert.match(html, /truncated for display/);
  const extracted = extractDecisionDoc(html);
  assert.equal(extracted.doc.items[0].evidence.diff, doc.items[0].evidence.diff);
});

test("submit affordance renders only when a nonce is provided; tokens never land in saved HTML", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const doc = await docOf(repo, catalogOf(guEntry()));

  const offline = renderDecisionHtml(doc);
  assert.doesNotMatch(offline, /id="submit"/);

  const live = renderDecisionHtml(doc, { submit: { url: "http://127.0.0.1:5174/rpc/decisions.submit", nonce: "n0nce" } });
  assert.match(live, /id="submit"/);
  assert.match(live, /data-nonce="n0nce"/);
});

// ---- intake: accept path + ApplySet shape ----

test("intake accepts a completed doc and emits a schema-valid ApplySet with guards and summary", async () => {
  const repo = await makeRepo({
    "AGENTS.md": `# A\n\n${guBlock("stale content")}`,
    "docs/AGENTS.md": "# Sub agents\n\nLocal only.\n",
  });
  const catalog = catalogOf(
    guEntry(),
    guEntry({ id: ADOPT_ID, targetRelpath: "docs/AGENTS.md", inner: "## Adoption\n\n- Line." }),
  );
  const doc = await docOf(repo, catalog);
  assert.equal(doc.items.length, 2);

  const completed = resolveAll(doc, "apply-central");
  const intake = await intakeDecisionDoc({ input: completed, ...intakeDeps(repo, catalog), now: NOW });

  assert.equal(intake.ok, true);
  assert.deepEqual(validate(APPLY_SET_SCHEMA, intake.applySet).errors, []);
  const plans = Object.fromEntries(intake.applySet.items.map((i) => [i.itemId, i.writePlan.kind]));
  assert.equal(plans[`agents/AGENTS.md#${DRIFT_ID}`], "replace-region");
  assert.equal(plans[`agents/docs/AGENTS.md#${ADOPT_ID}`], "append-region");
  assert.equal(intake.applySet.guards.allowAutoMerge, true);
  assert.equal(intake.applySet.sourceDecisionDoc.fingerprint, decisionDocFingerprint(completed));

  const phrase = confirmationPhraseForRun({ repoName: repo.name, runId: doc.runId });
  assert.equal(intake.applySet.guards.requiredConfirmationPhraseHash, sha256(phrase));
  assert.equal(intake.summary.human.confirmationPhrase, phrase);
  assert.equal(intake.summary.machine.decisionDocFingerprint, decisionDocFingerprint(completed));
});

test("intake: keep-local records ownership; defer and merge-manual never enter the ApplySet", async () => {
  const body = `# A\n\n${guBlock("stale")}${guBlock("rogue", "mystery-block")}`;
  const repo = await makeRepo({ "AGENTS.md": body });
  const catalog = catalogOf(guEntry());
  const doc = await docOf(repo, catalog);

  const completed = JSON.parse(JSON.stringify(doc));
  completed.items[0].resolution = { choice: "defer", rationale: null, freeText: null, decidedBy: "t", decidedAt: NOW };
  completed.items[1].resolution = {
    choice: "keep-local",
    rationale: "deliberate local block",
    freeText: null,
    decidedBy: "t",
    decidedAt: NOW,
  };

  const intake = await intakeDecisionDoc({ input: completed, ...intakeDeps(repo, catalog), now: NOW });
  assert.equal(intake.ok, true);
  assert.equal(intake.applySet.items.length, 1);
  assert.equal(intake.applySet.items[0].writePlan.kind, "record-ownership");
  assert.equal(intake.applySet.items[0].file, ".archon/region-ownership.json");
  assert.deepEqual(intake.manual, [{ itemId: `agents/AGENTS.md#${DRIFT_ID}`, choice: "defer" }]);
});

test("intake verifies the recorded owner against the live target origin", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const catalog = catalogOf(guEntry());
  const report = await auditOf(repo, catalog);
  const doc = await buildDecisionDoc({ report, runId: "run-owner-0001", now: NOW, provenance: PROVENANCE, owner: "ArchonVII" });
  const completed = resolveAll(doc, "apply-central");

  const ok = await intakeDecisionDoc({
    input: completed,
    ...intakeDeps(repo, catalog),
    originRemote: async () => ({ originDetected: { owner: "ArchonVII", repo: repo.name } }),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.applySet.repo.owner, "ArchonVII");

  const mismatch = await intakeDecisionDoc({
    input: completed,
    ...intakeDeps(repo, catalog),
    originRemote: async () => ({ originDetected: { owner: "OtherOrg", repo: repo.name } }),
  });
  assert.equal(mismatch.code, "repo-mismatch");
});

test("intake re-derives resolution options from the fresh audit mapping", async () => {
  const repo = await makeRepo({});
  const catalog = catalogOf(createEntry());
  const doc = await docOf(repo, catalog);
  assert.deepEqual(doc.items[0].options, ["apply-central", "defer"]);

  const tampered = JSON.parse(JSON.stringify(doc));
  tampered.items[0].options.push("keep-local");
  tampered.items[0].resolution = {
    choice: "keep-local",
    rationale: "manual tamper",
    freeText: null,
    decidedBy: "t",
    decidedAt: NOW,
  };

  const intake = await intakeDecisionDoc({ input: tampered, ...intakeDeps(repo, catalog), now: NOW });
  assert.equal(intake.code, "malformed-resolution");
});

// ---- intake: rejection matrix (AC2) ----

test("intake rejects: unknown schemaVersion, repo mismatch, stale base, malformed resolution, missing rationale", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}${guBlock("rogue", "mystery-block")}` });
  const catalog = catalogOf(guEntry());
  const doc = await docOf(repo, catalog);
  const completed = resolveAll(doc, "apply-central", { rationale: "needed for the blocked item" });
  const deps = intakeDeps(repo, catalog);

  const wrongVersion = JSON.parse(JSON.stringify(completed));
  wrongVersion.schemaVersion = 2;
  assert.equal((await intakeDecisionDoc({ input: wrongVersion, ...deps })).code, "schema-invalid");

  const otherRepo = { ...repo, name: "some-other-repo" };
  const mismatch = await intakeDecisionDoc({ input: completed, ...deps, repoContext: async () => otherRepo });
  assert.equal(mismatch.code, "repo-mismatch");

  const staleBase = await intakeDecisionDoc({
    input: completed,
    ...deps,
    refresh: async () => refreshRepo({ repo, catalog, now: NOW, baseSha: "cafebabe".repeat(5) }),
  });
  assert.equal(staleBase.code, "stale-base");

  const mergeOnlyRepo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const mergeOnlyCompleted = resolveAll(await docOf(mergeOnlyRepo, catalog), "apply-central");
  const staleState = await intakeDecisionDoc({
    input: mergeOnlyCompleted,
    ...intakeDeps(mergeOnlyRepo, catalog),
    refresh: async () => ({
      status: "ok",
      repo: { name: mergeOnlyRepo.name, path: mergeOnlyRepo.path, baseSha: BASE_SHA },
      categories: [],
    }),
  });
  assert.equal(staleState.code, "stale-state");

  const badChoice = JSON.parse(JSON.stringify(completed));
  badChoice.items[0].resolution.choice = null;
  assert.equal((await intakeDecisionDoc({ input: badChoice, ...deps })).code, "malformed-resolution");

  const noRationale = JSON.parse(JSON.stringify(completed));
  noRationale.items[1].resolution.rationale = null; // blocked item resolved without rationale
  assert.equal((await intakeDecisionDoc({ input: noRationale, ...deps })).code, "missing-rationale");

  assert.equal((await intakeDecisionDoc({ input: completed, ...deps })).code, "unsupported-resolution");

  assert.equal((await intakeDecisionDoc({ input: "{not json", ...deps })).code, "parse-failed");
});

test("intake rejects apply-central for file-level conflicts without a source region", async () => {
  const repo = await makeRepo({
    "AGENTS.md": `# A\n\n<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${DRIFT_ID} -->\nmissing end marker\n`,
  });
  const doc = await docOf(repo, catalogOf(guEntry()));
  assert.equal(doc.items[0].regionId, null);
  assert.equal(doc.items[0].operation.action, "blocked");

  const completed = resolveAll(doc, "apply-central", { rationale: "operator wants central to win" });
  const intake = await intakeDecisionDoc({ input: completed, ...intakeDeps(repo, catalogOf(guEntry())), now: NOW });
  assert.equal(intake.code, "unsupported-resolution");
});

test("intake rejects stale hashes with the precise reason: in-region edit vs outside-the-region edit", async () => {
  const catalog = catalogOf(guEntry());

  // In-region edit -> stale-region-hash.
  const repoA = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const docA = resolveAll(await docOf(repoA, catalog), "apply-central");
  await writeFile(join(repoA.path, "AGENTS.md"), `# A\n\n${guBlock("edited inside the region")}`, "utf8");
  const inRegion = await intakeDecisionDoc({ input: docA, ...intakeDeps(repoA, catalog), now: NOW });
  assert.equal(inRegion.code, "stale-region-hash");

  // Outside-the-region edit -> stale-file-hash (region inner unchanged).
  const repoB = await makeRepo({ "AGENTS.md": `# B\n\n${guBlock("stale")}` });
  const docB = resolveAll(await docOf(repoB, catalog), "apply-central");
  await writeFile(join(repoB.path, "AGENTS.md"), `# B edited outside\n\n${guBlock("stale")}`, "utf8");
  const outside = await intakeDecisionDoc({ input: docB, ...intakeDeps(repoB, catalog), now: NOW });
  assert.equal(outside.code, "stale-file-hash");
});

test("--allow-partial applies only still-valid items and reports the skipped ones (F1)", async () => {
  const catalog = catalogOf(
    guEntry(),
    guEntry({ id: ADOPT_ID, targetRelpath: "docs/AGENTS.md", inner: "## Adoption\n\n- Line." }),
  );
  const repo = await makeRepo({
    "AGENTS.md": `# A\n\n${guBlock("stale")}`,
    "docs/AGENTS.md": `# Sub\n\n${guBlock("other stale", ADOPT_ID)}`,
  });
  const completed = resolveAll(await docOf(repo, catalog), "apply-central");

  // Invalidate only the first file.
  await writeFile(join(repo.path, "AGENTS.md"), `# A\n\n${guBlock("moved on")}`, "utf8");

  const strict = await intakeDecisionDoc({ input: completed, ...intakeDeps(repo, catalog), now: NOW });
  assert.equal(strict.ok, false);
  assert.equal(strict.code, "stale-region-hash");

  const partial = await intakeDecisionDoc({
    input: completed,
    ...intakeDeps(repo, catalog),
    allowPartial: true,
    now: NOW,
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.applySet.items.length, 1);
  assert.equal(partial.applySet.items[0].itemId, `agents/docs/AGENTS.md#${ADOPT_ID}`);
  assert.deepEqual(partial.skipped, [{ itemId: `agents/AGENTS.md#${DRIFT_ID}`, reason: "stale-region-hash" }]);
});

// ---- issue sync (AC3, F18) ----

test("issue parse picks only the canonical fence among decoys; duplicates and malformed JSON never execute", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const doc = await docOf(repo, catalogOf(guEntry()));
  const { body } = serializeDecisionIssue(doc);

  const withDecoys = `Decoy first:\n\n\`\`\`json\n{"kind":"decoy"}\n\`\`\`\n\n${body}\n\nAnother decoy:\n\n\`\`\`\nplain fence\n\`\`\`\n`;
  const parsed = parseDecisionIssueBody(withDecoys);
  assert.equal(parsed.ok, true);
  assert.equal(canonicalJson(parsed.doc), canonicalJson(doc));

  const duplicated = `${body}\n\n${body}`;
  assert.equal(parseDecisionIssueBody(duplicated).ok, false);
  assert.match(parseDecisionIssueBody(duplicated).reason, /ambiguous/);

  const malformed = body.replace('"schemaVersion":1', '"schemaVersion":1,,,');
  assert.equal(parseDecisionIssueBody(malformed).ok, false);

  const tampered = body.replace('"kind":"decision-doc"', '"kind":"something-else"');
  assert.equal(parseDecisionIssueBody(tampered).ok, false);

  assert.equal(parseDecisionIssueBody("no fences here").ok, false);
});

test("saveDecisionIssue creates via stdin body, labels it, and supersedes older open decision issues", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const doc = await docOf(repo, catalogOf(guEntry()));

  const calls = [];
  const runGh = async (args, { stdin = null } = {}) => {
    calls.push({ args, stdin });
    if (args[0] === "issue" && args[1] === "list") {
      return {
        code: 0,
        stdout: JSON.stringify([
          { number: 7, title: `Decision: ${doc.repo.name} ecosystem refresh run-old` },
          { number: 9, title: "Decision: unrelated-repo ecosystem refresh run-x" },
        ]),
        stderr: "",
      };
    }
    if (args[0] === "issue" && args[1] === "create") {
      return { code: 0, stdout: "https://github.com/ArchonVII/decision-repo/issues/42\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const saved = await saveDecisionIssue({ doc, repoSlug: "ArchonVII/decision-repo", runGh });

  assert.equal(saved.issueNumber, 42);
  assert.deepEqual(saved.superseded, [7]);
  const create = calls.find((c) => c.args[1] === "create");
  assert.ok(create.args.includes("--body-file") && create.args.includes("-"), "body must ride stdin");
  assert.match(create.stdin, new RegExp("```" + DECISION_FENCE_TAG));
  const comment = calls.find((c) => c.args[1] === "comment");
  assert.deepEqual(comment.args.slice(2, 3), ["7"]);
  assert.match(comment.stdin, /superseded-by: #42/);
  assert.match(comment.stdin, /stale-base: true/);
});

test("resumeDecisionIssue round-trips a saved doc and refuses malformed refs and bodies", async () => {
  const repo = await makeRepo({ "AGENTS.md": `# A\n\n${guBlock("stale")}` });
  const doc = await docOf(repo, catalogOf(guEntry()));
  const { body } = serializeDecisionIssue(doc);

  const runGh = async (args) =>
    args[0] === "issue" && args[1] === "view"
      ? { code: 0, stdout: JSON.stringify({ body }), stderr: "" }
      : { code: 1, stdout: "", stderr: "unexpected call" };

  const resumed = await resumeDecisionIssue({ ref: "issue:#12", repoSlug: "ArchonVII/decision-repo", runGh });
  assert.equal(resumed.ok, true);
  assert.equal(canonicalJson(resumed.doc), canonicalJson(doc));

  assert.equal((await resumeDecisionIssue({ ref: "pr:#12", repoSlug: "a/b", runGh })).ok, false);
});

// ---- CLI surfaces ----

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

async function makeGitRepo(files) {
  const path = await mkdtemp(join(tmpdir(), "archon-decision-cli-"));
  git(path, "init", "-b", "main");
  for (const [relpath, body] of Object.entries(files)) {
    const full = join(path, relpath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  git(path, "add", "-A");
  git(path, "commit", "-m", "chore: fixture");
  return path;
}

test("CLI --report writes a self-contained face under the artifacts dir (never the target repo)", async () => {
  const path = await makeGitRepo({ "AGENTS.md": "# Agents\n\nLocal content.\n" });
  const reportDir = await mkdtemp(join(tmpdir(), "archon-decision-out-"));

  const result = spawnSync(process.execPath, [BIN, "refresh", "--target", path, "--report", "--json"], {
    env: { ...GIT_ENV, ARCHON_DECISION_REPORT_DIR: reportDir },
    encoding: "utf8",
  });

  assert.equal(result.status, 20, result.stderr); // real catalog -> adoptions pending
  const match = /decision report: (.+)/.exec(result.stderr);
  assert.ok(match, `expected a report path in stderr:\n${result.stderr}`);
  const reportPath = match[1].trim();
  assert.ok(reportPath.startsWith(reportDir), "report must land in the artifacts dir");
  assert.ok(!reportPath.startsWith(path), "report must never land in the target repo");
  assert.ok(existsSync(reportPath));

  const extracted = extractDecisionDoc(await readFile(reportPath, "utf8"));
  assert.equal(extracted.ok, true);
  assert.equal(extracted.doc.reviewBundle.instructions, REVIEW_BUNDLE_INSTRUCTIONS);
  // stdout stays a parseable RepoRefreshReport despite the stderr note.
  assert.equal(JSON.parse(result.stdout).kind, "repo-refresh-report");
});

test("CLI --intake validates a completed doc file: defer-all is ok/exit 0, tampered resolution exits 20", async () => {
  const path = await makeGitRepo({ "AGENTS.md": "# Agents\n\nLocal content.\n" });
  const report = await refreshTarget({ targetPath: path, now: NOW });
  const doc = await buildDecisionDoc({ report, runId: "run-cli-0001", now: NOW });
  assert.ok(doc, "real catalog adoptions must be actionable");

  const deferred = resolveAll(doc, "defer");
  const docPath = join(await mkdtemp(join(tmpdir(), "archon-decision-doc-")), "completed.json");
  await writeFile(docPath, JSON.stringify(deferred), "utf8");

  const ok = spawnSync(process.execPath, [BIN, "refresh", "--target", path, "--intake", docPath, "--json"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
  const intake = JSON.parse(ok.stdout);
  assert.equal(intake.ok, true);
  assert.equal(intake.applySet, null); // everything deferred -> nothing to apply

  const tampered = JSON.parse(JSON.stringify(deferred));
  tampered.items[0].resolution.choice = "overwrite-everything";
  await writeFile(docPath, JSON.stringify(tampered), "utf8");
  const rejected = spawnSync(process.execPath, [BIN, "refresh", "--target", path, "--intake", docPath], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(rejected.status, 20);
  assert.match(rejected.stderr, /schema-invalid|malformed-resolution/);

  const execute = spawnSync(process.execPath, [BIN, "refresh", "--target", path, "--execute"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  assert.equal(execute.status, 1);
  assert.match(execute.stderr, /M3/);
});
