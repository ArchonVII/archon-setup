import { test } from "node:test";
import assert from "node:assert/strict";

import { checkActionlint, WINDOWS_ACTIONLINT_PATH } from "../src/server/preflight/checkActionlint.mjs";

test("actionlint preflight uses PATH lookup before broad filesystem searches", async () => {
  const calls = [];

  const result = await checkActionlint({
    platform: "win32",
    exists: () => false,
    commandRunner: async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "actionlint version 1.7.7\n", stderr: "" };
    },
  });

  assert.equal(result.id, "actionlint");
  assert.equal(result.status, "green");
  assert.equal(result.detail, "actionlint version 1.7.7");
  assert.deepEqual(calls, [{ cmd: "actionlint", args: ["-version"] }]);
});

test("actionlint preflight falls back to the standard Windows tool path", async () => {
  const calls = [];

  const result = await checkActionlint({
    platform: "win32",
    exists: (path) => path === WINDOWS_ACTIONLINT_PATH,
    commandRunner: async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "actionlint") {
        const err = new Error("not found");
        err.code = "ENOENT";
        throw err;
      }
      return { code: 0, stdout: "actionlint version 1.7.7\n", stderr: "" };
    },
  });

  assert.equal(result.status, "green");
  assert.match(result.detail, /actionlint version 1\.7\.7/);
  assert.deepEqual(calls, [
    { cmd: "actionlint", args: ["-version"] },
    { cmd: WINDOWS_ACTIONLINT_PATH, args: ["-version"] },
  ]);
});

test("missing actionlint is advisory and gives the stable Windows install path", async () => {
  const result = await checkActionlint({
    platform: "win32",
    exists: () => false,
    commandRunner: async () => {
      const err = new Error("not found");
      err.code = "ENOENT";
      throw err;
    },
  });

  assert.equal(result.id, "actionlint");
  assert.equal(result.status, "yellow");
  assert.match(result.detail, /not found on PATH/);
  assert.match(result.detail, /C:\\Tools\\actionlint\\actionlint\.exe/);
  assert.match(result.fix, /actionlint <workflow-files>/);
});
