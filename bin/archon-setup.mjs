#!/usr/bin/env node
import { startServer } from "../src/server/index.mjs";
import { updateManagedFiles } from "../src/updater/updateManagedFiles.mjs";

const argv = process.argv.slice(2);

if (argv[0] === "update") {
  const args = new Set(argv.slice(1));
  const targetIndex = argv.indexOf("--target");
  const targetPath = targetIndex >= 0 ? argv[targetIndex + 1] : process.cwd();
  const result = await updateManagedFiles({
    targetPath,
    dryRun: args.has("--dry-run"),
  });

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

startServer({ port: 0, openBrowser: !noOpen }).then(({ url }) => {
  if (dev) console.log(`[dev] hot reload not yet wired; reload the browser to pick up changes.`);
  console.log(`Press Ctrl+C to stop.\n`);
});
