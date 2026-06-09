import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeDocSweep from "../src/server/tasks/writeDocSweep.mjs";
import { DOC_SWEEP_FILES } from "../src/server/tasks/writeDocSweep.mjs";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "../src/server/tasks/repoTemplateSnapshot.mjs";

async function makeTarget() {
  return mkdtemp(join(tmpdir(), "archon-docsweep-"));
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

test("apply installs the doc-sweep runner + spec matching the normalized snapshot", async () => {
  const target = await makeTarget();
  await writeDocSweep.apply(makeCtx(target));
  for (const file of DOC_SWEEP_FILES) {
    const s = await stat(join(target, file));
    assert.ok(s.isFile(), `${file} should be installed`);
    assert.equal(await readFile(join(target, file), "utf8"), await snapshotBody(file), `${file} matches snapshot`);
  }
});

test("check is needs-apply before and already-done after apply", async () => {
  const target = await makeTarget();
  assert.equal(await writeDocSweep.check(makeCtx(target)), "needs-apply");
  await writeDocSweep.apply(makeCtx(target));
  assert.equal(await writeDocSweep.check(makeCtx(target)), "already-done");
});

test("verify passes after apply", async () => {
  const target = await makeTarget();
  await writeDocSweep.apply(makeCtx(target));
  assert.deepEqual(await writeDocSweep.verify(makeCtx(target)), { ok: true });
});

test("check/verify tolerate CRLF/LF differences for managed snapshot files", async () => {
  const target = await makeTarget();
  for (const file of DOC_SWEEP_FILES) {
    await mkdir(join(target, file, ".."), { recursive: true });
    const snapshot = await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8");
    await writeFile(join(target, file), flipLineEndings(snapshot), "utf8");
  }

  assert.equal(await writeDocSweep.check(makeCtx(target)), "already-done");
  assert.deepEqual(await writeDocSweep.verify(makeCtx(target)), { ok: true });
});

test("check/verify catch a drifted managed file and apply repairs it (#95 helpers)", async () => {
  const target = await makeTarget();
  await writeDocSweep.apply(makeCtx(target));
  const file = "scripts/doc-sweep/lib.mjs";
  await writeFile(join(target, file), "// drifted by hand\n");
  assert.equal(await writeDocSweep.check(makeCtx(target)), "needs-apply");
  assert.equal((await writeDocSweep.verify(makeCtx(target))).ok, false);
  await writeDocSweep.apply(makeCtx(target));
  assert.equal(await readFile(join(target, file), "utf8"), await snapshotBody(file), "drift repaired");
  assert.equal(await writeDocSweep.check(makeCtx(target)), "already-done");
});

test("apply is idempotent — re-apply leaves the files byte-identical", async () => {
  const target = await makeTarget();
  await writeDocSweep.apply(makeCtx(target));
  const first = await Promise.all(DOC_SWEEP_FILES.map((f) => readFile(join(target, f), "utf8")));
  await writeDocSweep.apply(makeCtx(target));
  const second = await Promise.all(DOC_SWEEP_FILES.map((f) => readFile(join(target, f), "utf8")));
  assert.deepEqual(second, first, "re-applying must not change any managed file");
});

test("apply records every installed file in the manifest", async () => {
  const target = await makeTarget();
  const ctx = makeCtx(target);
  await writeDocSweep.apply(ctx);
  const paths = ctx.manifest.createdFiles.map((f) => f.path);
  for (const file of DOC_SWEEP_FILES) assert.ok(paths.includes(file), `${file} recorded`);
});

test("apply preserves doc-sweep spec YAML frontmatter while repairing baseline content", async () => {
  const target = await makeTarget();
  await mkdir(join(target, "docs", "agent-process"), { recursive: true });
  await writeFile(
    join(target, "docs", "agent-process", "doc-sweep.md"),
    "---\nsummary: Local doc sweep process\nstatus: active\n---\n\n# Old Doc Sweep\n\nRepo-local wiki metadata must survive repair.\n",
    "utf8"
  );

  await writeDocSweep.apply(makeCtx(target));

  const body = await readFile(join(target, "docs", "agent-process", "doc-sweep.md"), "utf8");
  assert.match(body, /^---\nsummary: Local doc sweep process\nstatus: active\n---\n\n# Doc Sweep-Up/m);
  assert.doesNotMatch(body, /# Old Doc Sweep/);
  assert.equal(await writeDocSweep.check(makeCtx(target)), "already-done");
  assert.deepEqual(await writeDocSweep.verify(makeCtx(target)), { ok: true });
});
