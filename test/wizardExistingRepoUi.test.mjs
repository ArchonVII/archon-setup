import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("wizard source exposes existing-repo mode, audit, confirmation, and handoff cues", async () => {
  const source = await readFile(new URL("../src/ui/app.mjs", import.meta.url), "utf8");

  assert.match(source, /Existing repo/);
  assert.match(source, /plan\.audit/);
  assert.match(source, /existingRepoConfirmed/);
  assert.match(source, /present/);
  assert.match(source, /missing/);
  assert.match(source, /drifted/);
  assert.match(source, /applied/);
  assert.match(source, /skipped/);
  assert.match(source, /failed/);
  assert.match(source, /foundation\.agents,foundation\.claude-md/);
  assert.match(source, /tighten-required-gate/);
});
