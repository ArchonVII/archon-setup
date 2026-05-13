import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

const TEMPLATE = `# CLAUDE.md

Read [\`AGENTS.md\`](./AGENTS.md) first. Claude-specific addenda below.

## Claude-specific notes

(None yet. Add here only when Claude's behavior should diverge from the cross-tool contract.)
`;

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, "CLAUDE.md");
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const res = await safeWriteFile(ctx.targetPath, "CLAUDE.md", TEMPLATE);
  ctx.manifest.createdFiles.push({ path: "CLAUDE.md", source: "template:claude-md" });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, "CLAUDE.md");
  try {
    await access(full, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/CLAUDE.md to retry.`;
}
