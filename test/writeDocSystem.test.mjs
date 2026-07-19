import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeDocSystem from "../src/server/tasks/writeDocSystem.mjs";
import { DOC_SYSTEM_FILES, DOC_SYSTEM_SCRIPTS } from "../src/server/tasks/writeDocSystem.mjs";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "../src/server/tasks/repoTemplateSnapshot.mjs";

const EXPECTED_FILES = [
  ".agent/doc-map.yml",
  "docs/CANON.md",
  "docs/INDEX.md",
  "docs/agent-process/doc-system.md",
  "scripts/docs/lib.mjs",
  "scripts/docs/index.mjs",
  "scripts/docs/nav.mjs",
  "scripts/docs/render.mjs",
  "scripts/docs/status.mjs",
  "scripts/docs/changelog.mjs",
];

const EXPECTED_SCRIPTS = {
  "docs:render": "node scripts/docs/render.mjs",
  "docs:status": "node scripts/docs/status.mjs",
};

async function makeTarget() {
  return mkdtemp(join(tmpdir(), "archon-docsystem-"));
}

function makeCtx(targetPath) {
  return { targetPath, repo: "demo", manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] } };
}

const snapshotBody = (file) => readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8").then(normalizeSnapshotText);

test("doc-system task owns the declared documentation floor and generators", () => {
  assert.deepEqual(DOC_SYSTEM_FILES, EXPECTED_FILES);
  assert.deepEqual(DOC_SYSTEM_SCRIPTS, EXPECTED_SCRIPTS);
});

test("apply installs managed docs exactly and renders consumer seeds for the selection", async () => {
  const target = await makeTarget();
  await writeDocSystem.apply(makeCtx(target));
  for (const file of EXPECTED_FILES) {
    assert.ok((await stat(join(target, file))).isFile(), `${file} should be installed`);
    const body = await readFile(join(target, file), "utf8");
    if (file === "docs/CANON.md" || file === "docs/INDEX.md") {
      assert.doesNotMatch(body, /LIBRARIAN\.md|project-status\.md/);
      if (file === "docs/INDEX.md") assert.doesNotMatch(body, /### adr\//);
    } else if (file !== ".agent/doc-map.yml") {
      assert.equal(body, await snapshotBody(file));
    }
  }
  const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  assert.deepEqual(pkg.scripts, EXPECTED_SCRIPTS);
  const docMap = await readFile(join(target, ".agent", "doc-map.yml"), "utf8");
  assert.match(docMap, /path: "docs\/INDEX\.md"/);
  assert.doesNotMatch(docMap, /path: "README\.md"|path: "llms\.txt"/);
});

test("existing repo code roots are assigned to CANON in the generated doc map", async () => {
  const target = await makeTarget();
  await mkdir(join(target, "bin"));
  await mkdir(join(target, "src"));

  await writeDocSystem.apply(makeCtx(target));

  const docMap = await readFile(join(target, ".agent", "doc-map.yml"), "utf8");
  assert.match(docMap, /owns: \[.*"bin\/\*\*".*"src\/\*\*".*\]/);
  assert.match(docMap, /bin: "docs\/CANON\.md"/);
  assert.match(docMap, /src: "docs\/CANON\.md"/);
  assert.doesNotMatch(docMap, /node_modules:/);
});

test("check, apply, verify, and re-apply are idempotent", async () => {
  const target = await makeTarget();
  const ctx = makeCtx(target);
  assert.equal(await writeDocSystem.check(ctx), "needs-apply");
  await writeDocSystem.apply(ctx);
  assert.equal(await writeDocSystem.check(ctx), "already-done");
  assert.deepEqual(await writeDocSystem.verify(ctx), { ok: true });
  const before = await Promise.all([...EXPECTED_FILES, "package.json"].map((file) => readFile(join(target, file), "utf8")));
  await writeDocSystem.apply(ctx);
  const after = await Promise.all([...EXPECTED_FILES, "package.json"].map((file) => readFile(join(target, file), "utf8")));
  assert.deepEqual(after, before);
});

test("apply repairs drift while preserving repo-local markdown frontmatter", async () => {
  const target = await makeTarget();
  await mkdir(join(target, "docs", "agent-process"), { recursive: true });
  await writeFile(
    join(target, "docs", "agent-process", "doc-system.md"),
    "---\nsummary: Local contract\nstatus: active\n---\n\n# Stale body\n",
    "utf8"
  );
  const ctx = makeCtx(target);
  await writeDocSystem.apply(ctx);
  const body = await readFile(join(target, "docs", "agent-process", "doc-system.md"), "utf8");
  assert.match(body, /^---\nsummary: Local contract\nstatus: active\n---\n/m);
  assert.doesNotMatch(body, /# Stale body/);
  assert.equal(await writeDocSystem.check(ctx), "already-done");
});

test("apply never overwrites consumer-owned CANON or INDEX content", async () => {
  const target = await makeTarget();
  await mkdir(join(target, "docs"), { recursive: true });
  await writeFile(join(target, "docs", "CANON.md"), "# Local canon\n", "utf8");
  await writeFile(join(target, "docs", "INDEX.md"), "# Local index\n", "utf8");
  const ctx = makeCtx(target);
  await writeDocSystem.apply(ctx);
  assert.equal(await readFile(join(target, "docs", "CANON.md"), "utf8"), "# Local canon\n");
  assert.equal(await readFile(join(target, "docs", "INDEX.md"), "utf8"), "# Local index\n");
  assert.equal(await writeDocSystem.check(ctx), "already-done");
  assert.deepEqual(await writeDocSystem.verify(ctx), { ok: true });
});

test("apply records every doc-floor file in the setup manifest", async () => {
  const target = await makeTarget();
  const ctx = makeCtx(target);
  await writeDocSystem.apply(ctx);
  assert.deepEqual(ctx.manifest.createdFiles.map((entry) => entry.path), [...EXPECTED_FILES, "package.json"]);
});
