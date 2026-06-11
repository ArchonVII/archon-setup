#!/usr/bin/env node
// Self-apply the root agent baseline from the repo-template snapshot through
// the SAME installer code paths consumers get (#201) — no hand-copying.
//
// Update flow, end to end: provider PR (repo-template) → npm run
// refresh-snapshots → npm run agent:self-apply → commit. Never hand-edit
// src/snapshots/** or the root copies; test/agentLifecycleScripts.test.mjs
// audits that this mechanism was used (root must equal snapshot).
//
//   npm run agent:self-apply             # repair root copies from the snapshot
//   npm run agent:self-apply -- --check  # read-only report; exits 1 on drift

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import * as agentLifecycle from "../src/server/tasks/writeAgentLifecycle.mjs";
import * as docSweep from "../src/server/tasks/writeDocSweep.mjs";
import {
  checkAllMatch,
  verifyAllMatch,
  writeSnapshotFile,
} from "../src/server/tasks/repoTemplateSnapshot.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
export const ROOT = join(dirname(MODULE_PATH), "..");

const STARTUP_BASELINE = ".agent/startup-baseline.json";

// The startup baseline rides the same installer primitives the feature tasks
// use; writeAgentsMd owns it for consumers, but its composite scope (managed
// AGENTS.md blocks, plans README, update log) is wider than the root baseline.
const startupBaselineTask = {
  name: "startup-baseline",
  check: (ctx) => checkAllMatch(ctx, [STARTUP_BASELINE]),
  apply: async (ctx) => [await writeSnapshotFile(ctx, STARTUP_BASELINE, { overwrite: true })],
  verify: (ctx) => verifyAllMatch(ctx, [STARTUP_BASELINE]),
};

// Exactly the surface test/agentLifecycleScripts.test.mjs pins byte-identical
// to the snapshot, plus the agent:* package.json entries the lifecycle task
// merges. Each entry is an installer task module: check/apply/verify.
export const TASKS = [
  { name: "agent-lifecycle", check: agentLifecycle.check, apply: agentLifecycle.apply, verify: agentLifecycle.verify },
  { name: "doc-sweep", check: docSweep.check, apply: docSweep.apply, verify: docSweep.verify },
  startupBaselineTask,
];

export async function selfApply({ targetPath = ROOT, checkOnly = false } = {}) {
  const ctx = { targetPath, repo: "archon-setup", manifest: { createdFiles: [] } };
  const report = [];
  for (const task of TASKS) {
    const status = await task.check(ctx);
    if (checkOnly || status === "already-done") {
      report.push({ task: task.name, status });
      continue;
    }
    await task.apply(ctx);
    const verdict = await task.verify(ctx);
    if (!verdict.ok) {
      throw new Error(`self-apply failed for ${task.name}: ${verdict.error}`);
    }
    report.push({ task: task.name, status: "applied" });
  }
  return { report, createdFiles: ctx.manifest.createdFiles };
}

if (resolve(process.argv[1] || "") === MODULE_PATH) {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((arg) => arg !== "--check");
  if (unknown.length) {
    console.error(`unknown option(s): ${unknown.join(" ")}`);
    process.exit(2);
  }
  const checkOnly = argv.includes("--check");

  selfApply({ checkOnly })
    .then(({ report, createdFiles }) => {
      for (const entry of report) console.log(`${entry.status}  ${entry.task}`);
      for (const file of createdFiles) console.log(`  wrote ${file.path} (${file.source})`);
      if (checkOnly && report.some((entry) => entry.status === "needs-apply")) {
        console.error("root baseline has drifted from the snapshot — run: npm run agent:self-apply");
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
