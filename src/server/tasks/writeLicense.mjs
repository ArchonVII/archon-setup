import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

async function fetchLicenseBody(spdx) {
  const res = await fetch(`https://api.github.com/licenses/${spdx}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`api.github.com/licenses/${spdx} -> ${res.status}`);
  const json = await res.json();
  return json.body;
}

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, "LICENSE");
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const spdx = ctx.taskOptions?.spdx || "MIT";
  let body = await fetchLicenseBody(spdx);
  // Fill `[year] [fullname]` placeholders that GitHub leaves in some templates.
  body = body
    .replace(/\[year\]/g, String(new Date().getFullYear()))
    .replace(/\[fullname\]/g, ctx.account || ctx.owner || "Copyright holder");
  const res = await safeWriteFile(ctx.targetPath, "LICENSE", body);
  ctx.manifest.createdFiles.push({ path: "LICENSE", source: `github:licenses/${spdx}`, spdx });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, "LICENSE");
  try {
    await access(full, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/LICENSE to retry.`;
}
