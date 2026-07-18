import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

import { loadRegistry, resolveSelection } from "../planner/buildPlan.mjs";
import { REPO_TEMPLATE_SNAPSHOT } from "../tasks/repoTemplateSnapshot.mjs";
import { generateStartupBaseline } from "../tasks/startupBaseline.mjs";

const MARKDOWN_LINK = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function normalizeRepoPath(path) {
  return posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function markdownTarget(rawTarget, sourcePath) {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const close = target.indexOf(">");
    if (close < 0) return null;
    target = target.slice(1, close);
  } else {
    target = target.split(/\s+/, 1)[0];
  }
  target = target.split("#", 1)[0].split("?", 1)[0];
  if (!target || target.startsWith("#") || target.startsWith("/") || EXTERNAL_SCHEME.test(target)) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  return normalizeRepoPath(posix.join(posix.dirname(sourcePath), target));
}

function relativeMarkdownTargets(body, sourcePath) {
  const withoutCodeExamples = body
    .replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/`+[^`\n]*`+/g, (span) => span.replace(/[^\n]/g, " "));
  const targets = new Set();
  for (const match of withoutCodeExamples.matchAll(MARKDOWN_LINK)) {
    const target = markdownTarget(match[1], sourcePath);
    if (target) targets.add(target);
  }
  return [...targets].sort();
}

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
    for (const targetPath of relativeMarkdownTargets(body, source.outputPath)) {
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

export function selectionValidationWarnings(validation) {
  return validation.findings.map((finding) => ({
    feature: "onboarding.selection-contract",
    ...finding,
    severity: "error",
    blocking: true,
  }));
}
