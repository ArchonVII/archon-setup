import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSnapshotText, REPO_TEMPLATE_SNAPSHOT } from "./repoTemplateSnapshot.mjs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { loadRegistry, resolveSelection } from "../planner/buildPlan.mjs";
import {
  applySnapshotPreservingFrontmatter,
  markdownMatchesSnapshotAllowingFrontmatter,
  stripYamlFrontmatter,
} from "./markdownFrontmatter.mjs";
import { renderSelectionAwareSeed } from "./selectionAwareMarkdown.mjs";

export const DOC_SYSTEM_FILES = [
  ".agent/doc-map.yml",
  "docs/CANON.md",
  "docs/INDEX.md",
  "docs/agent-process/doc-system.md",
];

const FRONTMATTER_AWARE_FILES = new Set(DOC_SYSTEM_FILES.filter((file) => file.endsWith(".md")));
const SEED_ONLY_FILES = new Set(["docs/CANON.md", "docs/INDEX.md"]);

async function selectedInstallPaths(ctx) {
  const { features } = await loadRegistry();
  const selection = ctx.selectedFeatureIds || ctx.manifest?.selectedFeatures || ["foundation.doc-system"];
  const installedPaths = new Set(
    resolveSelection(features, selection)
      .flatMap((feature) => feature.installs || [])
      .map((install) => install.path)
  );
  for (const disposition of ctx.onboardingDispositions?.items || []) {
    if (disposition.choice !== "apply-central" && disposition.status === "missing" && disposition.path) {
      installedPaths.delete(disposition.path);
    }
  }
  return installedPaths;
}

async function matchesSnapshot(ctx, file) {
  let actual;
  try {
    actual = await readFile(safeJoin(ctx.targetPath, file), "utf8");
  } catch {
    return false;
  }
  if (SEED_ONLY_FILES.has(file)) return true;
  const expected = await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8");
  if (FRONTMATTER_AWARE_FILES.has(file)) {
    return markdownMatchesSnapshotAllowingFrontmatter(
      normalizeSnapshotText(actual),
      normalizeSnapshotText(stripYamlFrontmatter(expected))
    );
  }
  return normalizeSnapshotText(actual) === normalizeSnapshotText(expected);
}

export async function check(ctx) {
  for (const file of DOC_SYSTEM_FILES) {
    if (!(await matchesSnapshot(ctx, file))) return "needs-apply";
  }
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  const installedPaths = await selectedInstallPaths(ctx);
  for (const file of DOC_SYSTEM_FILES) {
    const snapshotBody = normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8"));
    let body = SEED_ONLY_FILES.has(file)
      ? renderSelectionAwareSeed(snapshotBody, file, installedPaths)
      : snapshotBody;
    if (FRONTMATTER_AWARE_FILES.has(file) && !SEED_ONLY_FILES.has(file)) {
      try {
        const current = await readFile(safeJoin(ctx.targetPath, file), "utf8");
        body = applySnapshotPreservingFrontmatter(current, stripYamlFrontmatter(snapshotBody));
      } catch {
        body = snapshotBody;
      }
    }
    const result = await safeWriteFile(ctx.targetPath, file, body, { overwrite: !SEED_ONLY_FILES.has(file) });
    recordCreatedFile(ctx, result, { path: file, source: `snapshot:repo-template/${file}` });
    results.push(result);
  }
  return results;
}

export async function verify(ctx) {
  for (const file of DOC_SYSTEM_FILES) {
    if (!(await matchesSnapshot(ctx, file))) {
      return { ok: false, error: `${file} is missing or has drifted from the repo-template baseline` };
    }
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete the managed doc-system floor under ${ctx.targetPath}/.agent/ and ${ctx.targetPath}/docs/ to retry.`;
}
