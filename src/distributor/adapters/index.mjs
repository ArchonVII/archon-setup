import * as markdown from "./markdown.mjs";
import * as yaml from "./yaml.mjs";
import * as shell from "./shell.mjs";

// Adapter registry. Each adapter declares the region-engine comment style it
// uses, a metadata policy the distributor enforces on write, and a pure
// detectDanger(body) scanner. Adapters never touch the filesystem (A7).
const ADAPTERS = { markdown, yaml, shell };

export function getAdapter(name) {
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`unknown adapter: ${name}`);
  return adapter;
}

export function adapterNames() {
  return Object.keys(ADAPTERS);
}
