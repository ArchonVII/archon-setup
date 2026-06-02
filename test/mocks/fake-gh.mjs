#!/usr/bin/env node
// Hermetic `gh` stand-in for the no-remote smoke test (archon-setup#43).
// Wired in via the commandRunner injection seam: the test sets
//   ARCHON_GH_BIN=<node>, ARCHON_GH_ARGS_PREFIX_JSON=["<this file>"]
// so every `gh ...` the wizard runs becomes `node fake-gh.mjs ...`.
//
// It emulates exactly the gh surface the fresh-repo remote path touches:
//   - `repo create <owner>/<repo> --source=<dir> --remote=origin --push`
//       -> init a LOCAL bare repo, wire it as origin, push HEAD. No network.
//   - `repo view <owner>/<repo>`      -> exit 0 iff that bare repo exists
//   - `api repos/<owner>/<repo> ...`  -> exit 0 iff that bare repo exists
// Anything else is a logged no-op (exit 0). Every invocation is appended to
// <remoteDir>/.gh-calls.log so a test can prove the real path ran through it.

import { execFileSync } from "node:child_process";
import { existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const remoteDir = process.env.ARCHON_FAKE_GH_REMOTE_DIR;

if (!remoteDir) {
  process.stderr.write("fake-gh: ARCHON_FAKE_GH_REMOTE_DIR is not set\n");
  process.exit(2);
}

// Record the invocation for test assertions (never includes a real host).
appendFileSync(join(remoteDir, ".gh-calls.log"), args.join(" ") + "\n");

function bareDirFor(ownerRepo) {
  const [owner, repo] = ownerRepo.split("/");
  return join(remoteDir, `${owner}__${repo}.git`);
}

function git(cwd, gitArgs) {
  return execFileSync("git", cwd ? ["-C", cwd, ...gitArgs] : gitArgs, { stdio: "pipe" });
}

function fail(message) {
  process.stderr.write(`fake-gh: ${message}\n`);
  process.exit(1);
}

async function readStdin() {
  let body = "";
  for await (const chunk of process.stdin) body += chunk.toString();
  return body;
}

// `secret set NAME --repo OWNER/REPO`
//
// Mirrors current gh CLI semantics: `--body VALUE` means VALUE is the secret,
// and stdin is read only when `--body` is not specified. The log records the
// source and byte length, never the secret value.
if (args[0] === "secret" && args[1] === "set") {
  const name = args[2] || "";
  const bodyFlag = args.indexOf("--body");
  const source = bodyFlag >= 0 ? "body" : "stdin";
  const value = bodyFlag >= 0 ? (args[bodyFlag + 1] || "") : await readStdin();
  const expected = process.env.ARCHON_FAKE_GH_EXPECT_SECRET;
  if (expected != null && value !== expected) {
    fail(`secret set ${name}: expected ${expected.length} bytes from stdin-compatible input, got ${value.length} bytes from ${source}`);
  }
  appendFileSync(join(remoteDir, ".gh-calls.log"), `secret set ${name} source=${source} bytes=${value.length}\n`);
  process.exit(0);
}

// `repo create <owner>/<repo> [flags] --source=<dir> --remote=origin --push`
if (args[0] === "repo" && args[1] === "create") {
  const ownerRepo = args.slice(2).find((a) => !a.startsWith("-") && a.includes("/"));
  if (!ownerRepo) fail("repo create: could not parse <owner>/<repo>");
  const sourceFlag = args.find((a) => a.startsWith("--source="));
  const source = sourceFlag ? sourceFlag.slice("--source=".length) : process.cwd();
  const bareDir = bareDirFor(ownerRepo);

  // -b main matches the wizard's `git init -b main`, so the bare repo's HEAD
  // resolves to the pushed branch and `git log` works without naming a ref.
  git(null, ["init", "--bare", "-b", "main", bareDir]);
  try {
    git(source, ["remote", "add", "origin", bareDir]);
  } catch {
    git(source, ["remote", "set-url", "origin", bareDir]);
  }
  git(source, ["push", "-u", "origin", "HEAD"]);
  process.stdout.write(`fake-gh: created local bare repo ${bareDir}\n`);
  process.exit(0);
}

// `repo view <owner>/<repo>` — used as an existence probe by the wizard.
if (args[0] === "repo" && args[1] === "view") {
  const ownerRepo = args.slice(2).find((a) => !a.startsWith("-") && a.includes("/"));
  process.exit(ownerRepo && existsSync(bareDirFor(ownerRepo)) ? 0 : 1);
}

// `api repos/<owner>/<repo> [--silent]` — the readiness poll.
if (args[0] === "api") {
  const path = args[1] || "";
  const match = path.match(/^repos\/([^/]+)\/([^/]+)/);
  process.exit(match && existsSync(bareDirFor(`${match[1]}/${match[2]}`)) ? 0 : 1);
}

// Unknown subcommand: harmless no-op so unrelated gh calls never break a flow.
process.exit(0);
