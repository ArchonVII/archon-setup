import { runCommand } from "../lib/commandRunner.mjs";

export async function checkGit() {
  try {
    const { code, stdout } = await runCommand("git", ["--version"], { timeoutMs: 5000 });
    if (code !== 0) return { id: "git", status: "red", detail: "git --version exited non-zero" };
    return { id: "git", status: "green", detail: stdout.trim() };
  } catch (err) {
    return {
      id: "git",
      status: "red",
      detail: "git not found on PATH",
      fix: "Install git: https://git-scm.com/downloads",
      error: err.message,
    };
  }
}
