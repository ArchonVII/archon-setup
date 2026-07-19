import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { recordCreatedFile } from "../lib/manifest.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const FILES = ["CHANGELOG.md"];

export const DOC_CHANGELOG_SCRIPTS = {
  "docs:changelog": "node scripts/docs/changelog.mjs",
};

async function readTargetPackageJson(targetPath) {
  try {
    return JSON.parse(await readFile(safeJoin(targetPath, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function entriesAlreadyMerged(pkg) {
  const scripts = pkg?.scripts || {};
  return Object.entries(DOC_CHANGELOG_SCRIPTS).every(([key, value]) => scripts[key] === value);
}

export async function check(ctx) {
  if ((await checkAllExist(ctx, FILES)) === "needs-apply") return "needs-apply";
  return entriesAlreadyMerged(await readTargetPackageJson(ctx.targetPath)) ? "already-done" : "needs-apply";
}

export async function apply(ctx) {
  const results = await Promise.all(FILES.map((file) => writeSnapshotFile(ctx, file)));
  const existing = await readTargetPackageJson(ctx.targetPath);
  if (entriesAlreadyMerged(existing)) {
    results.push({ status: "unchanged", path: safeJoin(ctx.targetPath, "package.json") });
    return results;
  }
  const pkg = existing || {
    name: ctx.repo || (ctx.targetPath ? basename(ctx.targetPath) : "repo"),
    type: "module",
    scripts: {},
  };
  pkg.scripts = pkg.scripts || {};
  Object.assign(pkg.scripts, DOC_CHANGELOG_SCRIPTS);
  const pkgResult = await safeWriteFile(
    ctx.targetPath,
    "package.json",
    `${JSON.stringify(pkg, null, 2)}\n`,
    { overwrite: true }
  );
  recordCreatedFile(ctx, pkgResult, { path: "package.json", source: "merged:doc-changelog" });
  results.push(pkgResult);
  return results;
}

export async function verify(ctx) {
  const files = await verifyAllExist(ctx, FILES);
  if (!files.ok) return files;
  if (!entriesAlreadyMerged(await readTargetPackageJson(ctx.targetPath))) {
    return { ok: false, error: "package.json is missing the docs:changelog script" };
  }
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/CHANGELOG.md and remove the managed docs:changelog entry from package.json to retry.`;
}
