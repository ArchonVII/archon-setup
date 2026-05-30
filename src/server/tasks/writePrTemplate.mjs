import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const FILES = [".github/PULL_REQUEST_TEMPLATE.md"];

export async function check(ctx) {
  return checkAllExist(ctx, FILES);
}

export async function apply(ctx) {
  return writeSnapshotFile(ctx, ".github/PULL_REQUEST_TEMPLATE.md");
}

export async function verify(ctx) {
  return verifyAllExist(ctx, FILES);
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.github/PULL_REQUEST_TEMPLATE.md to retry.`;
}
