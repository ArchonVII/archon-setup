import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { hasCurrentManagedBlock, reconcileManagedBlock } from "./managedMarkdownBlock.mjs";

export const TEMPLATE = `# CLAUDE.md

Read [\`AGENTS.md\`](./AGENTS.md) first. Claude-specific addenda below.

## Claude-specific notes

(None yet. Add here only when Claude's behavior should diverge from the cross-tool contract.)
`;
const CLAUDE_MANAGED_BLOCK_ID = "claude-pointer";
const CLAUDE_MANAGED_BODY = `Read [\`AGENTS.md\`](./AGENTS.md) first.

Shared workflow and coordination rules belong in AGENTS.md. Keep this file limited to Claude-specific notes.`;

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, "CLAUDE.md");
  try {
    const current = await readFile(full, "utf8");
    return current === TEMPLATE
      || hasCurrentManagedBlock(current, CLAUDE_MANAGED_BLOCK_ID, CLAUDE_MANAGED_BODY)
      ? "already-done"
      : "needs-apply";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const full = safeJoin(ctx.targetPath, "CLAUDE.md");
  let res;
  try {
    const current = await readFile(full, "utf8");
    if (current === TEMPLATE) {
      res = { status: "unchanged", path: full };
    } else {
      const reconciled = reconcileManagedBlock(
        current,
        CLAUDE_MANAGED_BLOCK_ID,
        CLAUDE_MANAGED_BODY
      );
      if (reconciled.changed) {
        await writeFile(full, reconciled.body, "utf8");
        res = { status: "updated", path: full };
      } else {
        res = { status: "unchanged", path: full };
      }
    }
  } catch {
    res = await safeWriteFile(ctx.targetPath, "CLAUDE.md", TEMPLATE);
  }
  recordCreatedFile(ctx, res, { path: "CLAUDE.md", source: "template:claude-md" });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, "CLAUDE.md");
  try {
    const current = await readFile(full, "utf8");
    if (
      current !== TEMPLATE
      && !hasCurrentManagedBlock(current, CLAUDE_MANAGED_BLOCK_ID, CLAUDE_MANAGED_BODY)
    ) {
      return { ok: false, error: "CLAUDE.md is missing the ArchonVII AGENTS.md pointer" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/CLAUDE.md to retry.`;
}
