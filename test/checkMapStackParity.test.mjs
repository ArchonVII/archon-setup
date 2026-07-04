import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import * as writeCheckMap from "../src/server/tasks/writeCheckMap.mjs";
import { extractActiveStack, renderCheckMapBody } from "../src/server/tasks/writeCheckMap.mjs";
import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The REAL vendored gate caller (never a fixture copy): the check-map contract
// must agree with whatever stack the installed caller actually runs (#293).
const GATE_CALLER_SNAPSHOT = join(
  REPO_ROOT,
  "src",
  "snapshots",
  "github-workflows",
  "repo-required-gate.yml"
);

// An ACTIVE stack line has only blanks before `stack:`, so the caller's
// commented variants (`# stack: minimal`, `# stack: python`, ...) and prose
// (`stack=minimal`) never match. `\r?$` tolerates CRLF (snapshots have had
// CRLF drift before, see repo-template#146).
const ACTIVE_STACK_LINE = /^[ \t]*stack:[ \t]*([^\s#]+)[ \t]*\r?$/gm;

function extractStack(body, label) {
  const matches = [...body.matchAll(ACTIVE_STACK_LINE)];
  assert.equal(
    matches.length,
    1,
    `expected exactly one active "stack:" line in ${label}, found ${matches.length}`
  );
  return matches[0][1];
}

function ctx(targetPath) {
  return {
    targetPath,
    manifest: { createdFiles: [], skippedFiles: [], remoteActions: [] },
  };
}

test("emitted check-map defaults.stack matches the vendored gate caller (#293)", async () => {
  const callerStack = extractStack(
    await readFile(GATE_CALLER_SNAPSHOT, "utf8"),
    "snapshots/github-workflows/repo-required-gate.yml"
  );

  const root = await mkdtemp(join(tmpdir(), "archon-checkmap-parity-"));
  await writeCheckMap.apply(ctx(root));
  const emittedStack = extractStack(
    await readFile(join(root, ".agent", "check-map.yml"), "utf8"),
    "emitted .agent/check-map.yml"
  );

  assert.equal(
    emittedStack,
    callerStack,
    `check-map defaults.stack (${emittedStack}) disagrees with the installed ` +
      `repo-required-gate caller (${callerStack}); the documented path-to-check ` +
      `contract must not lie about the stack CI actually runs (#293)`
  );
});

test("gate caller snapshot still defaults to the node stack", async () => {
  // Pins the current truth: the ArchonVII baseline moved the caller to
  // `stack: node` in #284 (active line in the vendored
  // snapshots/github-workflows/repo-required-gate.yml). If a snapshot refresh
  // legitimately changes the default stack, update this expectation in the
  // same PR — the parity tests above/below keep holding either way.
  const callerStack = extractStack(
    await readFile(GATE_CALLER_SNAPSHOT, "utf8"),
    "snapshots/github-workflows/repo-required-gate.yml"
  );
  assert.equal(callerStack, "node");
});

test("extractActiveStack ignores commented variants and tolerates CRLF", () => {
  // Mirrors the real caller layout: one active line surrounded by the
  // commented stack menu, CRLF line endings included.
  const body = [
    "    with:",
    "      stack: node",
    "      # stack: minimal",
    "      # stack: python",
    "      # stack: polyglot",
    "      # When stack=polyglot, you MUST declare paths.",
    "",
  ].join("\r\n");
  assert.equal(extractActiveStack(body), "node");
});

test("extractActiveStack throws on zero or multiple active stack lines", () => {
  const none = ["    with:", "      # stack: minimal", ""].join("\n");
  assert.throws(() => extractActiveStack(none), /found 0/);

  const two = ["      stack: node", "      stack: python", ""].join("\n");
  assert.throws(() => extractActiveStack(two), /found 2/);
});

test("renderCheckMapBody rewrites only the defaults.stack line", async () => {
  const checkMap = ["defaults:", "  stack: minimal", "  runner: github-hosted", ""].join("\n");
  const caller = "      stack: go\n";
  assert.equal(
    renderCheckMapBody(checkMap, caller),
    ["defaults:", "  stack: go", "  runner: github-hosted", ""].join("\n")
  );
});

test("renderCheckMapBody throws when the check-map has no stack line to rewrite", () => {
  const checkMap = ["defaults:", "  runner: github-hosted", ""].join("\n");
  assert.throws(() => renderCheckMapBody(checkMap, "stack: node\n"), /found 0/);
});

test("writeCheckMap stays idempotent after the derivation change", async () => {
  // AGENTS.md adversarial check: re-running the same plan must never
  // duplicate state — second run reports already-done and rewrites nothing.
  const root = await mkdtemp(join(tmpdir(), "archon-checkmap-idem-"));
  const context = ctx(root);
  assert.equal(await writeCheckMap.check(context), "needs-apply");
  await writeCheckMap.apply(context);
  const first = await readFile(join(root, ".agent", "check-map.yml"), "utf8");
  assert.equal(await writeCheckMap.check(context), "already-done");
  assert.equal((await writeCheckMap.verify(context)).ok, true);
  const second = await readFile(join(root, ".agent", "check-map.yml"), "utf8");
  assert.equal(second, first);
});

test("onboard then audit reports the emitted check-map as present, not drifted", async () => {
  // Lockstep guard: the audit's expected body must be derived the same way
  // apply() derives the emitted body (the renderAgentsBody pattern from
  // #291/#306). If auditPlan compared against the raw repo-template snapshot,
  // every freshly onboarded repo would immediately audit as drifted.
  const root = await mkdtemp(join(tmpdir(), "archon-checkmap-audit-"));
  const features = ["agent-workflow.check-map"];

  const write = await runOnboard({ targetPath: root, features });
  assert.equal(write.ok, true);

  const audit = await runOnboard({ targetPath: root, features, audit: true });
  assert.equal(audit.ok, true);
  const item = audit.audit.items.find((entry) => entry.path === ".agent/check-map.yml");
  assert.ok(item, "expected an audit item for .agent/check-map.yml");
  assert.equal(item.status, "present");
});
