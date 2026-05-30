import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../src/server/ecosystem/writeAtomic.mjs";

test("writeAtomic writes full content and leaves no .tmp behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eco-"));
  try {
    const target = join(dir, "state.json");
    await writeAtomic(target, '{"ok":true}');
    assert.equal(await readFile(target, "utf8"), '{"ok":true}');
    await assert.rejects(readFile(target + ".tmp", "utf8")); // tmp cleaned up
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
