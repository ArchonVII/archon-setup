import { chmod, stat } from "node:fs/promises";
import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";
import { safeJoin } from "../lib/paths.mjs";

const FILES = [
  ".githooks/commit-msg",
  ".githooks/pre-commit",
  ".githooks/scripts/install-githooks.sh",
  ".githooks/scripts/owner-maintenance.sh",
  ".githooks/scripts/test-owner-maintenance.sh",
  ".githooks/scripts/checkout-role.sh",
  ".githooks/scripts/checkout-doctor.sh",
  ".githooks/scripts/test-checkout-role.sh",
];

export function scrubHookBody(body) {
  return body
    .replace(/\s*\(F18, ArchonVII\/repo-template#16\)/g, "")
    .replace(/\s*\(F18, repo-template#16\)/g, "")
    .replace(/\s*\(F18\)/g, "")
    .replace(/See \.githooks\/(commit-msg|pre-commit) \(F18, repo-template#16\) for the rule source\./g, "See .githooks/$1 for the rule source.")
    .replace(/# Authority: Layer 5 in docs\/phase2\/hook-authority\.md\.\n/g, "")
    .replace(/# baselines \(F18\) run/g, "# baselines run")
    // F19 worktree guard: strip repo-template-internal refs from generated
    // repos. User-facing hook text references AGENTS.md (ships everywhere), so
    // nothing user-visible is lost.
    .replace(/# Authority: docs\/adr\/001-primary-checkout-worktree-policy\.md \(F19\)\.\n/g, "")
    .replace(/# Authority: docs\/adr\/001-primary-checkout-worktree-policy\.md[^\n]*\n/g, "")
    .replace(/ \(ADR-001\)/g, "")
    .replace(/ \(F19\)/g, "")
    // test-checkout-role.sh cross-references the F18 guard by name in a comment;
    // strip the parenthetical so the generated script stays clean.
    .replace(/ \(existing F18\)/g, "");
}

export async function check(ctx) {
  const exists = await checkAllExist(ctx, FILES);
  if (exists !== "already-done") return exists;
  if (!(await allExecutable(ctx))) return "needs-apply";
  return "already-done";
}

export async function apply(ctx) {
  const results = [];
  for (const file of FILES) {
    results.push(await writeSnapshotFile(ctx, file, { transform: scrubHookBody }));
    await chmod(safeJoin(ctx.targetPath, file), 0o755);
  }
  return results;
}

export async function verify(ctx) {
  const exists = await verifyAllExist(ctx, FILES);
  if (!exists.ok) return exists;
  const nonExecutable = await firstNonExecutable(ctx);
  if (nonExecutable) return { ok: false, error: `${nonExecutable} is not executable` };
  return { ok: true };
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.githooks to retry.`;
}

async function allExecutable(ctx) {
  return !(await firstNonExecutable(ctx));
}

async function firstNonExecutable(ctx) {
  if (process.platform === "win32") return null;
  for (const file of FILES) {
    const mode = (await stat(safeJoin(ctx.targetPath, file))).mode;
    if ((mode & 0o111) === 0) return file;
  }
  return null;
}
