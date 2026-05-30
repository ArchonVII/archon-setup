import { runCommand } from "../lib/commandRunner.mjs";

export async function checkHooksPath(target, { commandRunner = runCommand } = {}) {
  if (!target) {
    return { id: "hooksPath", status: "green", detail: "No target selected yet." };
  }

  let repo;
  try {
    repo = await commandRunner("git", ["-C", target, "rev-parse", "--is-inside-work-tree"], { timeoutMs: 5000 });
  } catch {
    return { id: "hooksPath", status: "green", detail: "No git repository yet; hooks will activate after git init." };
  }
  if (repo.code !== 0) {
    return { id: "hooksPath", status: "green", detail: "No git repository yet; hooks will activate after git init." };
  }

  const config = await commandRunner("git", ["-C", target, "config", "--get", "core.hooksPath"], { timeoutMs: 5000 });
  if (config.code !== 0 || !config.stdout.trim()) {
    return { id: "hooksPath", status: "green", detail: "core.hooksPath is unset; will configure .githooks." };
  }

  const hooksPath = config.stdout.trim().replace(/\\/g, "/");
  if (hooksPath === ".githooks") {
    return { id: "hooksPath", status: "green", detail: "core.hooksPath is already .githooks." };
  }

  return {
    id: "hooksPath",
    status: "yellow",
    detail: `core.hooksPath is already set to ${config.stdout.trim()}; archon-setup will not overwrite it automatically.`,
    hooksPath: config.stdout.trim(),
  };
}
