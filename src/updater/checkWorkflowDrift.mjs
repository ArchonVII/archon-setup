import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  managedWorkflowName,
  canonicalSnapshotBody,
  normalizeWorkflowBody,
  snapshotPathFor,
} from "./updateManagedFiles.mjs";

const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "snapshots", "manifest.json");

async function readGithubWorkflowsSnapshotMeta() {
  try {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    return manifest.snapshots?.githubWorkflows ?? {};
  } catch {
    return {};
  }
}

// Classify every workflow caller in the target's .github/workflows against the
// recorded snapshot bodies:
//   - `current`   — matches the canonical (budget-defaulted) snapshot body
//   - `drifted`   — a managed caller whose body diverges (upgrade can rewrite it)
//   - `unmanaged` — not an ArchonVII reusable caller, or references a workflow
//                   we do not snapshot — left untouched
// Annotated with the manifest sha + capturedAt so reports can name the baseline.
export async function checkWorkflowDrift({ targetPath }) {
  if (!targetPath) throw new Error("targetPath is required");

  const { sha = null, capturedAt = null } = await readGithubWorkflowsSnapshotMeta();
  const workflowDir = join(targetPath, ".github", "workflows");
  const files = [];

  if (existsSync(workflowDir)) {
    const callers = (await readdir(workflowDir)).filter((f) => f.endsWith(".yml")).sort();
    for (const file of callers) {
      const relativePath = `.github/workflows/${file}`;
      const body = await readFile(join(workflowDir, file), "utf8");
      const ref = managedWorkflowName(body);
      const snapshotFile = ref ? snapshotPathFor(ref) : null;

      if (!ref || !existsSync(snapshotFile)) {
        files.push({ path: relativePath, ref: ref ?? null, status: "unmanaged" });
        continue;
      }

      const snapshot = await readFile(snapshotFile, "utf8");
      const status =
        normalizeWorkflowBody(body) === canonicalSnapshotBody(snapshot) ? "current" : "drifted";
      files.push({ path: relativePath, ref, status });
    }
  }

  const count = (status) => files.filter((f) => f.status === status).length;
  return {
    sha,
    capturedAt,
    files,
    current: count("current"),
    drifted: count("drifted"),
    unmanaged: count("unmanaged"),
  };
}
