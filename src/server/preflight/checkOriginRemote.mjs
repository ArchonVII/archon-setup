import { runCommand } from "../lib/commandRunner.mjs";
import { parseGithubRemote } from "../lib/parseGithubRemote.mjs";

// Detects an existing GitHub `origin` remote in the target dir.
// Pure detection of repository STATE — not a capability, not a red/green check.
// Degrades to { originDetected: null } on any failure (no git, no repo, no origin).
export async function checkOriginRemote(target) {
  if (!target) return { originDetected: null };
  try {
    const res = await runCommand("git", ["-C", target, "remote", "get-url", "origin"], { timeoutMs: 10_000 });
    if (res.code !== 0) return { originDetected: null };
    return { originDetected: parseGithubRemote(res.stdout.trim()) };
  } catch {
    return { originDetected: null };
  }
}
