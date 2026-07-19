import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
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
import { renderSelectionAwareDocMap, renderSelectionAwareSeed } from "./selectionAwareMarkdown.mjs";

export const DOC_SYSTEM_FILES = [
  ".agent/doc-map.yml",
  "docs/CANON.md",
  "docs/INDEX.md",
  "docs/agent-process/doc-system.md",
  "scripts/docs/lib.mjs",
  "scripts/docs/index.mjs",
  "scripts/docs/nav.mjs",
  "scripts/docs/render.mjs",
  "scripts/docs/status.mjs",
  "scripts/docs/changelog.mjs",
];

export const DOC_SYSTEM_SCRIPTS = {
  "docs:render": "node scripts/docs/render.mjs",
  "docs:status": "node scripts/docs/status.mjs",
};

const FRONTMATTER_AWARE_FILES = new Set(DOC_SYSTEM_FILES.filter((file) => file.endsWith(".md")));
const SEED_ONLY_FILES = new Set(["docs/CANON.md", "docs/INDEX.md"]);
const IGNORED_DISCOVERED_ROOTS = new Set(["node_modules"]);

async function discoveredCodeRoots(targetPath) {
  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    return entries
      .filter((entry) =>
        entry.isDirectory()
        && !entry.name.startsWith(".")
        && !IGNORED_DISCOVERED_ROOTS.has(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function selectedContract(ctx) {
  const { features } = await loadRegistry();
  const selection = ctx.selectedFeatureIds || ctx.manifest?.selectedFeatures || ["foundation.doc-system"];
  const installs = resolveSelection(features, selection).flatMap((feature) => feature.installs || []);
  const installedPaths = new Set(installs.map((install) => install.path));
  const managedSnapshotPaths = new Set(
    installs
      .filter((install) => install.source === `repo-template:${install.path}`)
      .map((install) => install.path)
  );
  for (const disposition of ctx.onboardingDispositions?.items || []) {
    if (disposition.choice !== "apply-central" && disposition.status === "missing" && disposition.path) {
      installedPaths.delete(disposition.path);
      managedSnapshotPaths.delete(disposition.path);
    }
  }
  return { installedPaths, managedSnapshotPaths };
}

async function readTargetPackageJson(targetPath) {
  try {
    return JSON.parse(await readFile(safeJoin(targetPath, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function entriesAlreadyMerged(pkg) {
  const scripts = pkg?.scripts || {};
  return Object.entries(DOC_SYSTEM_SCRIPTS).every(([key, value]) => scripts[key] === value);
}

export async function expectedDocSystemBody(ctx, file) {
  const snapshotBody = normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8"));
  const { installedPaths, managedSnapshotPaths } = await selectedContract(ctx);
  if (file === ".agent/doc-map.yml") {
    return renderSelectionAwareDocMap(
      snapshotBody,
      installedPaths,
      managedSnapshotPaths,
      await discoveredCodeRoots(ctx.targetPath)
    );
  }
  if (SEED_ONLY_FILES.has(file)) return renderSelectionAwareSeed(snapshotBody, file, installedPaths);
  return snapshotBody;
}

async function matchesSnapshot(ctx, file) {
  let actual;
  try {
    actual = await readFile(safeJoin(ctx.targetPath, file), "utf8");
  } catch {
    return false;
  }
  if (SEED_ONLY_FILES.has(file)) return true;
  const expected = await expectedDocSystemBody(ctx, file);
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
  if (!entriesAlreadyMerged(await readTargetPackageJson(ctx.targetPath))) return "needs-apply";
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  for (const file of DOC_SYSTEM_FILES) {
    const snapshotBody = normalizeSnapshotText(await readFile(join(REPO_TEMPLATE_SNAPSHOT, file), "utf8"));
    let body = await expectedDocSystemBody(ctx, file);
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

  const existing = await readTargetPackageJson(ctx.targetPath);
  const pkg = existing || {
    name: ctx.repo || (ctx.targetPath ? basename(ctx.targetPath) : "repo"),
    type: "module",
    scripts: {},
  };
  pkg.scripts = pkg.scripts || {};
  Object.assign(pkg.scripts, DOC_SYSTEM_SCRIPTS);
  const pkgResult = await safeWriteFile(
    ctx.targetPath,
    "package.json",
    `${JSON.stringify(pkg, null, 2)}\n`,
    { overwrite: true }
  );
  recordCreatedFile(ctx, pkgResult, { path: "package.json", source: "merged:doc-system" });
  results.push(pkgResult);
  return results;
}

export async function verify(ctx) {
  for (const file of DOC_SYSTEM_FILES) {
    if (!(await matchesSnapshot(ctx, file))) {
      return { ok: false, error: `${file} is missing or has drifted from the repo-template baseline` };
    }
  }
  if (!entriesAlreadyMerged(await readTargetPackageJson(ctx.targetPath))) {
    return { ok: false, error: "package.json is missing the docs:* generator scripts" };
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete the managed doc-system floor under ${ctx.targetPath}/.agent/, ${ctx.targetPath}/docs/, and ${ctx.targetPath}/scripts/docs/, then remove the managed docs:* entries from package.json to retry.`;
}
