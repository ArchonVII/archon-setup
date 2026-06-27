import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "./repoTemplateSnapshot.mjs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";

export const TEMPLATE_LIBRARY_FILES = [
  "templates/README.md",
  "templates/MANIFEST.md",
  "templates/_partials/assumptions.md",
  "templates/_partials/context.md",
  "templates/_partials/evidence.md",
  "templates/_partials/footer.md",
  "templates/_partials/header.md",
  "templates/_partials/next-actions.md",
  "templates/_partials/open-questions.md",
  "templates/_partials/risks.md",
  "templates/_partials/status-banner.md",
  "templates/_partials/status-line.md",
  "templates/agent/agent.blocked-or-partial.standard.md",
  "templates/agent/agent.clarification-request.standard.md",
  "templates/agent/agent.final-response.standard.md",
  "templates/agent/agent.handoff.standard.md",
  "templates/agent/agent.presentation-message.standard.md",
  "templates/agent/agent.progress-update.standard.md",
  "templates/github/github.issue.standard.md",
  "templates/github/github.pull-request.standard.md",
  "templates/operations/operations.task-intake.standard.md",
  "templates/prompts/prompts.prompt-batch.standard.md",
  "templates/prompts/prompts.prompt-builder.standard.md",
  "templates/prompts/prompts.prompt-review.standard.md",
  "templates/prompts/prompts.prompt-run-report.standard.md",
  "templates/prompts/prompts.prompt-run-request.standard.md",
  "templates/prompts/prompts.prompt-spec.standard.md",
  "templates/reports/reports.decision-memo.standard.md",
  "templates/reports/reports.findings-report.standard.md",
];

async function snapshotBody(file) {
  return normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8"));
}

async function matchesSnapshot(ctx, file) {
  let actual;
  try {
    actual = await readFile(safeJoin(ctx.targetPath, file), "utf8");
  } catch {
    return false;
  }
  return normalizeSnapshotText(actual) === await snapshotBody(file);
}

export async function check(ctx) {
  for (const file of TEMPLATE_LIBRARY_FILES) {
    if (!(await matchesSnapshot(ctx, file))) return "needs-apply";
  }
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  for (const file of TEMPLATE_LIBRARY_FILES) {
    const body = await snapshotBody(file);
    if (await matchesSnapshot(ctx, file)) {
      results.push({ status: "already-exists", path: safeJoin(ctx.targetPath, file) });
      continue;
    }
    const result = await safeWriteFile(ctx.targetPath, file, body, { overwrite: true });
    recordCreatedFile(ctx, result, { path: file, source: `snapshot:repo-template/${file}` });
    results.push(result);
  }
  return results;
}

export async function verify(ctx) {
  for (const file of TEMPLATE_LIBRARY_FILES) {
    if (!(await matchesSnapshot(ctx, file))) {
      return { ok: false, error: `${file} is missing or has drifted from the repo-template baseline` };
    }
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/templates/ to retry.`;
}
