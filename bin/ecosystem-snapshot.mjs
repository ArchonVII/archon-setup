#!/usr/bin/env node
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { buildSnapshot } from "../src/server/ecosystem/snapshot.mjs";
import { redactDeep } from "../src/server/ecosystem/redact.mjs";
import { renderHtml } from "../src/server/ecosystem/renderHtml.mjs";
import { writeAtomic } from "../src/server/ecosystem/writeAtomic.mjs";

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const home = homedir();
const outDir = resolve(flag("out-dir", join(home, ".claude")));
const githubRoot = resolve(flag("github-root", "C:\\GitHub"));
const portRegistryPath = resolve(flag("port-registry", join(home, ".claude", "port-registry.json")));
const anomaliesPath = resolve(flag("anomalies", join(home, ".claude", "anomalies.md")));
const amberNode = new RegExp(flag("amber-node", "amber"), "i");

const snap = await buildSnapshot({ portRegistryPath, githubRoot, amberNode, anomaliesPath });
const safe = redactDeep(snap); // SECRETS NEVER TOUCH DISK — redact before any write

await writeAtomic(join(outDir, "ecosystem-state.json"), JSON.stringify(safe, null, 2));
await writeAtomic(join(outDir, "ecosystem.html"), renderHtml(safe));

console.log(`ecosystem snapshot written to ${outDir}`);
console.log(`  ports: ${safe.ports.length} · repos: ${safe.repos.length} · amber: ${safe.amber.online ? "online" : "offline"} · summary: ${JSON.stringify(safe.summary)}`);
