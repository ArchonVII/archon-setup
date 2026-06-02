import { spawn } from "node:child_process";

// Test-only injection seam for the `gh`/`git` binaries (archon-setup#43,
// no-remote smoke-test policy — see docs/superpowers/specs/2026-06-01-
// distribution-lifecycle-rollout-design.md). When the matching env var is set,
// the binary is substituted and an optional JSON-array args prefix is prepended,
// so a smoke test can run the remote path against a local mock + bare repo with
// no real GitHub call. A JSON array (not a space-split string) is used so paths
// containing spaces (e.g. Windows "Program Files") survive. Pure no-op when the
// env vars are absent, so production behavior and existing tests are unaffected.
const BIN_OVERRIDES = {
  gh: { bin: "ARCHON_GH_BIN", argsPrefix: "ARCHON_GH_ARGS_PREFIX_JSON" },
  git: { bin: "ARCHON_GIT_BIN", argsPrefix: "ARCHON_GIT_ARGS_PREFIX_JSON" },
};

// Resolve the binary + args to actually spawn, applying the test seam above.
// Returns { cmd, args } unchanged unless an override env var is set for `cmd`.
export function resolveCommand(cmd, args) {
  const override = BIN_OVERRIDES[cmd];
  if (!override) return { cmd, args };
  const bin = process.env[override.bin];
  if (!bin) return { cmd, args };

  let prefix = [];
  const rawPrefix = process.env[override.argsPrefix];
  if (rawPrefix) {
    let parsed;
    try {
      parsed = JSON.parse(rawPrefix);
    } catch {
      throw new Error(`${override.argsPrefix} must be a JSON array of strings`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`${override.argsPrefix} must be a JSON array of strings`);
    }
    prefix = parsed.map(String);
  }
  return { cmd: bin, args: [...prefix, ...args] };
}

// Runs a command, captures stdout/stderr, never logs the value of stdin.
// stdin: optional string (e.g. secret value) — passed through but never logged.
export function runCommand(cmd, args, { cwd, env, timeoutMs = 60_000, stdin = null } = {}) {
  return new Promise((resolveP, rejectP) => {
    const resolved = resolveCommand(cmd, args);
    const child = spawn(resolved.cmd, resolved.args, {
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
