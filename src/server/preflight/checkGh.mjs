import { runCommand } from "../lib/commandRunner.mjs";

export async function checkGh() {
  try {
    const { code, stdout } = await runCommand("gh", ["--version"], { timeoutMs: 5000 });
    if (code !== 0) return { id: "gh", status: "red", detail: "gh --version exited non-zero" };
    const firstLine = stdout.split("\n")[0].trim();
    return { id: "gh", status: "green", detail: firstLine };
  } catch (err) {
    return {
      id: "gh",
      status: "red",
      detail: "gh not found on PATH",
      fix: "Install GitHub CLI: https://cli.github.com",
      error: err.message,
    };
  }
}
