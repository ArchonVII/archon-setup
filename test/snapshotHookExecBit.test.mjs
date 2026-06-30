import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// #314: the vendored repo-template git hooks must ship EXECUTABLE (100755) in the
// snapshot. They previously shipped 100644 because `npm run refresh-snapshots`
// runs on Windows (`core.filemode=false`), so `git add` recorded new hook files
// with the non-executable mode. git skips non-executable hooks on Unix/CI once
// `core.hooksPath=.githooks` is set, so the commit-msg/pre-commit policy guards
// would silently no-op in onboarded repos. refresh-snapshots now sets the exec
// bit in the index (`git update-index --chmod=+x`); this test pins the END STATE
// against the git index so a future refresh that drops the bit fails CI.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = "src/snapshots/repo-template/.githooks";

function lsFiles(pathspec) {
  return execFileSync("git", ["-C", ROOT, "ls-files", "-s", "--", pathspec], {
    encoding: "utf8",
  }).trim();
}

// A hook ENTRYPOINT git actually invokes: the commit-msg/pre-commit dispatchers
// and every `scripts/*.sh` helper they source. README/non-.sh files are not run
// by git, so their mode is irrelevant.
function isExecutableHook(path) {
  return (
    /\/\.githooks\/(commit-msg|pre-commit)$/.test(path) ||
    /\/\.githooks\/scripts\/[^/]+\.sh$/.test(path)
  );
}

test("vendored repo-template .githooks ship 100755 in the snapshot index (#314)", () => {
  const lines = lsFiles(HOOKS_DIR)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return { mode: meta.split(" ")[0], path };
    });

  const hooks = lines.filter((entry) => isExecutableHook(entry.path));
  // commit-msg + pre-commit + the six scripts/*.sh helpers = 8 entrypoints.
  assert.ok(
    hooks.length >= 8,
    `expected at least 8 vendored hook entrypoints, found ${hooks.length}:\n${lines
      .map((l) => `${l.mode} ${l.path}`)
      .join("\n")}`,
  );

  const nonExecutable = hooks.filter((entry) => entry.mode !== "100755");
  assert.equal(
    nonExecutable.length,
    0,
    `these vendored hooks must be 100755 (run npm run refresh-snapshots):\n${nonExecutable
      .map((entry) => `${entry.mode} ${entry.path}`)
      .join("\n")}`,
  );
});
