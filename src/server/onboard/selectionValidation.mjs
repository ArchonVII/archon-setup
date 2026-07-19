import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRegistry, resolveSelection } from "../planner/buildPlan.mjs";
import { REPO_TEMPLATE_SNAPSHOT } from "../tasks/repoTemplateSnapshot.mjs";
import {
  normalizeRepoPath,
  relativeMarkdownTargets,
  renderSelectionAwareSeed,
} from "../tasks/selectionAwareMarkdown.mjs";
import { generateStartupBaseline } from "../tasks/startupBaseline.mjs";

function findingKey(finding) {
  return [finding.code, finding.path || "", finding.sourcePath || "", finding.targetPath || ""].join("\0");
}

// Validate the generated startup floor and the relative links in every selected
// repo-template Markdown source against the same resolved install closure. The
// injected baseline and reader keep adversarial tests independent of snapshots.
export async function validateSelectionSurface({
  selectedFeatureIds,
  features,
  baseline = generateStartupBaseline(selectedFeatureIds, features),
  readSnapshot,
}) {
  const resolved = resolveSelection(features, selectedFeatureIds);
  const selectedIds = resolved.map((feature) => feature.id);
  const installs = resolved.flatMap((feature) => feature.installs || []);
  const installedPaths = new Set(installs.map((install) => normalizeRepoPath(install.path)));
  const findings = [];

  for (const requiredPath of baseline.required || []) {
    const path = normalizeRepoPath(requiredPath);
    if (!installedPaths.has(path)) {
      findings.push({
        code: "missing-selected-baseline-path",
        path,
        message: `Generated startup baseline requires ${path}, but the selected feature closure does not install it.`,
      });
    }
  }

  const markdownSources = installs
    .filter((install) => install.source?.startsWith("repo-template:") && install.path.toLowerCase().endsWith(".md"))
    .map((install) => ({
      outputPath: normalizeRepoPath(install.path),
      snapshotPath: normalizeRepoPath(install.source.slice("repo-template:".length)),
    }))
    .sort((a, b) => a.outputPath.localeCompare(b.outputPath));

  for (const source of markdownSources) {
    let body;
    try {
      body = await readSnapshot(source.snapshotPath);
    } catch (error) {
      findings.push({
        code: "missing-selected-template-source",
        sourcePath: source.outputPath,
        snapshotPath: source.snapshotPath,
        message: `${source.outputPath} selects missing repo-template source ${source.snapshotPath}: ${error.message}`,
      });
      continue;
    }
    const selectedBody = renderSelectionAwareSeed(body, source.outputPath, installedPaths);
    for (const targetPath of relativeMarkdownTargets(selectedBody, source.outputPath)) {
      if (!installedPaths.has(targetPath)) {
        findings.push({
          code: "dangling-selected-markdown-link",
          sourcePath: source.outputPath,
          targetPath,
          message: `${source.outputPath} links to ${targetPath}, but the selected feature closure does not install that target.`,
        });
      }
    }
  }

  const deduped = [...new Map(findings.map((finding) => [findingKey(finding), finding])).values()].sort((a, b) =>
    findingKey(a).localeCompare(findingKey(b))
  );
  return {
    ok: deduped.length === 0,
    selectedFeatureIds: selectedIds,
    baselineVersion: baseline.version,
    checked: {
      baselineRequiredPaths: (baseline.required || []).length,
      repoTemplateMarkdownSources: markdownSources.length,
    },
    findings: deduped,
  };
}

export async function validateSelectedRepoTemplateSurface(selectedFeatureIds) {
  const { features } = await loadRegistry();
  return validateSelectionSurface({
    selectedFeatureIds,
    features,
    readSnapshot: (snapshotPath) => readFile(join(REPO_TEMPLATE_SNAPSHOT, ...snapshotPath.split("/")), "utf8"),
  });
}

export async function validatePlanSelection(plan) {
  return validateSelectedRepoTemplateSurface(plan.baselineFeatureIds || plan.selectedFeatureIds || []);
}

export async function attachSelectionValidation(plan, { validateSelection = validatePlanSelection } = {}) {
  const selectionValidation = await validateSelection(plan);
  const retainedWarnings = (plan.warnings || []).filter(
    (warning) => warning.feature !== "onboarding.selection-contract"
  );
  return {
    ...plan,
    selectionValidation,
    warnings: [...retainedWarnings, ...selectionValidationWarnings(selectionValidation)],
  };
}

export function selectionValidationWarnings(validation) {
  return validation.findings.map((finding) => ({
    feature: "onboarding.selection-contract",
    ...finding,
    severity: "error",
    blocking: true,
  }));
}
