import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

function template({ repo, owner }) {
  return `# ${repo}

One-sentence description: what this is and who it's for.

## Quickstart

\`\`\`bash
git clone https://github.com/${owner}/${repo}
cd ${repo}
# install / run commands here
\`\`\`

## What this is

A paragraph or two of context. What problem does it solve? What's the
shape of the system?

## Status

Experimental — created ${new Date().toISOString().slice(0, 10)}.

## License

See [LICENSE](./LICENSE).
`;
}

export async function check(ctx) {
  const full = safeJoin(ctx.targetPath, "README.md");
  try {
    await access(full, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const content = template({ repo: ctx.repo, owner: ctx.owner });
  const res = await safeWriteFile(ctx.targetPath, "README.md", content);
  ctx.manifest.createdFiles.push({ path: "README.md", source: "template:readme" });
  return res;
}

export async function verify(ctx) {
  const full = safeJoin(ctx.targetPath, "README.md");
  try {
    await access(full, constants.F_OK);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/README.md to retry.`;
}
