import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { waitForGitHubRepo } from "../src/server/lib/githubRepoReady.mjs";

test("waitForGitHubRepo retries until the REST API can read the repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-gh-ready-"));
  const ghPath = join(root, "fake-gh.mjs");
  const script = `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const logPath = ${JSON.stringify(join(root, "calls.txt"))};
const count = existsSync(logPath) ? Number(readFileSync(logPath, "utf8")) + 1 : 1;
writeFileSync(logPath, String(count));
if (count < 3) {
  console.error("gh: Not Found");
  process.exit(1);
}
`;
  await writeFile(ghPath, script, "utf8");

  const result = await waitForGitHubRepo("ArchonVII", "example", {
    attempts: 3,
    delayMs: 1,
    command: process.execPath,
    commandArgsPrefix: [ghPath],
  });
  assert.deepEqual(result, { ok: true, attempts: 3 });
});
