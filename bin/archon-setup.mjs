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
  --group <a,b>      Limit to catalog groups (e.g. agents)
  --id <x,y>         Limit to specific region ids (validity still checked
                     against the full catalog)
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
  const targetPath = readOption(args, "--target");
  const all = flags.has("--all");
  if (!targetPath && !all) {
    console.error("distribute: pass --target <path> or --all (see --help)");
    process.exit(1);
  }

  const csv = (value) => (value ? value.split(",").map((v) => v.trim()).filter(Boolean) : null);
  let run;
  try {
    const repos = targetPath
      ? [await repoContextFor(targetPath)]
      : (await collectRepos({ repoRegistryPath: DEFAULT_REPO_REGISTRY_PATH })).repos;
    run = await distribute({
      repos,
      all,
      apply: flags.has("--apply"),
      confirmation: readOption(args, "--confirm", null) || null,
      catalog: await loadDefaultCatalog(),
      groups: csv(readOption(args, "--group")),
      ids: csv(readOption(args, "--id")),
      writePreview: flags.has("--write-preview"),
      logPath: readOption(args, "--log", DEFAULT_LOG_PATH),
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
