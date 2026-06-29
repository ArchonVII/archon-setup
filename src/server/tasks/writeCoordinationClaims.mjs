import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";

// The live-claims location for active multi-agent coordination. Agents drop one
// `<lane>.json` claim file here per active lane; `agent:status`
// (scripts/agent/status.mjs) reports coordination "installed" when this
// directory exists, and doc-sweep's claims loader reads `claims/*.json` to tell
// active lanes from stale worktree docs. The directory ships empty, kept under
// version control by a `.gitkeep` placeholder (git does not track empty dirs).
// This is the companion to the .agent/coordination/board.md human surface and
// is only installed by the opt-in agent-workflow.coordination-board feature, so
// repos that do not run multiple agents stay claims-absent and doc-sweep keeps
// its existing leave/log behavior.
const CLAIMS_PLACEHOLDER = ".agent/coordination/claims/.gitkeep";

const PLACEHOLDER_BODY = [
  "# Live agent claims live here, one `<lane>.json` per active lane.",
  "# This file only keeps the otherwise-empty directory under version control.",
  "# agent:status reports coordination installed when this directory exists;",
  "# doc-sweep reads claims/*.json to distinguish active lanes from stale docs.",
  "",
].join("\n");

export async function check(ctx) {
  const target = safeJoin(ctx.targetPath, CLAIMS_PLACEHOLDER);
  try {
    await access(target, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const result = await safeWriteFile(ctx.targetPath, CLAIMS_PLACEHOLDER, PLACEHOLDER_BODY);
  recordCreatedFile(ctx, result, {
    path: CLAIMS_PLACEHOLDER,
    source: "generated:coordination-claims-placeholder",
  });
  return result;
}

export async function verify(ctx) {
  const target = safeJoin(ctx.targetPath, CLAIMS_PLACEHOLDER);
  try {
    await access(target, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `claims location missing: ${err.message}` };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/${CLAIMS_PLACEHOLDER} to retry.`;
}
