#!/usr/bin/env node
import { startServer } from "../src/server/index.mjs";
import { updateManagedFiles, upgradeWorkflowCallers } from "../src/updater/updateManagedFiles.mjs";
import { checkWorkflowDrift } from "../src/updater/checkWorkflowDrift.mjs";
import {
  DEFAULT_BRANCH,
  DEFAULT_REQUIRED_GATE_CHECK,
  tightenRequiredGate,
} from "../src/server/branchProtection/tightenRequiredGate.mjs";

const argv = process.argv.slice(2);

function readOption(args, name, fallback = "") {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args[index + 1] || fallback;
}

const DISTRIBUTE_HELP = `archon-setup distribute - reconcile ArchonVII-managed regions in consumer repos

Repo-owned by default: only marked managed regions are ever touched, and the
default run is a read-only dry-run (design: docs/superpowers/specs/
2026-06-09-granular-distributor-design.md, issue #145).

Usage:
  node bin/archon-setup.mjs distribute (--target <path> | --all) [options]

Options:
  --target <path>    Reconcile one repo (no confirmation needed for --apply)
  --all              Reconcile every active registry repo
  --group <a,b>      Limit to catalog groups (callers|agents|hooks|baseline,
                     or "all" = no filter); unknown names are rejected
  --id <x,y>         Limit to specific region ids (must exist in the catalog;
                     unknown-id detection still runs against the full catalog)
  --apply            Write clean_apply changes (default: dry-run, writes nothing)
  --confirm <phrase> Required for --all --apply; the run prints the exact phrase
  --write-preview    Emit .archon/distribute-preview/ proposals for adoptions
  --log <path>       Run-log JSONL path (default: ~/.claude/archon-distribute-log.jsonl)
  --json             Emit the full run result as JSON
  --help             Show this help

Exit codes: 0 nothing to do / all applied; 10 dry-run found pending changes;
20 adoption/conflict needs a human (or confirmation missing); 1 failure.`;

