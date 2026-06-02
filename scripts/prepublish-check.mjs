#!/usr/bin/env node
// Final gate before `npm publish` (wired as the package's `prepublishOnly`
// script). Runs the full test suite and syntax-checks the bin entrypoints so a
// broken build can never be published. Exits non-zero on the first failure.
//
// The test glob is expanded here (not via a shell glob) so behavior is identical
// on Windows and POSIX. `npm pack` inside the suite does not re-trigger this
// script (prepublishOnly runs only on `npm publish`, not on `npm pack`).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(args) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

console.log("prepublish: running test suite…");
const testFiles = readdirSync(join(root, "test"))
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => join("test", f));
run(["--test", ...testFiles]);

console.log("prepublish: syntax-checking bin entrypoints…");
for (const bin of readdirSync(join(root, "bin")).filter((f) => f.endsWith(".mjs"))) {
  run(["--check", join("bin", bin)]);
}

console.log("prepublish: OK");
