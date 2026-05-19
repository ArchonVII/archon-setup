import { existsSync } from "node:fs";

import { runCommand } from "../lib/commandRunner.mjs";

export const WINDOWS_ACTIONLINT_PATH = "C:\\Tools\\actionlint\\actionlint.exe";

function versionDetail(stdout, stderr, cmd) {
  const text = `${stdout || ""}\n${stderr || ""}`.trim();
  const firstLine = text.split(/\r?\n/).find(Boolean);
  return firstLine || `${cmd} -version succeeded`;
}

function missingActionlint(platform) {
  const windowsDetail =
    platform === "win32"
      ? ` or ${WINDOWS_ACTIONLINT_PATH}`
      : "";
  const windowsFix =
    platform === "win32"
      ? ` On Windows, a standard install location is ${WINDOWS_ACTIONLINT_PATH}; add C:\\Tools\\actionlint to PATH.`
      : "";

  return {
    id: "actionlint",
    status: "yellow",
    detail: `actionlint not found on PATH${windowsDetail}`,
    fix: `Install actionlint, then run \`actionlint <workflow-files>\` for scoped workflow validation.${windowsFix}`,
  };
}

async function tryActionlint(cmd, commandRunner) {
  const { code, stdout, stderr } = await commandRunner(cmd, ["-version"], { timeoutMs: 5000 });
  if (code !== 0) {
    return {
      ok: false,
      result: {
        id: "actionlint",
        status: "yellow",
        detail: `${cmd} -version exited non-zero`,
        fix: "Reinstall actionlint or check that the executable on PATH is valid.",
        error: (stderr || stdout || "").trim(),
      },
    };
  }
  return {
    ok: true,
    result: {
      id: "actionlint",
      status: "green",
      detail: versionDetail(stdout, stderr, cmd),
    },
  };
}

export async function checkActionlint({
  commandRunner = runCommand,
  exists = existsSync,
  platform = process.platform,
} = {}) {
  const candidates = ["actionlint"];
  if (platform === "win32" && exists(WINDOWS_ACTIONLINT_PATH)) {
    candidates.push(WINDOWS_ACTIONLINT_PATH);
  }

  let lastAdvisory = null;
  for (const cmd of candidates) {
    try {
      const attempt = await tryActionlint(cmd, commandRunner);
      if (attempt.ok) return attempt.result;
      lastAdvisory = attempt.result;
    } catch (err) {
      lastAdvisory = {
        id: "actionlint",
        status: "yellow",
        detail: `${cmd} unavailable`,
        error: err.message,
      };
    }
  }

  return lastAdvisory?.error ? missingActionlint(platform) : lastAdvisory || missingActionlint(platform);
}
