import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCommand, runCommand } from "../src/server/lib/commandRunner.mjs";

// Set/restore a group of env vars around a synchronous body. `undefined`
// means "ensure this var is unset for the duration".
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("resolveCommand is a no-op when no override env is set", () => {
  withEnv(
    {
      ARCHON_GH_BIN: undefined,
      ARCHON_GH_ARGS_PREFIX_JSON: undefined,
      ARCHON_GIT_BIN: undefined,
      ARCHON_GIT_ARGS_PREFIX_JSON: undefined,
    },
    () => {
      assert.deepEqual(resolveCommand("gh", ["repo", "view"]), { cmd: "gh", args: ["repo", "view"] });
      assert.deepEqual(resolveCommand("git", ["status"]), { cmd: "git", args: ["status"] });
      assert.deepEqual(resolveCommand("node", ["x.mjs"]), { cmd: "node", args: ["x.mjs"] });
    }
  );
});

test("resolveCommand substitutes the gh binary when ARCHON_GH_BIN is set", () => {
  withEnv({ ARCHON_GH_BIN: "/path/to/node", ARCHON_GH_ARGS_PREFIX_JSON: undefined }, () => {
    assert.deepEqual(resolveCommand("gh", ["repo", "view"]), { cmd: "/path/to/node", args: ["repo", "view"] });
  });
});

test("resolveCommand prepends a JSON args prefix for the overridden binary", () => {
  withEnv(
    { ARCHON_GH_BIN: "/path/to/node", ARCHON_GH_ARGS_PREFIX_JSON: JSON.stringify(["/mocks/fake-gh.mjs"]) },
    () => {
      assert.deepEqual(resolveCommand("gh", ["repo", "create"]), {
        cmd: "/path/to/node",
        args: ["/mocks/fake-gh.mjs", "repo", "create"],
      });
    }
  );
});

test("resolveCommand overrides git independently of gh", () => {
  withEnv({ ARCHON_GIT_BIN: "/path/to/fakegit", ARCHON_GH_BIN: undefined }, () => {
    assert.deepEqual(resolveCommand("git", ["push"]), { cmd: "/path/to/fakegit", args: ["push"] });
    assert.deepEqual(resolveCommand("gh", ["api"]), { cmd: "gh", args: ["api"] });
  });
});

test("resolveCommand does not override unrelated binaries even when gh override is set", () => {
  withEnv({ ARCHON_GH_BIN: "/path/to/node" }, () => {
    assert.deepEqual(resolveCommand("node", ["x"]), { cmd: "node", args: ["x"] });
  });
});

test("resolveCommand throws a clear error when the args-prefix env is not a JSON array", () => {
  withEnv({ ARCHON_GH_BIN: "/path/to/node", ARCHON_GH_ARGS_PREFIX_JSON: "not json" }, () => {
    assert.throws(() => resolveCommand("gh", []), /ARCHON_GH_ARGS_PREFIX_JSON must be a JSON array/);
  });
});

test("resolveCommand rejects a JSON args-prefix that is not an array", () => {
  withEnv({ ARCHON_GH_BIN: "/path/to/node", ARCHON_GH_ARGS_PREFIX_JSON: JSON.stringify({ not: "array" }) }, () => {
    assert.throws(() => resolveCommand("gh", []), /ARCHON_GH_ARGS_PREFIX_JSON must be a JSON array/);
  });
});

test("runCommand routes through the overridden binary end-to-end", async () => {
  const saved = {
    ARCHON_GH_BIN: process.env.ARCHON_GH_BIN,
    ARCHON_GH_ARGS_PREFIX_JSON: process.env.ARCHON_GH_ARGS_PREFIX_JSON,
  };
  process.env.ARCHON_GH_BIN = process.execPath;
  // node -e "<code>" repo view  ->  process.argv.slice(1) === ["repo","view"]
  process.env.ARCHON_GH_ARGS_PREFIX_JSON = JSON.stringify([
    "-e",
    "process.stdout.write('MOCK:'+process.argv.slice(1).join(' '))",
  ]);
  try {
    const res = await runCommand("gh", ["repo", "view"]);
    assert.equal(res.code, 0);
    assert.equal(res.stdout, "MOCK:repo view");
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
