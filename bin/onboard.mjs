#!/usr/bin/env node
// Headless onboarding entrypoint — the scriptable sibling of the browser
// wizard. Reuses the exact planner/executor the wizard drives (see
// src/server/onboard/headlessOnboard.mjs), so the two never drift.
//
//   npm run onboard -- <targetPath> [options]
//
// Options:
//   --features a,b,c   Override the selection (default: local baseline)
//   --owner <name>     GitHub owner/account (enables CODEOWNERS, manifest)
//   --repo <name>      Repo name recorded in the manifest
//   --visibility <v>   private | public  (default: private)
//   --dry-run          Print the plan and exit without writing
//   --json             Emit the result as JSON instead of human text
//   --help             Show this help
import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";

function parseArgs(argv) {
  const opts = {
    targetPath: null,
    features: null,
    owner: "",
    repo: "",
    visibility: "private",
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--features":
        opts.features = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--owner":
        opts.owner = argv[++i] || "";
        break;
      case "--repo":
        opts.repo = argv[++i] || "";
        break;
      case "--visibility":
        opts.visibility = argv[++i] || "private";
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
        if (opts.targetPath === null) opts.targetPath = arg;
        else throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return opts;
}

const HELP = `archon-setup onboard — headless repo scaffolding

Usage:
  npm run onboard -- <targetPath> [options]

Options:
  --features a,b,c   Override feature selection (default: local baseline)
  --owner <name>     GitHub owner/account (enables CODEOWNERS + manifest)
  --repo <name>      Repo name recorded in the manifest
  --visibility <v>   private | public  (default: private)
  --dry-run          Print the plan and exit without writing
  --json             Emit the result as JSON instead of human text
  --help             Show this help`;

function printPlan(plan) {
  console.log(`Selected features: ${plan.selectedFeatureIds.join(", ")}`);
  console.log(`\nFiles to create (${plan.files.length}):`);
  for (const f of plan.files) console.log(`  + ${f.path}`);
  if (plan.skippedFiles.length) {
    console.log(`\nIntentionally skipped (${plan.skippedFiles.length}):`);
    for (const s of plan.skippedFiles) console.log(`  - ${s.path} (${s.reason})`);
  }
  if (plan.commands.length) {
    console.log(`\nCommands (${plan.commands.length}):`);
    for (const c of plan.commands) console.log(`  $ ${c.tool || ""} ${(c.args || []).join(" ")}`.trim());
  }
  if (plan.remoteMutations.length) {
    console.log(`\nRemote mutations (${plan.remoteMutations.length}):`);
    for (const m of plan.remoteMutations) console.log(`  ~ ${m.type || JSON.stringify(m)}`);
  }
  if (plan.warnings.length) {
    console.log(`\nWarnings (${plan.warnings.length}):`);
    for (const w of plan.warnings) console.log(`  ! ${w.feature}: ${w.message}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.targetPath) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const onEvent = opts.json
    ? null
    : (ev) => {
        if (ev.kind === "done") console.log(`  ${ev.taskId}: ${ev.result}`);
        else if (ev.kind === "error") console.error(`  ${ev.taskId}: ERROR ${ev.error}`);
      };

  if (!opts.dryRun && !opts.json) console.log(`Onboarding ${opts.targetPath} ...\n`);

  const res = await runOnboard({
    targetPath: opts.targetPath,
    features: opts.features,
    owner: opts.owner,
    repo: opts.repo,
    visibility: opts.visibility,
    dryRun: opts.dryRun,
    onEvent,
  });

  if (opts.json) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  if (opts.dryRun) {
    console.log("DRY RUN — nothing written.\n");
    printPlan(res.plan);
    process.exit(0);
  }

  if (!res.ok && res.blockingWarnings.length) {
    console.error("\nBlocked by warnings — fix the selection before onboarding:");
    for (const w of res.blockingWarnings) console.error(`  ! ${w.feature}: ${w.message}`);
    process.exit(1);
  }

  const m = res.result?.manifest;
  if (m) {
    console.log(`\nCreated ${m.createdFiles.length} file(s); skipped ${m.skippedFiles.length}.`);
    console.log(`Manifest: ${opts.targetPath}/.github/archon-setup.json`);
  }
  if (!res.ok) {
    const failed = res.result?.results.find((r) => !r.ok);
    console.error(`\nOnboarding failed at ${failed?.unit?.taskId || "unknown task"}: ${failed?.error || failed?.status}`);
    process.exit(1);
  }
  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`onboard error: ${err.message}`);
  process.exit(1);
});
