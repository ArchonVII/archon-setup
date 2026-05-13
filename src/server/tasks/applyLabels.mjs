import { runCommand } from "../lib/commandRunner.mjs";
import { existsSync } from "node:fs";

// Tries to locate setup-repo.mjs in the user's github-workflows checkout.
// Falls back to running it via `npx --package github:ArchonVII/github-workflows`
// once that's published, but for v0.1 we expect the local path to exist.
function findSetupScript() {
  const candidates = [
    "C:/github/github-workflows/scripts/setup-repo.mjs",
    process.env.ARCHON_GITHUB_WORKFLOWS &&
      `${process.env.ARCHON_GITHUB_WORKFLOWS}/scripts/setup-repo.mjs`,
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export async function check(ctx) {
  // Idempotent at the GitHub side — re-applying labels is a no-op.
  // We always run unless explicitly skipped.
  return "needs-apply";
}

export async function apply(ctx) {
  const script = findSetupScript();
  if (!script) {
    ctx.manifest.remoteActions.push({
      type: "labels.apply",
      result: "skipped",
      reason: "setup-repo.mjs not found locally; install ArchonVII/github-workflows or set ARCHON_GITHUB_WORKFLOWS",
    });
    return { result: "skipped" };
  }
  const args = [script, `${ctx.owner}/${ctx.repo}`, "--no-protection"];
  if (ctx.solo) args.push("--solo");
  const res = await runCommand("node", args, { timeoutMs: 120_000 });
  if (res.code !== 0) throw new Error(`setup-repo.mjs failed: ${res.stderr || res.stdout}`);
  ctx.manifest.remoteActions.push({ type: "labels.apply", result: "ok" });
  return { result: "applied", stdout: res.stdout.slice(-500) };
}

export async function verify(ctx) {
  // Quick sanity: list labels and confirm at least one of our standard ones exists.
  const probe = await runCommand(
    "gh",
    ["label", "list", "--repo", `${ctx.owner}/${ctx.repo}`, "--limit", "100"],
    { timeoutMs: 10_000 }
  );
  if (probe.code !== 0) return { ok: false, error: probe.stderr };
  const hasStandard = /type:|priority:|status:/.test(probe.stdout);
  return { ok: hasStandard };
}

export function rollbackHint(ctx) {
  return `Labels are idempotent. Re-run safely. To remove all labels manually: gh label list --repo ${ctx.owner}/${ctx.repo} --json name -q '.[].name' | xargs -I {} gh label delete --repo ${ctx.owner}/${ctx.repo} --yes {}`;
}
