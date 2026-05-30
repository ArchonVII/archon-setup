import { runCommand } from "../lib/commandRunner.mjs";
import { waitForGitHubRepo } from "../lib/githubRepoReady.mjs";

async function repoExists(owner, repo) {
  const { code } = await runCommand("gh", ["repo", "view", `${owner}/${repo}`], { timeoutMs: 10_000 });
  return code === 0;
}

export async function check(ctx) {
  if (await repoExists(ctx.owner, ctx.repo)) return "already-done";
  return "needs-apply";
}

export async function apply(ctx) {
  const visibilityFlag = ctx.visibility === "public" ? "--public" : "--private";
  const args = [
    "repo",
    "create",
    `${ctx.owner}/${ctx.repo}`,
    visibilityFlag,
    `--source=${ctx.targetPath}`,
    "--remote=origin",
    "--push",
  ];
  const manifestArgs = args.map((arg) =>
    arg === `--source=${ctx.targetPath}` ? "--source=<targetPath>" : arg
  );
  const res = await runCommand("gh", args, { cwd: ctx.targetPath, timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(`gh repo create failed: ${res.stderr || res.stdout}`);
  const ready = await waitForGitHubRepo(ctx.owner, ctx.repo);
  if (!ready.ok) {
    throw new Error(`created repo was not readable through the GitHub REST API: ${ready.error}`);
  }
  ctx.manifest.remoteActions.push({
    type: "repo.create",
    args: manifestArgs,
    result: "ok",
  });
  return { result: "created", stdout: res.stdout.trim() };
}

export async function verify(ctx) {
  return { ok: await repoExists(ctx.owner, ctx.repo) };
}

export function rollbackHint(ctx) {
  return `If the repo was created but push failed, the local git already points at origin. Re-running is safe — repo existence is detected. To delete the remote repo: gh repo delete ${ctx.owner}/${ctx.repo} --yes`;
}
