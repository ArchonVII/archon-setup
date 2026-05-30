import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const FILES = [".gitattributes"];

export async function check(ctx) {
  return checkAllExist(ctx, FILES);
}

export async function apply(ctx) {
  return writeSnapshotFile(ctx, ".gitattributes");
}

export async function verify(ctx) {
  return verifyAllExist(ctx, FILES);
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.gitattributes to retry.`;
}
