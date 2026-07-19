import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { loadRegistry, resolveSelection } from "../planner/buildPlan.mjs";
import { REPO_TEMPLATE_SNAPSHOT } from "../tasks/repoTemplateSnapshot.mjs";
import {
  normalizeRepoPath,
  docMapGeneratorCommands,
  relativeMarkdownTargets,
  renderSelectionAwareDocMap,
  renderSelectionAwareSeed,
} from "../tasks/selectionAwareMarkdown.mjs";
import { generateStartupBaseline } from "../tasks/startupBaseline.mjs";

function findingKey(finding) {
  return [finding.code, finding.path || "", finding.sourcePath || "", finding.targetPath || "", finding.command || ""].join("\0");
}

function relativeRuntimeTargets(body, sourcePath) {
  const targets = new Map();
  const patterns = [
    { dynamic: false, expression: /\b(?:import|export)\s+(?:[^"'()\n]*?\s+from\s+)?(["'])(\.\.?\/[^"']+)\1/g },
    { dynamic: true, expression: /\bimport\s*\(\s*(["'])(\.\.?\/[^"']+)\1\s*\)/g },
  ];
  for (const { dynamic, expression } of patterns) {
    for (const match of body.matchAll(expression)) {
      const targetPath = normalizeRepoPath(posix.join(posix.dirname(sourcePath), match[2]));
      targets.set(targetPath, { targetPath, dynamic: targets.get(targetPath)?.dynamic === false ? false : dynamic });
    }
  }
  return [...targets.values()].sort((a, b) => a.targetPath.localeCompare(b.targetPath));
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
  const managedSnapshotPaths = new Set(
    installs
      .filter((install) => install.source === `repo-template:${install.path}`)
      .map((install) => normalizeRepoPath(install.path))
  );
  const packageScripts = Object.assign(
    {},
    ...installs.filter((install) => install.kind === "merge" && install.npmScripts).map((install) => install.npmScripts)
  );
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

  const runtimeSources = installs
    .filter((install) => install.source?.startsWith("repo-template:") && install.path.toLowerCase().endsWith(".mjs"))
    .map((install) => ({
      outputPath: normalizeRepoPath(install.path),
      snapshotPath: normalizeRepoPath(install.source.slice("repo-template:".length)),
    }))
    .sort((a, b) => a.outputPath.localeCompare(b.outputPath));

  for (const source of runtimeSources) {
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
    for (const { targetPath, dynamic } of relativeRuntimeTargets(body, source.outputPath)) {
      if (!installedPaths.has(targetPath)) {
        // Provider close/doc-health runners deliberately load the docs parser
        // only when the selected contract installed a doc-map. Without that
        // activating surface the dynamic import is unreachable; with it, the
        // same missing target is a genuine execution-closure defect.
        if (dynamic && targetPath.startsWith("scripts/docs/") && !installedPaths.has(".agent/doc-map.yml")) continue;
        findings.push({
          code: "dangling-selected-runtime-import",
          sourcePath: source.outputPath,
          targetPath,
          message: `${source.outputPath} imports ${targetPath}, but the selected feature closure does not install that runtime file.`,
        });
      }
    }
  }

  let packageCommands = [];
  const docMapInstall = installs.find((install) => normalizeRepoPath(install.path) === ".agent/doc-map.yml");
  if (docMapInstall?.source?.startsWith("repo-template:")) {
    const snapshotPath = normalizeRepoPath(docMapInstall.source.slice("repo-template:".length));
    try {
      const sourceBody = await readSnapshot(snapshotPath);
      const selectedBody = renderSelectionAwareDocMap(sourceBody, installedPaths, managedSnapshotPaths);
      packageCommands = docMapGeneratorCommands(selectedBody);
      for (const command of packageCommands) {
        if (!Object.hasOwn(packageScripts, command)) {
          findings.push({
            code: "missing-selected-package-script",
            sourcePath: ".agent/doc-map.yml",
            command,
            message: `.agent/doc-map.yml references npm script ${command}, but the selected feature closure does not provide it.`,
          });
        }
      }
    } catch (error) {
      findings.push({
        code: "missing-selected-template-source",
        sourcePath: ".agent/doc-map.yml",
        snapshotPath,
        message: `.agent/doc-map.yml selects missing or invalid repo-template source ${snapshotPath}: ${error.message}`,
      });
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
      repoTemplateRuntimeSources: runtimeSources.length,
      packageCommands: packageCommands.length,
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
