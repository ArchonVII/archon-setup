import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW_REF_PREFIX = "ArchonVII/github-workflows/.github/workflows/";

// Recorded caller-template snapshots (matches installWorkflow's source dir).
const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "snapshots", "github-workflows");

export function snapshotPathFor(ref) {
  return join(SNAPSHOT_DIR, ref);
}

export function managedWorkflowName(body) {
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

const REQUIRED_GATE_PR_TYPES = "    types: [opened, edited, synchronize, reopened, ready_for_review, labeled, unlabeled]";
const REQUIRED_GATE_CONCURRENCY = [
  "concurrency:",
  "  group: repo-required-gate-${{ github.event.pull_request.number || github.ref }}",
  "  cancel-in-progress: >-",
  "    ${{",
  "      github.event_name == 'pull_request' &&",
  "      (",
  "        (github.event.action != 'labeled' && github.event.action != 'unlabeled') ||",
  "        github.event.label.name == 'ci:full'",
  "      )",
  "    }}",
].join("\n");
const REQUIRED_GATE_JOB_IF = [
  "    if: >-",
  "      ${{",
  "        github.event_name != 'pull_request' ||",
  "        (github.event.action != 'labeled' && github.event.action != 'unlabeled') ||",
  "        github.event.label.name == 'ci:full'",
  "      }}",
].join("\n");

function ensureRequiredGateTriggerDefaults(body) {
  let next = body;

  const typedPullRequestRe =
    /(  pull_request:\r?\n    branches: \[main\]\r?\n)(    types:\s*\r?\n      \[\s*\r?\n(?:        [A-Za-z_]+,\s*\r?\n)+      \]\s*\r?\n|    types: \[[^\]\r\n]*\]\s*\r?\n)/;
  if (!next.includes(REQUIRED_GATE_PR_TYPES)) {
    if (typedPullRequestRe.test(next)) {
      next = next.replace(typedPullRequestRe, `$1${REQUIRED_GATE_PR_TYPES}\n`);
    } else {
      next = next.replace(
        /(  pull_request:\r?\n    branches: \[main\]\r?\n)(?!    types:)/,
        `$1${REQUIRED_GATE_PR_TYPES}\n`
      );
    }
  }

  const concurrencyGroupRe =
    /(concurrency:\r?\n  group: repo-required-gate-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\r?\n)(?:  cancel-in-progress:[^\r\n]*(?:\r?\n    [^\r\n]*)*\r?\n)?/;
  if (concurrencyGroupRe.test(next)) {
    next = next.replace(concurrencyGroupRe, `${REQUIRED_GATE_CONCURRENCY}\n`);
  } else {
    next = next.replace(/\r?\njobs:\r?\n/, `\n${REQUIRED_GATE_CONCURRENCY}\n\njobs:\n`);
  }

  if (!next.includes("github.event.label.name == 'ci:full'")) {
    next = next.replace(
      /(\n  repo-required-gate:\r?\n)(?!    if:)/,
      `$1${REQUIRED_GATE_JOB_IF}\n`
    );
  } else if (!next.includes("    if: >-")) {
    next = next.replace(
      /(\n  repo-required-gate:\r?\n)(?!    if:)/,
      `$1${REQUIRED_GATE_JOB_IF}\n`
    );
  }

  return next;
}

export function applyBudgetDefaults(body) {
  const managedName = managedWorkflowName(body);
  if (managedName === "node-ci.yml") return ensureNodeCiBudgetDefaults(body);
  if (managedName === "dependency-review.yml") return ensureDependencyReviewBudgetDefaults(body);
  if (managedName === "repo-required-gate.yml") return ensureRequiredGateTriggerDefaults(body);
  return body;
}

// Content-equality normalization that ignores line-ending and trailing-
// whitespace differences (a Linux consumer may hold LF where snapshots ship
// CRLF). Shared by the drift checker and the upgrader.
export function normalizeWorkflowBody(body) {
  return body.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
}

// The canonical managed body for a snapshot: the snapshot with budget defaults
// applied (idempotent; our snapshots already bake them in). This is exactly
// what upgradeWorkflowCallers writes, so an upgraded caller reads `current`.
export function canonicalSnapshotBody(snapshotBody) {
  return normalizeWorkflowBody(applyBudgetDefaults(snapshotBody));
}

// Replace drifted managed workflow callers with the canonical snapshot body
// (re-injecting budget defaults). Customizations beyond budget defaults are
// discarded by design (rollout spec C1) — use plain updateManagedFiles to
// preserve custom inputs while only adding budget defaults. dryRun previews.
export async function upgradeWorkflowCallers({ targetPath, dryRun = false }) {
  if (!targetPath) throw new Error("targetPath is required");

  const changes = [];
  const workflowDir = join(targetPath, ".github", "workflows");
  if (!existsSync(workflowDir)) {
    return { changes, warnings: ["target has no .github/workflows directory"], upgraded: 0, current: 0, unmanaged: 0 };
  }

  const workflowFiles = (await readdir(workflowDir)).filter((file) => file.endsWith(".yml")).sort();
  let upgraded = 0;
  let current = 0;
  let unmanaged = 0;

  for (const file of workflowFiles) {
    const relativePath = `.github/workflows/${file}`;
    const targetFile = join(workflowDir, file);
    const body = await readFile(targetFile, "utf8");
    const ref = managedWorkflowName(body);
    const snapshotFile = ref ? snapshotPathFor(ref) : null;

    if (!ref || !existsSync(snapshotFile)) {
      unmanaged++;
      changes.push({ path: relativePath, status: "unmanaged" });
      continue;
    }

    // applyBudgetDefaults is the body we write; compare normalized so an
    // already-canonical caller (any line endings) reads `current`.
    const canonical = applyBudgetDefaults(await readFile(snapshotFile, "utf8"));
    if (normalizeWorkflowBody(body) === normalizeWorkflowBody(canonical)) {
      current++;
      changes.push({ path: relativePath, status: "current" });
      continue;
    }

    upgraded++;
    changes.push({ path: relativePath, status: dryRun ? "would-upgrade" : "upgraded" });
    if (!dryRun) await writeFile(targetFile, canonical);
  }

  return { changes, warnings: [], upgraded: dryRun ? 0 : upgraded, current, unmanaged };
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
