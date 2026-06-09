import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { confirmationPhraseFor, distribute, exitCodeFor } from "../src/distributor/distribute.mjs";

// Fleet wrapper behavior (design §9, A6): confirmation gating for --all --apply,
// JSONL run-log outside consumer worktrees, and the stable exit-code contract.

const ENTRY_ID = "2026-01-01-fleet-block";

function entry() {
  return {
    id: ENTRY_ID,
    group: "agents",
    provider: "globalUpdates",
    adapter: "markdown",
    targetRelpath: "AGENTS.md",
    wholeFile: false,
    appliesToDefault: "existing-file-only",
    inner: "## Fleet Block\n\n- Managed line.",
    markerShape: "global-update",
    anchor: { kind: "eof-append" },
    protectedBranches: ["main", "master"],
  };
}

function block(inner = "## Fleet Block\n\n- Managed line.") {
  return [
    `<!-- BEGIN ARCHONVII GLOBAL UPDATE: ${ENTRY_ID} -->`,
    inner,
    `<!-- END ARCHONVII GLOBAL UPDATE: ${ENTRY_ID} -->`,
    "",
  ].join("\n");
}

function catalog() {
  return { entries: [entry()], knownIds: new Set([ENTRY_ID]) };
}

async function makeRepo(name, agentsBody) {
  const path = await mkdtemp(join(tmpdir(), `archon-fleet-${name}-`));
  if (agentsBody !== null) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "AGENTS.md"), agentsBody, "utf8");
  }
  return { name, path, branch: "agent/test/1-fixture", dirty: false };
}

test("dry-run aggregates per-repo results and maps exit codes per A6 (20 > 10 > 0)", async () => {
  const stale = await makeRepo("stale", `# A\n\n${block("old")}`);
  const current = await makeRepo("current", `# A\n\n${block()}`);
  const adoption = await makeRepo("adoption", "# Local only\n");

  const mixed = await distribute({ repos: [stale, current, adoption], catalog: catalog() });
  assert.equal(mixed.status, "completed");
  assert.equal(mixed.mode, "dry-run");
  assert.equal(exitCodeFor(mixed), 20); // adoption present beats pending change

  const changesOnly = await distribute({ repos: [stale, current], catalog: catalog() });
  assert.equal(exitCodeFor(changesOnly), 10);

  const clean = await distribute({ repos: [current], catalog: catalog() });
  assert.equal(exitCodeFor(clean), 0);
});

test("fleet apply demands the exact confirmation phrase before touching anything", async () => {
  const repo = await makeRepo("gated", `# A\n\n${block("old")}`);
  const before = await readFile(join(repo.path, "AGENTS.md"), "utf8");

  const refused = await distribute({
    repos: [repo],
    all: true,
    apply: true,
    catalog: catalog(),
    confirmation: "yes please",
    groups: ["agents"],
  });

  assert.equal(refused.ok, false);
  assert.equal(refused.status, "confirmation-required");
  assert.equal(refused.confirmationPhrase, confirmationPhraseFor({ groups: ["agents"] }));
  assert.equal(await readFile(join(repo.path, "AGENTS.md"), "utf8"), before);

  const accepted = await distribute({
    repos: [repo],
    all: true,
    apply: true,
    catalog: catalog(),
    confirmation: confirmationPhraseFor({ groups: ["agents"] }),
    groups: ["agents"],
  });
  assert.equal(accepted.ok, true);
  assert.match(await readFile(join(repo.path, "AGENTS.md"), "utf8"), /Managed line\./);
});

test("single-target apply needs no confirmation phrase", async () => {
  const repo = await makeRepo("single", `# A\n\n${block("old")}`);

  const result = await distribute({ repos: [repo], apply: true, catalog: catalog() });

  assert.equal(result.ok, true);
  assert.match(await readFile(join(repo.path, "AGENTS.md"), "utf8"), /Managed line\./);
});

test("runs append a JSONL log entry outside the consumer repos (statuses only, no bodies)", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-fleet-log-"));
  const logPath = join(root, "distribute-log.jsonl");
  const repo = await makeRepo("logged", `# A\n\n${block("old")}`);

  await distribute({
    repos: [repo],
    apply: true,
    catalog: catalog(),
    logPath,
    now: "2026-06-09T12:00:00.000Z",
  });

  assert.ok(existsSync(logPath));
  const lines = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.kind, "distribute");
  assert.equal(logged.mode, "apply");
  assert.equal(logged.generatedAt, "2026-06-09T12:00:00.000Z");
  assert.equal(logged.results[0].repo, "logged");
  assert.equal(logged.results[0].files[0].status, "clean_apply");
  // Bodies never land in the log.
  assert.doesNotMatch(lines[0], /Managed line/);
});

test("apply exit code is 0 when nothing remains and 20 when adoption/conflict remains", async () => {
  const stale = await makeRepo("apply-clean", `# A\n\n${block("old")}`);
  const done = await distribute({ repos: [stale], apply: true, catalog: catalog() });
  assert.equal(exitCodeFor(done), 0);

  const adoption = await makeRepo("apply-adopt", "# Local only\n");
  const remaining = await distribute({ repos: [adoption], apply: true, catalog: catalog() });
  assert.equal(exitCodeFor(remaining), 20);
});

test("confirmation-required maps to exit 20 (user action remains)", async () => {
  const repo = await makeRepo("confirm-exit", `# A\n\n${block("old")}`);
  const refused = await distribute({
    repos: [repo],
    all: true,
    apply: true,
    catalog: catalog(),
    confirmation: null,
  });
  assert.equal(exitCodeFor(refused), 20);
});
