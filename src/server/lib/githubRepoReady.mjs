import { runCommand } from "./commandRunner.mjs";

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_DELAY_MS = 1_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForGitHubRepo(owner, repo, {
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  command = "gh",
  commandArgsPrefix = [],
} = {}) {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await runCommand(
      command,
      [...commandArgsPrefix, "api", `repos/${owner}/${repo}`, "--silent"],
      { timeoutMs: 10_000 }
    );
    if (res.code === 0) return { ok: true, attempts: attempt };
    lastError = res.stderr || res.stdout;
    if (attempt < attempts) await sleep(delayMs);
  }
  return { ok: false, attempts, error: lastError };
}
