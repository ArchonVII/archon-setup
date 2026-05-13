import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

async function fetchGitignore(lang) {
  if (lang === "None") return "";
  const res = await fetch(`https://api.github.com/gitignore/templates/${lang}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`api.github.com/gitignore/templates/${lang} -> ${res.status}`);
  const json = await res.json();
  return json.source;
}

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, ".gitignore");
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const lang = ctx.taskOptions?.language || "Node";
  let body;
  if (lang === "Both") {
    const [node, py] = await Promise.all([fetchGitignore("Node"), fetchGitignore("Python")]);
    body = `# Node\n${node}\n\n# Python\n${py}\n`;
  } else {
    body = await fetchGitignore(lang);
  }
  const res = await safeWriteFile(ctx.targetPath, ".gitignore", body);
  ctx.manifest.createdFiles.push({ path: ".gitignore", source: `github:gitignore/${lang}` });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, ".gitignore");
  try {
    await access(full, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.gitignore to retry.`;
}
