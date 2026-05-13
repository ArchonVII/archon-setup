#!/usr/bin/env node
import { startServer } from "../src/server/index.mjs";

const args = new Set(process.argv.slice(2));
const dev = args.has("--dev");
const noOpen = args.has("--no-open");

startServer({ port: 0, openBrowser: !noOpen }).then(({ url }) => {
  if (dev) console.log(`[dev] hot reload not yet wired; reload the browser to pick up changes.`);
  console.log(`Press Ctrl+C to stop.\n`);
});
