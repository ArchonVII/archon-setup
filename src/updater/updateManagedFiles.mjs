import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_REF_PREFIX = "ArchonVII/github-workflows/.github/workflows/";

function managedWorkflowName(body) {
  const match = body.match(new RegExp(`${WORKFLOW_REF_PREFIX.replaceAll("/", "\\/")}([^\\s@]+\\.yml)@v1`));
  return match?.[1] || null;
}

function ensureNodeCiBudgetDefaults(body) {
  let next = body;
  const canonicalOn = [
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "    branches: [main]",
    "    types: [opened, synchronize, reopened, ready_for_review]",
    "",
  ].join("\n");

  if (!next.includes("types: [opened, synchronize, reopened, ready_for_review]")) {
    if (/on:\r?\n  pull_request:\r?\n  push:\r?\n    branches: \[main\]\r?\n/.test(next)) {
      next = next.replace(/on:\r?\n  pull_request:\r?\n  push:\r?\n    branches: \[main\]\r?\n/, canonicalOn);
    } else if (/on:\r?\n  push:\r?\n    branches: \[main\]\r?\n  pull_request:\r?\n(?!    types:)/.test(next)) {
      next = next.replace(/on:\r?\n  push:\r?\n    branches: \[main\]\r?\n  pull_request:\r?\n(?!    types:)/, canonicalOn);
    } else {
      next = next.replace(
        /(  pull_request:\r?\n    branches: \[main\]\r?\n)(?!    types:)/,
        "$1    types: [opened, synchronize, reopened, ready_for_review]\n"
      );
    }
  }

  if (!next.includes("github.event.pull_request.draft == false")) {
    next = next.replace(
      /(\n  [A-Za-z0-9_-]+:\r?\n)(    uses: ArchonVII\/github-workflows\/\.github\/workflows\/node-ci\.yml@v1)/,
      "$1    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false\n$2"
    );
  }

  return next;
}

function ensureDependencyReviewBudgetDefaults(body) {
  let next = body;

  if (!next.includes("pnpm-lock.yaml") && !next.includes("packages/**/package.json")) {
    next = next.replace(
      /(  pull_request:\r?\n    branches: \[main\]\r?\n)(?!    paths:)/,
      [
        "$1",
        "    paths:",
        "      - package.json",
        "      - package-lock.json",
        "      - pnpm-lock.yaml",
        "      - yarn.lock",
        "      - packages/**/package.json",
        "",
      ].join("\n")
    );
  }

  if (!next.includes("fail-on-severity:")) {
    next = next.replace(
      /(    uses: ArchonVII\/github-workflows\/\.github\/workflows\/dependency-review\.yml@v1\r?\n)(?!    with:)/,
      [
        "$1",
        "    with:",
        "      fail-on-severity: 'high'",
        "      fail-on-scopes: 'runtime'",
        "      comment-summary-in-pr: 'on-failure'",
      ].join("\n")
    );
  }

  return next;
}

function applyBudgetDefaults(body) {
  const managedName = managedWorkflowName(body);
  if (managedName === "node-ci.yml") return ensureNodeCiBudgetDefaults(body);
  if (managedName === "dependency-review.yml") return ensureDependencyReviewBudgetDefaults(body);
  return body;
}

export async function updateManagedFiles({ targetPath, dryRun = false }) {
  if (!targetPath) throw new Error("targetPath is required");

  const changes = [];
  const warnings = [];
  const workflowDir = join(targetPath, ".github", "workflows");

  if (!existsSync(workflowDir)) {
    return { changes, warnings: ["target has no .github/workflows directory"], updated: 0, unchanged: 0, skipped: 0 };
  }

  const workflowFiles = (await readdir(workflowDir)).filter((file) => file.endsWith(".yml"));
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const file of workflowFiles) {
    const relativePath = `.github/workflows/${file}`;
    const targetFile = join(workflowDir, file);
    const current = await readFile(targetFile, "utf8");
    if (!managedWorkflowName(current)) {
      skipped++;
      changes.push({ path: relativePath, status: "skipped" });
      continue;
    }

    const next = applyBudgetDefaults(current);
    if (current === next) {
      unchanged++;
      changes.push({ path: relativePath, status: "unchanged" });
      continue;
    }

    updated++;
    changes.push({ path: relativePath, status: dryRun ? "would-update" : "updated" });
    if (!dryRun) await writeFile(targetFile, next);
  }

  return { changes, warnings, updated: dryRun ? 0 : updated, unchanged, skipped };
}
