import { runCommand } from "../lib/commandRunner.mjs";

export async function checkGhAuth() {
  try {
    const { code, stdout, stderr } = await runCommand(
      "gh",
      ["auth", "status", "--hostname", "github.com"],
      { timeoutMs: 8000 }
    );
    if (code !== 0) {
      return {
        id: "gh.auth",
        status: "red",
        detail: "gh is installed but not authenticated to github.com",
        fix: "Run `gh auth login` in a terminal, then return here.",
        error: stderr.trim() || stdout.trim(),
      };
    }
    // gh auth status writes to stderr historically; combine for parsing.
    const combined = (stdout + "\n" + stderr).trim();
    const accountMatch = /account\s+([^\s]+)/i.exec(combined);
    const account = accountMatch ? accountMatch[1] : null;
    return {
      id: "gh.auth",
      status: "green",
      detail: account ? `Authenticated as ${account}` : "Authenticated to github.com",
      account,
    };
  } catch (err) {
    return {
      id: "gh.auth",
      status: "red",
      detail: "gh not available",
      error: err.message,
    };
  }
}
