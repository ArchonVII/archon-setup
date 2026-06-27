import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import * as writeTemplateLibrary from "../src/server/tasks/writeTemplateLibrary.mjs";
import { TEMPLATE_LIBRARY_FILES } from "../src/server/tasks/writeTemplateLibrary.mjs";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "../src/server/tasks/repoTemplateSnapshot.mjs";

async function makeTarget() {
  return mkdtemp(join(tmpdir(), "archon-templates-"));
}

function makeCtx(targetPath, extra = {}) {
  return { targetPath, repo: "demo", manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] }, ...extra };
}

function snapshotBody(file) {
  return readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8").then(normalizeSnapshotText);
}

function flipLineEndings(body) {
  const lf = normalizeSnapshotText(body);
  return body.includes("\r\n") ? lf : lf.replace(/\n/g, "\r\n");
}

test("template library file list covers only templates/** snapshot files", async () => {
  assert.ok(TEMPLATE_LIBRARY_FILES.length > 20, "expected the full template artifact library");
  assert.ok(TEMPLATE_LIBRARY_FILES.every((file) => file.startsWith("templates/")));
  assert.ok(TEMPLATE_LIBRARY_FILES.includes("templates/README.md"));
  assert.ok(TEMPLATE_LIBRARY_FILES.includes("templates/MANIFEST.md"));
  assert.ok(TEMPLATE_LIBRARY_FILES.includes("templates/github/github.issue.standard.md"));
});

test("apply installs the template library matching the normalized snapshot", async () => {
  const target = await makeTarget();
  await writeTemplateLibrary.apply(makeCtx(target));
  for (const file of TEMPLATE_LIBRARY_FILES) {
    const s = await stat(join(target, file));
    assert.ok(s.isFile(), `${file} should be installed`);
    assert.equal(await readFile(join(target, file), "utf8"), await snapshotBody(file), `${file} matches snapshot`);
  }
});

test("check is needs-apply before and already-done after apply", async () => {
  const target = await makeTarget();
  assert.equal(await writeTemplateLibrary.check(makeCtx(target)), "needs-apply");
  await writeTemplateLibrary.apply(makeCtx(target));
  assert.equal(await writeTemplateLibrary.check(makeCtx(target)), "already-done");
});

test("verify passes after apply", async () => {
  const target = await makeTarget();
  await writeTemplateLibrary.apply(makeCtx(target));
  assert.deepEqual(await writeTemplateLibrary.verify(makeCtx(target)), { ok: true });
});

test("check and verify tolerate CRLF/LF differences for managed template files", async () => {
  const target = await makeTarget();
  for (const file of TEMPLATE_LIBRARY_FILES) {
    await mkdir(join(target, file, ".."), { recursive: true });
    const snapshot = await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8");
    await writeFile(join(target, file), flipLineEndings(snapshot), "utf8");
  }

  assert.equal(await writeTemplateLibrary.check(makeCtx(target)), "already-done");
  assert.deepEqual(await writeTemplateLibrary.verify(makeCtx(target)), { ok: true });
});

test("check and verify catch drift and apply repairs it", async () => {
  const target = await makeTarget();
  await writeTemplateLibrary.apply(makeCtx(target));
  const file = "templates/github/github.issue.standard.md";
  await writeFile(join(target, file), "# drifted\n", "utf8");
  assert.equal(await writeTemplateLibrary.check(makeCtx(target)), "needs-apply");
  assert.equal((await writeTemplateLibrary.verify(makeCtx(target))).ok, false);
  await writeTemplateLibrary.apply(makeCtx(target));
  assert.equal(await readFile(join(target, file), "utf8"), await snapshotBody(file), "drift repaired");
  assert.equal(await writeTemplateLibrary.check(makeCtx(target)), "already-done");
});

test("apply records every installed template file in the manifest", async () => {
  const target = await makeTarget();
  const ctx = makeCtx(target);
  await writeTemplateLibrary.apply(ctx);
  const paths = ctx.manifest.createdFiles.map((file) => file.path);
  for (const file of TEMPLATE_LIBRARY_FILES) assert.ok(paths.includes(file), `${file} recorded`);
});
