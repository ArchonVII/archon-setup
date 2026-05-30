import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const FILES = [".github/dependabot.yml"];

export async function check(ctx) {
  return checkAllExist(ctx, FILES);
}

export async function apply(ctx) {
  return writeSnapshotFile(ctx, ".github/dependabot.yml");
}

export async function verify(ctx) {
  return verifyAllExist(ctx, FILES);
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.github/dependabot.yml to retry.`;
}
