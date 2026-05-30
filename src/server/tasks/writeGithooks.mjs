import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const FILES = [
  ".githooks/commit-msg",
  ".githooks/pre-commit",
  ".githooks/scripts/install-githooks.sh",
  ".githooks/scripts/owner-maintenance.sh",
  ".githooks/scripts/test-owner-maintenance.sh",
];

function scrubHookBody(body) {
  return body
    .replace(/\s*\(F18, ArchonVII\/repo-template#16\)/g, "")
    .replace(/\s*\(F18, repo-template#16\)/g, "")
    .replace(/\s*\(F18\)/g, "")
    .replace(/See \.githooks\/(commit-msg|pre-commit) \(F18, repo-template#16\) for the rule source\./g, "See .githooks/$1 for the rule source.")
    .replace(/# Authority: Layer 5 in docs\/phase2\/hook-authority\.md\.\n/g, "")
    .replace(/# baselines \(F18\) run/g, "# baselines run");
}

export async function check(ctx) {
  return checkAllExist(ctx, FILES);
}

export async function apply(ctx) {
  const results = [];
  for (const file of FILES) {
    results.push(await writeSnapshotFile(ctx, file, { transform: scrubHookBody }));
  }
  return results;
}

export async function verify(ctx) {
  return verifyAllExist(ctx, FILES);
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.githooks to retry.`;
}
