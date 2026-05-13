import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const PATH = ".github/archon-setup.json";

export async function check() {
  return "needs-apply";
}

export async function apply(ctx) {
  const body = JSON.stringify(ctx.manifest, null, 2) + "\n";
  // Overwrite because the manifest reflects the most recent run.
  const res = await safeWriteFile(ctx.targetPath, PATH, body, { overwrite: true });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, PATH);
  try {
    await access(full, constants.F_OK);
    const parsed = JSON.parse(await readFile(full, "utf8"));
    return { ok: parsed.tool === "archon-setup" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint() {
  return "The manifest is overwritten on every run. Nothing to roll back.";
}