if (argv[0] === "distribute") {
  const args = argv.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(DISTRIBUTE_HELP);
    process.exit(0);
  }

  const { collectRepos } = await import("../src/server/ecosystem/collectRepos.mjs");
  const { DEFAULT_REPO_REGISTRY_PATH } = await import("../src/server/ecosystem/repoRegistry.mjs");
  const { distribute, exitCodeFor, loadDefaultCatalog, repoContextFor, DEFAULT_LOG_PATH } = await import(
    "../src/distributor/distribute.mjs"
  );

  const flags = new Set(args);
  function readDistributeOption(name, fallback = "") {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${name}`);
    }
    return value;
  }

  let targetPath;
  let all;
  try {
    targetPath = readDistributeOption("--target");
    all = flags.has("--all");
    if ((targetPath ? 1 : 0) + (all ? 1 : 0) !== 1) {
      throw new Error("choose exactly one of --target <path> or --all");
    }
  } catch (err) {
    console.error(`distribute: ${err.message}`);
    process.exit(1);
  }

  const csv = (value) => (value ? value.split(",").map((v) => v.trim()).filter(Boolean) : null);
  let run;
  try {
    const catalog = await loadDefaultCatalog();

    // §9 grammar: "all" widens to every group (= no filter). Unknown group or
    // id tokens are rejected loudly — a typo must never read as "nothing to
    // do" with exit 0.
    const SPEC_GROUPS = ["callers", "agents", "hooks", "baseline"];
    let groups = csv(readDistributeOption("--group"));
    if (groups?.includes("all")) groups = null;
    const knownGroups = new Set([...SPEC_GROUPS, ...catalog.entries.map((e) => e.group)]);
    for (const group of groups ?? []) {
      if (!knownGroups.has(group)) {
        console.error(`distribute: unknown group "${group}" (known: ${[...knownGroups].sort().join(", ")}, all)`);
        process.exit(1);
      }
    }
    const ids = csv(readDistributeOption("--id"));
    for (const id of ids ?? []) {
      if (!catalog.knownIds.has(id)) {
        console.error(`distribute: unknown id "${id}" — not in the managed-regions catalog`);
        process.exit(1);
      }
    }

    const repos = targetPath
      ? [await repoContextFor(targetPath)]
      : (await collectRepos({ repoRegistryPath: DEFAULT_REPO_REGISTRY_PATH })).repos;
    run = await distribute({
      repos,
      all,
      apply: flags.has("--apply"),
      confirmation: readDistributeOption("--confirm", null) || null,
      catalog,
      groups,
      ids,
      writePreview: flags.has("--write-preview"),
      logPath: readDistributeOption("--log", DEFAULT_LOG_PATH),
    });
  } catch (err) {
    console.error(`distribute: ${err.message}`);
    process.exit(1);
  }

  if (flags.has("--json")) {
    console.log(JSON.stringify(run, null, 2));
  } else if (run.status === "confirmation-required") {
    console.error(`Fleet apply needs explicit confirmation. Re-run with:\n  --confirm "${run.confirmationPhrase}"`);
  } else {
    for (const repo of run.results) {
      if (repo.status === "skipped") {
        console.log(`skipped (${repo.reason}): ${repo.repo}`);
        continue;
      }
      for (const file of repo.files) {
        const flagsText = [file.changed ? "changed" : null, file.written ? "written" : null, file.reason ?? null]
          .filter(Boolean)
          .join(", ");
        console.log(`${file.status}${flagsText ? ` (${flagsText})` : ""}: ${repo.repo} ${file.relpath}`);
        // §9: dry-run prints unified diffs; DL5: conflicts come with their
        // human-readable evidence.
        for (const region of file.regions ?? []) {
          if (region.diff) console.log(region.diff.replace(/^/gm, "  "));
        }
        if (file.diagnostics?.length) console.log(`  diagnostics: ${JSON.stringify(file.diagnostics)}`);
        if (file.dangers?.length) console.log(`  dangers: ${JSON.stringify(file.dangers)}`);
      }
    }
    const c = run.counts;
    console.log(
      `${run.mode}: ${c.cleanApply} clean (${c.changed} changed, ${c.written} written), ` +
        `${c.adoptionNeeded} adoption, ${c.conflicts} conflict, ${c.skips} skipped, ${c.failures} failed.`,
    );
  }
  process.exit(exitCodeFor(run));
}

const REFRESH_HELP = `archon-setup refresh - audit one repo's ecosystem state (read-only)

Runs the refresh audit (#157): reconciles ArchonVII-managed regions in audit
mode (never writes; audits repos sitting on main and dirty worktrees) and
emits a schema-valid RepoRefreshReport with every finding projected to a
frontend-spec Operation plus a deterministic recommendation. The decision flow
(#158) turns findings into a canonical JSON DecisionDoc with an HTML face and
a Save-as-Issue transport, and validates completed docs into an ApplySet.

Usage:
  node bin/archon-setup.mjs refresh --target <path> [options]

Options:
  --target <path>     Repo to audit (required)
  --json              Emit the full result as JSON
  --report            Also write the self-contained HTML decision report
                      (under .html-artifacts/decision-reports/, never in the
                      target repo) and print its path
  --save-issue        Also save the decision report as a GitHub issue on the
                      target's origin remote (canonical JSON in a fenced block)
  --intake <ref>      Validate a completed decision doc instead of auditing:
                      <ref> is a JSON file path or issue:#N. Emits the ApplySet
                      and the confirmation summary.
  --allow-partial     With --intake: skip stale items instead of rejecting
  --execute           Ships with the PR lane (M3, #159)
  --help              Show this help

Exit codes: 0 nothing to do / intake ok; 10 clean update pending; 20 a human
decision remains or intake rejected; 1 failure or unauditable target.`;

if (argv[0] === "refresh") {
  const args = argv.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(REFRESH_HELP);
    process.exit(0);
  }

  const { refreshExitCodeFor, refreshTarget } = await import("../src/server/refresh/refreshRepo.mjs");

  const flags = new Set(args);
  function readRefreshOption(name, fallback = "") {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      console.error(`refresh: missing value for ${name}`);
      process.exit(1);
    }
    return value;
  }

  const targetPath = readRefreshOption("--target");
  if (!targetPath) {
    console.error("refresh: missing value for --target");
    process.exit(1);
  }

  if (flags.has("--execute")) {
    console.error("refresh: --execute ships with the PR lane (M3, #159); use --intake to validate decisions today");
    process.exit(1);
  }

  // ---- intake path (#158): validate a completed decision doc -> ApplySet ----
  const intakeRef = readRefreshOption("--intake", null);
  if (intakeRef) {
    const { intakeDecisionDoc } = await import("../src/server/decisions/intake.mjs");
    let input;
    try {
      if (/^issue:/.test(intakeRef)) {
        const { resumeDecisionIssue } = await import("../src/server/decisions/issueSync.mjs");
        const { checkOriginRemote } = await import("../src/server/preflight/checkOriginRemote.mjs");
        const origin = (await checkOriginRemote(targetPath)).originDetected;
        if (!origin) {
          console.error("refresh: --intake issue:#N needs a github.com origin remote on the target");
          process.exit(1);
        }
        const resumed = await resumeDecisionIssue({ ref: intakeRef, repoSlug: `${origin.owner}/${origin.repo}` });
        if (!resumed.ok) {
          console.error(`refresh: ${resumed.reason}`);
          process.exit(20);
        }
        input = resumed.doc;
      } else {
        input = await (await import("node:fs/promises")).readFile(intakeRef, "utf8");
      }
    } catch (err) {
      console.error(`refresh: ${err.message}`);
      process.exit(1);
    }

    let intake;
    try {
      intake = await intakeDecisionDoc({ input, targetPath, allowPartial: flags.has("--allow-partial") });
    } catch (err) {
      console.error(`refresh: ${err.message}`);
      process.exit(1);
    }
    if (!intake.ok) {
      if (flags.has("--json")) console.log(JSON.stringify(intake, null, 2));
      else console.error(`intake rejected (${intake.code}): ${intake.detail}`);
      process.exit(20);
    }
    if (flags.has("--json")) {
      console.log(JSON.stringify(intake, null, 2));
    } else {
      const h = intake.summary.human;
      for (const line of h.applying) console.log(`apply: ${line}`);
      for (const line of h.skippedStale) console.log(`skipped: ${line}`);
      for (const line of h.manualOrDeferred) console.log(`manual: ${line}`);
      console.log(`auto-merge eligible: ${h.autoMerge}`);
      console.log(`confirmation phrase: ${h.confirmationPhrase}`);
      console.log(`rollback: ${h.rollbackCommand}`);
    }
    process.exit(0);
  }

  let report;
  try {
    report = await refreshTarget({ targetPath });
  } catch (err) {
    console.error(`refresh: ${err.message}`);
    process.exit(1);
  }

  // ---- decision-report faces (#158) ----
  if ((flags.has("--report") || flags.has("--save-issue")) && report.status === "ok") {
    const { buildDecisionDoc } = await import("../src/server/decisions/decisionDoc.mjs");
    const { checkOriginRemote } = await import("../src/server/preflight/checkOriginRemote.mjs");
    try {
      const origin = (await checkOriginRemote(targetPath)).originDetected;
      const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${process.pid}`;
      const doc = await buildDecisionDoc({ report, runId, owner: origin?.owner ?? null });
      if (!doc) {
        console.error("decision report: nothing actionable to decide");
      } else {
        if (flags.has("--report")) {
          const { writeDecisionReport } = await import("../src/server/decisions/renderHtml.mjs");
          console.error(`decision report: ${await writeDecisionReport(doc)}`);
        }
        if (flags.has("--save-issue")) {
          if (!origin) {
            console.error("refresh: --save-issue needs a github.com origin remote on the target");
            process.exit(1);
          }
          const { saveDecisionIssue } = await import("../src/server/decisions/issueSync.mjs");
          const saved = await saveDecisionIssue({ doc, repoSlug: `${origin.owner}/${origin.repo}` });
          console.error(
            `decision issue: ${saved.url}${saved.superseded.length ? ` (superseded: ${saved.superseded.map((n) => `#${n}`).join(", ")})` : ""}`,
          );
        }
      }
    } catch (err) {
      console.error(`refresh: ${err.message}`);
      process.exit(1);
    }
  }

  if (flags.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.status === "skipped") {
    console.log(`skipped (${report.reason}): ${report.repo.name}`);
  } else {
    for (const category of report.categories) {
      for (const item of category.items) {
        const rawText = [item.raw.status, item.raw.reason].filter(Boolean).join("/");
        const rec = item.recommended
          ? `recommended ${item.recommended}`
          : `no recommendation (${item.recommendationReason})`;
        console.log(`${item.operation.action} (${rawText}): ${item.itemId} — ${rec}`);
        if (item.operation.diff) console.log(item.operation.diff.replace(/^/gm, "  "));
      }
    }
    const items = report.categories.flatMap((c) => c.items);
    const count = (action) => items.filter((i) => i.operation.action === action).length;
    console.log(
      `audit: ${count("merge")} merge, ${count("create")} create, ${count("needs_review")} needs_review, ` +
        `${count("blocked")} blocked, ${count("skip")} skip.`,
    );
  }
  process.exit(refreshExitCodeFor(report));
}

const TIGHTEN_HELP = `archon-setup tighten-required-gate - mark the stable repo gate required

Usage:
  node bin/archon-setup.mjs tighten-required-gate [options]

Options:
  --target <path>   Repo path containing .github/archon-setup.json (default: cwd)
  --owner <name>    GitHub owner override
  --repo <name>     GitHub repo override
  --branch <name>   Protected branch (default: ${DEFAULT_BRANCH})
  --check <name>    Required check name (default: ${DEFAULT_REQUIRED_GATE_CHECK})
  --json            Emit the result as JSON
  --help            Show this help`;

if (argv[0] === "tighten-required-gate") {
  const args = argv.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(TIGHTEN_HELP);
    process.exit(0);
  }

  const result = await tightenRequiredGate({
    targetPath: readOption(args, "--target", process.cwd()),
    owner: readOption(args, "--owner"),
    repo: readOption(args, "--repo"),
    branch: readOption(args, "--branch", DEFAULT_BRANCH),
    checkName: readOption(args, "--check", DEFAULT_REQUIRED_GATE_CHECK),
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const prefix = result.ok ? "OK" : "ERROR";
    console.log(`${prefix}: ${result.message}`);
    if (result.manifestUpdated) console.log(`Manifest updated: ${result.manifestPath}`);
    else if (result.manifestPath && ["required", "already-required"].includes(result.status)) {
      console.log(`Manifest already complete: ${result.manifestPath}`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}

if (argv[0] === "update") {
  const args = new Set(argv.slice(1));
  const targetIndex = argv.indexOf("--target");
  const targetPath = targetIndex >= 0 ? argv[targetIndex + 1] : process.cwd();
  const dryRun = args.has("--dry-run");

  // `update --check`: report-only workflow drift against the recorded snapshot.
  // Exits non-zero when any managed caller has drifted — a gate by design, so
  // it can run in CI / pre-push to catch stale callers.
  if (args.has("--check")) {
    const report = await checkWorkflowDrift({ targetPath });
    for (const file of report.files) console.log(`${file.status}: ${file.path}`);
    const baseline = report.sha ? report.sha.slice(0, 12) : "(unknown)";
    console.log(
      `Workflow drift vs snapshot ${baseline} (captured ${report.capturedAt ?? "unknown"}): ` +
        `${report.current} current, ${report.drifted} drifted, ${report.unmanaged} unmanaged.`
    );
    process.exit(report.drifted > 0 ? 1 : 0);
  }

  // `update --upgrade`: rewrite drifted managed callers to the current snapshot
  // (re-injecting budget defaults; discards customizations beyond them — C1).
  if (args.has("--upgrade")) {
    const result = await upgradeWorkflowCallers({ targetPath, dryRun });
    for (const change of result.changes) console.log(`${change.status}: ${change.path}`);
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
    const wouldUpgrade = result.changes.filter((c) => c.status === "would-upgrade").length;
    const verb = dryRun ? "Would upgrade" : "Upgraded";
    console.log(
      `${verb} ${dryRun ? wouldUpgrade : result.upgraded} drifted caller(s); ` +
        `${result.current} current; ${result.unmanaged} unmanaged.`
    );
    process.exit(0);
  }

  const result = await updateManagedFiles({ targetPath, dryRun });

  for (const change of result.changes) {
    console.log(`${change.status}: ${change.path}`);
  }
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  }
  console.log(
    `Updated ${result.updated} managed file(s); ${result.unchanged} unchanged; ${result.skipped} skipped.`
  );
  process.exit(0);
}

const args = new Set(argv);
const dev = args.has("--dev");
const noOpen = args.has("--no-open");
const dashboard = args.has("--dashboard"); // open straight to the ecosystem dashboard screen

startServer({ port: 0, openBrowser: !noOpen, openHash: dashboard ? "#ecosystem" : "" }).then(({ url }) => {
  if (dev) console.log(`[dev] hot reload not yet wired; reload the browser to pick up changes.`);
  console.log(`Press Ctrl+C to stop.\n`);
});
