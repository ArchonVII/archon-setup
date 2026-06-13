import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectFriction, parseFrictionLedger } from "../src/server/ecosystem/collectFriction.mjs";

async function repoWithFriction(prefix, body) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, ".claude"), { recursive: true });
  const path = join(root, ".claude", "friction.md");
  await writeFile(path, body, "utf8");
  return path;
}

const HEADER = [
  "| date | category | what happened | cost | suggested fix |",
  "|---|---|---|---|---|",
].join("\n");

test("parseFrictionLedger counts valid rows by category and cost", () => {
  const summary = parseFrictionLedger(`${HEADER}
| 2026-06-11 | tooling | npm test needed a rerun | rerun | make test target clearer |
| 2026-06-12 | docs | stale instructions cost context | context-burn | update the runbook |
`);

  assert.equal(summary.state, "present");
  assert.equal(summary.count, 2);
  assert.equal(summary.byCategory.tooling, 1);
  assert.equal(summary.byCategory.docs, 1);
  assert.equal(summary.byCost.rerun, 1);
  assert.equal(summary.byCost["context-burn"], 1);
  assert.equal(summary.lastEntryAt, "2026-06-12");
  assert.equal(summary.unparsed, 0);
});

test("parseFrictionLedger counts malformed table rows as unparsed without throwing", () => {
  const summary = parseFrictionLedger(`${HEADER}
| 2026-06-10 | tooling | valid row | none | keep it short |
| 2026-06-11 | unknown | bad category | rerun | use a known category |
| 2026-06-12 | docs | bad cost | expensive | use a known cost |
| 2026-06-13 | docs | too few columns |
`);

  assert.equal(summary.count, 1);
  assert.equal(summary.byCategory.tooling, 1);
  assert.equal(summary.byCost.none, 1);
  assert.equal(summary.lastEntryAt, "2026-06-10");
  assert.equal(summary.unparsed, 3);
});

test("parseFrictionLedger treats a seeded empty ledger as present but empty", () => {
  const summary = parseFrictionLedger(`<!-- Append one row per non-bug workflow hiccup. -->
${HEADER}
`);

  assert.equal(summary.state, "present");
  assert.equal(summary.count, 0);
  assert.equal(summary.lastEntryAt, null);
  assert.equal(summary.unparsed, 0);
});

test("collectFriction returns per-source summaries and explicit no-ledger state", async () => {
  const present = await repoWithFriction("archon-friction-a-", `${HEADER}
| 2026-06-12 | skill | missing skill file | blocked | install the skill |
`);
  const missing = join(tmpdir(), "nope-does-not-exist", ".claude", "friction.md");

  const section = await collectFriction([present, missing]);

  assert.equal(section.id, "friction");
  assert.equal(section.status, "green");
  assert.equal(section.count, 1);
  assert.equal(section.noLedger, 1);
  assert.equal(section.sources.length, 2);
  assert.equal(section.byPath[present].byCategory.skill, 1);
  assert.deepEqual(section.byPath[missing], {
    state: "no-ledger",
    count: 0,
    byCategory: { tooling: 0, docs: 0, skill: 0, hook: 0, ci: 0, env: 0 },
    byCost: { rerun: 0, blocked: 0, "context-burn": 0, none: 0 },
    lastEntryAt: null,
    unparsed: 0,
  });
});
