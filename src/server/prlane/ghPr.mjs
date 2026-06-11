import { runCommand } from "../lib/commandRunner.mjs";

async function ghRunner(args, { stdin = null } = {}) {
  return runCommand("gh", args, { stdin, timeoutMs: 60_000 });
}

function errorText(res) {
  return res.stderr?.trim() || res.stdout?.trim() || `exit ${res.code}`;
}

function parsePrUrl(stdout) {
  const url = stdout.trim();
  const match = /\/pull\/(\d+)\s*$/.exec(url);
  if (!match) throw new Error(`gh pr create returned no pull request URL: ${url || "(empty stdout)"}`);
  return { number: Number(match[1]), url };
}

export async function createDraftPr({ repoSlug, base, head, title, body, draft = true, runGh = ghRunner }) {
  const args = [
    "pr",
    "create",
    "--repo",
    repoSlug,
    "--base",
    base,
    "--head",
    head,
    "--title",
    title,
  ];
  if (draft) args.push("--draft");
  args.push("--body-file", "-");

  const res = await runGh(
    args,
    { stdin: body },
  );
  if (res.code !== 0) throw new Error(`gh pr create failed: ${errorText(res)}`);
  return parsePrUrl(res.stdout);
}

export async function addPrLabel({ repoSlug, prNumber, label, runGh = ghRunner }) {
  const res = await runGh(["pr", "edit", String(prNumber), "--repo", repoSlug, "--add-label", label]);
  if (res.code !== 0) throw new Error(`gh pr edit failed: ${errorText(res)}`);
}

export async function listPrChecks({ repoSlug, prNumber, runGh = ghRunner }) {
  const res = await runGh(["pr", "checks", String(prNumber), "--repo", repoSlug, "--json", "name,state,bucket,link,workflow"]);
  if (res.code !== 0 && res.code !== 8) throw new Error(`gh pr checks failed: ${errorText(res)}`);
  try {
    return res.stdout.trim() ? JSON.parse(res.stdout) : [];
  } catch (err) {
    throw new Error(`gh pr checks returned unparseable JSON: ${err.message}`);
  }
}

export async function queueAutoMerge({ repoSlug, prNumber, method = "squash", runGh = ghRunner }) {
  const methodFlag = method === "merge" ? "--merge" : method === "rebase" ? "--rebase" : "--squash";
  const res = await runGh([
    "pr",
    "merge",
    String(prNumber),
    "--repo",
    repoSlug,
    "--auto",
    methodFlag,
    "--delete-branch",
  ]);
  if (res.code !== 0) throw new Error(`gh pr merge --auto failed: ${errorText(res)}`);
}

export async function getPrView({ repoSlug, prNumber, runGh = ghRunner }) {
  const res = await runGh(["pr", "view", String(prNumber), "--repo", repoSlug, "--json", "labels,body"]);
  if (res.code !== 0) throw new Error(`gh pr view failed: ${errorText(res)}`);
  try {
    return res.stdout.trim() ? JSON.parse(res.stdout) : { labels: [], body: "" };
  } catch (err) {
    throw new Error(`gh pr view returned unparseable JSON: ${err.message}`);
  }
}
