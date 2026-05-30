import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { pickFolder } from "../src/server/lib/pickFolder.mjs";
import { RPC, STATE_CHANGING } from "../src/server/rpc.mjs";

function fakeSpawn({ stdout = "", stderr = "", code = 0, close = true } = {}) {
  const calls = [];
  const children = [];

  const spawnImpl = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killCalls = [];
    child.kill = (signal) => {
      child.killCalls.push(signal);
      child.killed = true;
      return true;
    };
    children.push(child);

    if (close) {
      queueMicrotask(() => {
        if (stdout) child.stdout.emit("data", Buffer.from(stdout));
        if (stderr) child.stderr.emit("data", Buffer.from(stderr));
        child.emit("close", code);
      });
    }

    return child;
  };

  return { spawnImpl, calls, children };
}

test("folder.pick is POST-only state-changing RPC", () => {
  assert.equal(typeof RPC["folder.pick"], "function");
  assert.equal(STATE_CHANGING.has("folder.pick"), true);
});

test("folder.pick returns a normalized selected path through mocked spawn", async () => {
  const selected = resolve("tmp", "archon", "..", "chosen");
  const fake = fakeSpawn({ stdout: `${selected}\n`, code: 0 });

  const result = await RPC["folder.pick"]({}, {
    pickFolderOptions: { platform: "win32", spawnImpl: fake.spawnImpl },
  });

  assert.deepEqual(result, { path: resolve(selected) });
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].cmd, /powershell/i);
  assert.deepEqual(fake.calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(fake.calls[0].options.shell, false);
  assert.ok(fake.calls[0].args.includes("-STA"));
  assert.ok(fake.calls[0].args.includes("-NoProfile"));
  assert.ok(fake.calls[0].args.includes("-NonInteractive"));
});

test("pickFolder reports cancellation from the native dialog exit code", async () => {
  const fake = fakeSpawn({ code: 2 });

  const result = await pickFolder({ platform: "win32", spawnImpl: fake.spawnImpl });

  assert.deepEqual(result, { cancelled: true });
});

test("pickFolder reports unsupported immediately outside Windows", async () => {
  let called = false;
  const result = await pickFolder({
    platform: "linux",
    spawnImpl: () => {
      called = true;
      throw new Error("should not spawn");
    },
  });

  assert.deepEqual(result, { unsupported: true });
  assert.equal(called, false);
});

test("pickFolder returns the child error message when PowerShell fails", async () => {
  const fake = fakeSpawn({ stderr: "dialog unavailable\n", code: 1 });

  const result = await pickFolder({ platform: "win32", spawnImpl: fake.spawnImpl });

  assert.deepEqual(result, { error: "dialog unavailable" });
});

test("pickFolder kills a hung dialog and returns timeout error", async () => {
  const fake = fakeSpawn({ close: false });

  const result = await pickFolder({
    platform: "win32",
    spawnImpl: fake.spawnImpl,
    timeoutMs: 5,
  });

  assert.deepEqual(result, { error: "dialog timed out" });
  assert.equal(fake.children.length, 1);
  assert.deepEqual(fake.children[0].killCalls, ["SIGKILL"]);
});
