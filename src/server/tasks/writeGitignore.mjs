import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

// Test-only fixture seam, mirroring the commandRunner ARCHON_GH_BIN seam
// (archon-setup#43 / #153). When ARCHON_GITIGNORE_BODY_JSON is set to a JSON
// object mapping template name (e.g. "Node", "Python") -> body, a matching
// entry short-circuits the real network fetch so the "hermetic / no network"
// smoke tests are truly network-free (the unauthenticated api.github.com path
// is 403-flaky under the 60/hr rate limit). Pure no-op when the env var is
// absent or has no entry for `lang`, so production keeps hitting GitHub.
function fixtureGitignore(lang) {
  const raw = process.env.ARCHON_GITIGNORE_BODY_JSON;
  if (!raw) return undefined;
  let map;
  try {
    map = JSON.parse(raw);
  } catch {
    throw new Error("ARCHON_GITIGNORE_BODY_JSON must be a JSON object of template -> body");
  }
  return map?.[lang];
}

async function fetchGitignore(lang) {
  if (lang === "None") return "";
  const fixture = fixtureGitignore(lang);
  if (fixture !== undefined) return fixture;
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
  recordCreatedFile(ctx, res, { path: ".gitignore", source: `github:gitignore/${lang}` });
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
