import { spawn } from "node:child_process";

// Runs a command, captures stdout/stderr, never logs the value of stdin.
// stdin: optional string (e.g. secret value) — passed through but never logged.
export function runCommand(cmd, args, { cwd, env, timeoutMs = 60_000, stdin = null } = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      stdio: stdin == null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));

    child.on("error", (err) => {
      clearTimeout(timer);
      rejectP(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectP(new Error(`command timed out after ${timeoutMs}ms: ${cmd}`));
      } else {
        resolveP({ code, stdout, stderr });
      }
    });

    if (stdin != null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}
