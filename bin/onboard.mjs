#!/usr/bin/env node
// Headless onboarding entrypoint — the scriptable sibling of the browser
// wizard. Reuses the exact planner/executor the wizard drives (see
// src/server/onboard/headlessOnboard.mjs), so the two never drift.
//
//   npm run onboard -- <targetPath> [options]
//
// Options:
//   --profile <id>     Named tier: docs-min | agent-standard | flagship
//                      (resolves to the tier's features; unions with --features)
//   --features a,b,c   Override the selection (default: minimal local baseline)
//   --owner <name>     GitHub owner/account (enables CODEOWNERS, manifest)
//   --repo <name>      Repo name recorded in the manifest
//   --visibility <v>   private | public  (default: private)
//   --audit            Report present/missing/drifted baseline items without writing
//   --dry-run          Print the plan and exit without writing
//   --json             Emit the result as JSON instead of human text
//   --help             Show this help
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { runOnboard } from "../src/server/onboard/headlessOnboard.mjs";
import { loadProfileFeatures } from "../src/server/tasks/startupBaseline.mjs";

function parseArgs(argv) {
  const opts = {
    targetPath: null,
    features: null,
    profile: "",
    owner: "",
    repo: "",
    visibility: "private",
    audit: false,
    dryRun: false,
    json: false,
    help: false,
    intake: "",
    issue: 0,
    recordPath: "",
    workRoot: "",
    saveIssue: false,
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
      case "--audit":
        opts.audit = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--features":
        opts.features = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--profile":
        opts.profile = argv[++i] || "";
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
      case "--intake":
        opts.intake = argv[++i] || "";
        break;
      case "--issue":
        opts.issue = Number(argv[++i] || 0);
        break;
      case "--record":
        opts.recordPath = argv[++i] || "";
        break;
      case "--work-root":
        opts.workRoot = argv[++i] || "";
        break;
      case "--save-issue":
        opts.saveIssue = true;
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
  --profile <id>     Named tier: docs-min | agent-standard | flagship
                     (resolves to the tier's features; unions with --features)
  --features a,b,c   Override feature selection (default: minimal local baseline)
  --owner <name>     GitHub owner/account (enables CODEOWNERS + manifest)
  --repo <name>      Repo name recorded in the manifest
  --visibility <v>   private | public  (default: private)
  --audit            Report present/missing/drifted baseline items without writing
  --dry-run          Print the plan and exit without writing
  --json             Emit the result as JSON instead of human text
  --help             Show this help`;

const REPAIR_HELP = `archon-setup onboard repair — decisioned existing-repo onboarding

Usage:
  node bin/onboard.mjs repair <targetPath> [options]
  node bin/onboard.mjs verify-merged <targetPath> --record <path> [--json]

Repair options:
  --profile <id>     Named tier: docs-min | agent-standard | flagship
                     (resolves to the tier's features; unions with --features)
  --features a,b,c   Selected onboarding profile to audit
  --owner <name>     GitHub owner for rendered baseline files and the draft PR
  --repo <name>      GitHub repository for rendered baseline files and the draft PR
  --json             Emit the decision document or run result as JSON
  --save-issue        Save the new decision document as a GitHub issue (requires --owner and --repo)
  --intake <path>    Execute a completed decision document
  --issue <number>   Existing issue that the repair draft PR closes (required with --intake)
  --record <path>    Run ledger path (default: ~/.claude/archon-onboarding-repair/<runId>.jsonl)
  --work-root <path> Parent directory for temporary worktrees`;

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

function printAudit(audit) {
  const { summary } = audit;
  console.log(
    `Summary: ${summary.present} present, ${summary.missing} missing, ${summary.drifted} drifted (${summary.total} total)`
  );
  if (audit.onboardingCompletion) {
    const c = audit.onboardingCompletion;
    console.log(`\nOnboarding completion: ${c.status}`);
    if (c.missing.length) console.log(`  missing required anchors: ${c.missing.join(", ")}`);
    if (c.missingBaselineItems.length) console.log(`  missing selected baseline items: ${c.missingBaselineItems.join(", ")}`);
    if (c.driftedBaselineItems.length) console.log(`  drifted selected baseline items: ${c.driftedBaselineItems.join(", ")}`);
    if (c.manifestMissingFeatures.length) console.log(`  manifest missing selected features: ${c.manifestMissingFeatures.join(", ")}`);
    if (c.manifestProblems.length) console.log(`  manifest problems: ${c.manifestProblems.join("; ")}`);
    if (c.blockers.length) console.log(`  blockers: ${c.blockers.join("; ")}`);
  }
  if (audit.startupReadiness) {
    const s = audit.startupReadiness;
    console.log(`\nStartup readiness: ${s.status} (profile: ${s.profile} / ${s.baselineVersion})`);
    console.log("Readiness reflects the resolved selection; the startup baseline is generated per profile.");
    if (s.missing.length) console.log(`  missing: ${s.missing.join(", ")}`);
    if (s.stale.length) console.log(`  stale: ${s.stale.join(", ")}`);
    if (s.misplaced.length) console.log(`  misplaced: ${s.misplaced.join(", ")}`);
    if (s.legacyDetected.length) console.log(`  legacy detected: ${s.legacyDetected.join(", ")}`);
    console.log(`  repair: ${s.repairCommand}`);
  }
  if (audit.dispositions?.length) {
    console.log("\nOwner dispositions:");
    for (const item of audit.dispositions) {
      console.log(`  ${item.state.padEnd(12, " ")} ${item.itemId} (${item.choice})`);
    }
  }
  console.log("\nBaseline items:");
  for (const item of audit.items) {
    const label = item.status.padEnd(7, " ");
    console.log(`  ${label} ${item.path} (${item.feature})`);
  }
}

function printSelectionValidation(validation) {
  const counts = validation.checked;
  console.log(
    `\nSelection contract: ${validation.ok ? "valid" : "invalid"} ` +
      `(${counts.baselineRequiredPaths} startup paths, ${counts.repoTemplateMarkdownSources} Markdown sources)`
  );
  for (const finding of validation.findings) console.log(`  ! ${finding.code}: ${finding.message}`);
}

async function resolvedFeatures(opts) {
  let features = opts.features;
  if (opts.profile) {
    const profileFeatures = await loadProfileFeatures(opts.profile);
    features = [...new Set([...profileFeatures, ...(opts.features || [])])];
  }
  return features;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.targetPath) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }
  if (opts.audit && opts.dryRun) throw new Error("--audit and --dry-run cannot be combined");

  const onEvent = opts.json
    ? null
    : (ev) => {
        if (ev.kind === "done") console.log(`  ${ev.taskId}: ${ev.result}`);
        else if (ev.kind === "error") console.error(`  ${ev.taskId}: ERROR ${ev.error}`);
      };

  if (!opts.dryRun && !opts.audit && !opts.json) console.log(`Onboarding ${opts.targetPath} ...\n`);
  const targetPath = resolve(opts.targetPath);

  // --profile resolves to the tier's feature list, unioned with any --features
  // extras (lane C2, #352). The recorded profile is DERIVED from the resolved
  // selection (buildPlan.resolveProfileId), so --profile + extras records
  // "custom" while --profile alone records the tier id.
  const features = await resolvedFeatures(opts);

  const res = await runOnboard({
    targetPath,
    features,
    owner: opts.owner,
    repo: opts.repo,
    visibility: opts.visibility,
    audit: opts.audit,
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
    printSelectionValidation(res.selectionValidation);
    process.exit(res.ok ? 0 : 1);
  }
  if (opts.audit) {
    console.log("AUDIT — nothing written.\n");
    printAudit(res.audit);
    printSelectionValidation(res.selectionValidation);
    process.exit(res.ok ? 0 : 1);
  }

  if (!res.ok && res.blockingWarnings.length) {
    console.error("\nBlocked by warnings — fix the selection before onboarding:");
    for (const w of res.blockingWarnings) console.error(`  ! ${w.feature}: ${w.message}`);
    process.exit(1);
  }

  const m = res.result?.manifest;
  if (m) {
    console.log(`\nCreated ${m.createdFiles.length} file(s); skipped ${m.skippedFiles.length}.`);
    console.log(`Manifest: ${targetPath}/.github/archon-setup.json`);
  }
  if (!res.ok) {
    const failed = res.result?.results.find((r) => !r.ok);
    console.error(`\nOnboarding failed at ${failed?.unit?.taskId || "unknown task"}: ${failed?.error || failed?.status}`);
    process.exit(1);
  }
  // #281: the required-gate scaffold ships with dependency review OFF, since a
  // freshly created repo has no GitHub Dependency Graph. Surface the opt-in path
  // so the owner can turn it on once the feature is enabled, rather than
  // discovering the disabled lane later.
  if (res.plan?.selectedFeatureIds?.includes("workflow.required-gate")) {
    console.log("\nNext steps:");
    console.log("  • Dependency review is OFF by default in .github/workflows/repo-required-gate.yml");
    console.log("    (a fresh repo has no GitHub Dependency Graph). To enable it: turn on Dependency");
    console.log("    Graph under the repo's Settings -> Code security and analysis (private repos");
    console.log("    also need GitHub Advanced Security), then set `run-dependency-review: true`.");
  }
  console.log("\nDone.");
  process.exit(0);
}

async function repairMain(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.targetPath) {
    console.log(REPAIR_HELP);
    process.exit(opts.help ? 0 : 1);
  }
  if (opts.audit || opts.dryRun) throw new Error("repair does not accept --audit or --dry-run; omit --intake to create a read-only decision document");
  const targetPath = resolve(opts.targetPath);
  const { buildOnboardingDecision, intakeOnboardingDecision } = await import("../src/server/onboard/repairDecision.mjs");

  if (!opts.intake) {
    const doc = await buildOnboardingDecision({
      targetPath,
      features: await resolvedFeatures(opts),
      owner: opts.owner,
      repo: opts.repo,
    });
    let saved = null;
    if (opts.saveIssue) {
      if (!opts.owner || !opts.repo) throw new Error("repair --save-issue requires --owner and --repo");
      const { saveOnboardingDecisionIssue } = await import("../src/server/onboard/repairIssue.mjs");
      saved = await saveOnboardingDecisionIssue({ doc, repoSlug: `${opts.owner}/${opts.repo}` });
    }
    if (opts.json) console.log(JSON.stringify(saved ? { ...doc, decisionIssue: saved } : doc, null, 2));
    else {
      console.log(`Decision document for ${doc.target.name} at ${doc.baseSha}`);
      for (const item of doc.items) console.log(`  ${item.status}: ${item.itemId} (${item.options.join(", ")})`);
      if (saved) console.log(`Decision issue: #${saved.number} ${saved.url}`);
      console.log("Resolve every item, then rerun with --intake <decision.json> --issue <number> (or --intake issue:#N).");
    }
    return;
  }

  let input;
  let issueFromRef = 0;
  if (/^issue:#?\d+$/.test(opts.intake)) {
    if (!opts.owner || !opts.repo) throw new Error("repair --intake issue:#N requires --owner and --repo");
    const { resumeOnboardingDecisionIssue } = await import("../src/server/onboard/repairIssue.mjs");
    const resumed = await resumeOnboardingDecisionIssue({ ref: opts.intake, repoSlug: `${opts.owner}/${opts.repo}` });
    if (!resumed.ok) throw new Error(`repair intake: ${resumed.reason}`);
    input = resumed.doc;
    issueFromRef = Number(/\d+$/.exec(opts.intake)[0]);
  } else {
    input = await readFile(opts.intake, "utf8");
  }
  const sourceIssueNumber = opts.issue || issueFromRef;
  if (!sourceIssueNumber || !Number.isInteger(sourceIssueNumber) || sourceIssueNumber < 1) {
    throw new Error("repair --intake requires a positive --issue <number> or an issue:#N intake reference");
  }
  const intake = await intakeOnboardingDecision({ input, targetPath });
  if (!intake.ok) {
    if (opts.json) console.log(JSON.stringify(intake, null, 2));
    else console.error(`intake rejected (${intake.code}): ${intake.detail}`);
    process.exit(20);
  }
  const recordPath = opts.recordPath || join(homedir(), ".claude", "archon-onboarding-repair", `${intake.runId}.jsonl`);
  const { runOnboardingRepair } = await import("../src/server/onboard/repairRun.mjs");
  const result = await runOnboardingRepair({
    intake,
    targetPath,
    sourceIssueNumber,
    recordPath,
    workRoot: opts.workRoot || null,
    owner: opts.owner || intake.owner,
    repo: opts.repo || intake.repo,
  });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`draft PR #${result.pr.number}: ${result.pr.url}\nrun ledger: ${recordPath}`);
}

async function verifyMergedMain(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.targetPath || !opts.recordPath) {
    console.log(REPAIR_HELP);
    process.exit(1);
  }
  const { verifyMergedOnboardingRepair } = await import("../src/server/onboard/repairRun.mjs");
  const result = await verifyMergedOnboardingRepair({
    targetPath: resolve(opts.targetPath),
    recordPath: opts.recordPath,
    workRoot: opts.workRoot || null,
  });
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.status}: ${result.mergeSha || result.reason}`);
  process.exit(result.status === "fully_onboarded" ? 0 : 20);
}

const argv = process.argv.slice(2);
const entrypoint = argv[0] === "repair" ? () => repairMain(argv.slice(1)) : argv[0] === "verify-merged" ? () => verifyMergedMain(argv.slice(1)) : main;

entrypoint().catch((err) => {
  console.error(`onboard error: ${err.message}`);
  process.exit(1);
});
