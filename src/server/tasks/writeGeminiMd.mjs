import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

const TEMPLATE = `# GEMINI.md

Read [\`AGENTS.md\`](./AGENTS.md) first. Gemini-specific addenda below.

## Gemini-specific notes

(None yet. Add here only when Gemini's behavior should diverge from the cross-tool contract.)
`;

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, "GEMINI.md");
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const res = await safeWriteFile(ctx.targetPath, "GEMINI.md", TEMPLATE);
  ctx.manifest.createdFiles.push({ path: "GEMINI.md", source: "template:gemini-md" });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, "GEMINI.md");
  try {
    await access(full, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/GEMINI.md to retry.`;
}
