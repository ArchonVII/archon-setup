import { runTask } from "./taskRunner.mjs";
import * as writeReadme from "../tasks/writeReadme.mjs";
import * as writeLicense from "../tasks/writeLicense.mjs";
import * as writeGitignore from "../tasks/writeGitignore.mjs";
import * as writeAgentsMd from "../tasks/writeAgentsMd.mjs";
import * as writeClaudeMd from "../tasks/writeClaudeMd.mjs";
import * as writeGeminiMd from "../tasks/writeGeminiMd.mjs";
import * as initGitAndCommit from "../tasks/initGitAndCommit.mjs";
import * as ghRepoCreateAndPush from "../tasks/ghRepoCreateAndPush.mjs";
import * as applyLabels from "../tasks/applyLabels.mjs";
import * as applyBaselineBranchProtection from "../tasks/applyBaselineBranchProtection.mjs";
import * as installWorkflow from "../tasks/installWorkflow.mjs";
import * as writeSetupManifest from "../tasks/writeSetupManifest.mjs";

const TASKS = {
  writeReadme,
  writeLicense,
  writeGitignore,
  writeAgentsMd,
  writeClaudeMd,
  writeGeminiMd,
  initGitAndCommit,
  ghRepoCreateAndPush,
  applyLabels,
  applyBaselineBranchProtection,
  installWorkflow,
  writeSetupManifest,
};

// Executes a plan from the planner. Streams events via onEvent.
// On any task failure, halts and returns the partial result.
export async function executePlan(plan, { onEvent } = {}) {
  const results = [];
  const manifest = {
    tool: "archon-setup",
    toolVersion: "0.1.0-pre",
    createdAt: new Date().toISOString(),
    owner: plan.context.owner,
    repo: plan.context.repo,
    visibility: plan.context.visibility,
    sourceSnapshots: plan.context.sourceSnapshots || {},
    selectedFeatures: plan.selectedFeatureIds,
    createdFiles: [],
    remoteActions: [],
    postChecks: plan.postChecks,
  };

  for (const unit of plan.ordered) {
    const mod = TASKS[unit.taskId];
    if (!mod) {
      const ev = { taskId: unit.taskId, kind: "error", error: `unknown task: ${unit.taskId}` };
      if (onEvent) onEvent(ev);
      results.push({ ok: false, status: "unknown-task", unit });
      return { ok: false, results, manifest };
    }
    const ctx = {
      ...plan.context,
      taskOptions: unit.options,
      featureId: unit.featureId,
      manifest,
      onEvent,
    };
    const res = await runTask({ ...mod, id: unit.taskId }, ctx);
    results.push({ ...res, unit });
    if (!res.ok) {
      return { ok: false, results, manifest };
    }
  }

  // Always write the setup manifest last (if not already in the plan).
  if (!plan.ordered.some((u) => u.taskId === "writeSetupManifest")) {
    const ctx = { ...plan.context, manifest, onEvent };
    await runTask({ ...writeSetupManifest, id: "writeSetupManifest" }, ctx);
  }

  return { ok: true, results, manifest };
}
