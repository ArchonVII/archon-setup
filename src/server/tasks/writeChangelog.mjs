import { checkAllExist, verifyAllExist, writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const FILES = ["CHANGELOG.md"];

export async function check(ctx) {
  return checkAllExist(ctx, FILES);
}

export async function apply(ctx) {
  return Promise.all(FILES.map((file) => writeSnapshotFile(ctx, file)));
}

export async function verify(ctx) {
  return verifyAllExist(ctx, FILES);
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/CHANGELOG.md to retry.`;
}
