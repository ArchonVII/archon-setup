import { runTask } from "./taskRunner.mjs";
import { appendEvent, TYPE_PLAN_START, TYPE_TASK_APPLIED, TYPE_PLAN_END } from "../lib/events.mjs";
import * as writeReadme from "../tasks/writeReadme.mjs";
import * as writeLicense from "../tasks/writeLicense.mjs";
import * as writeGitignore from "../tasks/writeGitignore.mjs";
import * as writeAgentsMd from "../tasks/writeAgentsMd.mjs";
import * as writeClaudeMd from "../tasks/writeClaudeMd.mjs";
import * as writeGeminiMd from "../tasks/writeGeminiMd.mjs";
import * as writeCheckMap from "../tasks/writeCheckMap.mjs";
import * as writeCoordinationReadme from "../tasks/writeCoordinationReadme.mjs";
import * as writeCoordinationBoard from "../tasks/writeCoordinationBoard.mjs";
import * as writeGithooks from "../tasks/writeGithooks.mjs";
import * as writeGitattributes from "../tasks/writeGitattributes.mjs";
import * as writeChangelog from "../tasks/writeChangelog.mjs";
import * as writeCodeowners from "../tasks/writeCodeowners.mjs";
import * as writeDependabot from "../tasks/writeDependabot.mjs";
import * as writePrTemplate from "../tasks/writePrTemplate.mjs";
import * as initGitAndCommit from "../tasks/initGitAndCommit.mjs";
import * as ghRepoCreateAndPush from "../tasks/ghRepoCreateAndPush.mjs";
import * as applyLabels from "../tasks/applyLabels.mjs";
import * as applyBaselineBranchProtection from "../tasks/applyBaselineBranchProtection.mjs";
import * as installWorkflow from "../tasks/installWorkflow.mjs";
import * as writeSetupManifest from "../tasks/writeSetupManifest.mjs";
import * as setRepoSecrets from "../tasks/setRepoSecrets.mjs";
import * as enableCopilot from "../tasks/enableCopilot.mjs";
import * as writeAgentLifecycle from "../tasks/writeAgentLifecycle.mjs";

const TASKS = {
  writeReadme,
  writeLicense,
  writeGitignore,
  writeAgentsMd,
  writeClaudeMd,
  writeGeminiMd,
  writeCheckMap,
  writeCoordinationReadme,
  writeCoordinationBoard,
  writeGithooks,
  writeGitattributes,
  writeChangelog,
  writeCodeowners,
  writeDependabot,
  writePrTemplate,
  initGitAndCommit,
  ghRepoCreateAndPush,
  applyLabels,
  applyBaselineBranchProtection,
  installWorkflow,
  writeSetupManifest,
  setRepoSecrets,
  enableCopilot,
  writeAgentLifecycle,
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
    skippedFiles: [],
    remoteActions: [],
    postChecks: plan.postChecks,
  };

  // Best-effort event stream into the target repo's .archon/events.jsonl.
  // appendEvent never throws (see events.mjs); awaited only so the log is
  // deterministic for callers/tests, never to gate the onboarding flow.
  const targetPath = plan.context.targetPath;
  const eventRef = `${plan.context.owner ?? ""}/${plan.context.repo ?? ""}`;
  await appendEvent(targetPath, {
    type: TYPE_PLAN_START,
    ref: eventRef,
    detail: `${plan.ordered.length} task(s) planned`,
  });

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
    if (res.ok && res.status === "applied") {
      await appendEvent(targetPath, { type: TYPE_TASK_APPLIED, ref: eventRef, detail: unit.taskId });
    }
    if (!res.ok) {
      return { ok: false, results, manifest };
    }
  }

  // Always write the setup manifest last (if not already in the plan).
  if (!plan.ordered.some((u) => u.taskId === "writeSetupManifest")) {
    const ctx = { ...plan.context, manifest, onEvent };
    await runTask({ ...writeSetupManifest, id: "writeSetupManifest" }, ctx);
  }

  // plan-end fires after the manifest write completes (no skew on the success
  // path). The early-return failure path above intentionally emits no plan-end.
  await appendEvent(targetPath, {
    type: TYPE_PLAN_END,
    ref: eventRef,
    detail: `${results.filter((r) => r.ok).length}/${results.length} task(s) ok`,
  });

  return { ok: true, results, manifest };
}
