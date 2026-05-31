import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as writeClaudeMd from "../src/server/tasks/writeClaudeMd.mjs";

test("writeClaudeMd reconciles an existing Claude contract idempotently", async () => {
  const targetPath = await mkdtemp(join(tmpdir(), "archon-claude-existing-"));
  const existing = `# CLAUDE.md

## Repo-specific Claude notes

Use the local smoke-test alias before asking for review.
`;
  const ctx = {
    targetPath,
    manifest: { createdFiles: [] },
  };
  await writeFile(join(targetPath, "CLAUDE.md"), existing, "utf8");

  assert.equal(await writeClaudeMd.check(ctx), "needs-apply");
  await writeClaudeMd.apply(ctx);

  const reconciled = await readFile(join(targetPath, "CLAUDE.md"), "utf8");

  assert.match(reconciled, /Use the local smoke-test alias/);
  assert.match(reconciled, /BEGIN ARCHONVII MANAGED BLOCK: claude-pointer/);
  assert.match(reconciled, /Read \[`AGENTS\.md`\]\(\.\/AGENTS\.md\) first/);
  assert.doesNotMatch(reconciled, /One issue/);
  assert.doesNotMatch(reconciled, /## Workflow/);

  assert.equal(await writeClaudeMd.check(ctx), "already-done");
  await writeClaudeMd.apply(ctx);
  const rerun = await readFile(join(targetPath, "CLAUDE.md"), "utf8");
  assert.equal(rerun, reconciled);
});
