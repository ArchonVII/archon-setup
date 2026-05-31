import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRepoTarget, applyResolvedRepoTarget, isBlockingWarning } from "../src/server/planner/repoTarget.mjs";

test("explicit owner/repo beats detected origin", () => {
  const t = resolveRepoTarget({
    explicit: { owner: "org", repo: "main" },
    originDetected: { owner: "user", repo: "fork" },
    selection: [],
  });
  assert.deepEqual(t, { status: "known", source: "explicit", owner: "org", repo: "main" });
});

test("detected origin used when no explicit", () => {
  const t = resolveRepoTarget({ explicit: null, originDetected: { owner: "user", repo: "fork" }, selection: [] });
  assert.deepEqual(t, { status: "known", source: "origin", owner: "user", repo: "fork" });
});

test("will-create only when remote.github selected and no known target", () => {
  assert.deepEqual(
    resolveRepoTarget({ explicit: null, originDetected: null, selection: ["remote.github"] }),
    { status: "will-create", source: "remote.github" }
  );
  assert.deepEqual(resolveRepoTarget({ explicit: null, originDetected: null, selection: [] }), { status: "none" });
});

test("applyResolvedRepoTarget sets owner/repo for known, never mutates input", () => {
  const ctx = { owner: "stale", repo: "stale", visibility: "private" };
  const out = applyResolvedRepoTarget(ctx, { status: "known", source: "origin", owner: "u", repo: "r" });
  assert.equal(out.owner, "u");
  assert.equal(out.repo, "r");
  assert.deepEqual(out.githubRepoTarget, { status: "known", source: "origin", owner: "u", repo: "r" });
  assert.equal(ctx.owner, "stale", "input context must not be mutated");
});

test("applyResolvedRepoTarget leaves owner/repo for will-create and none", () => {
  const ctx = { owner: "o", repo: "r" };
  const wc = applyResolvedRepoTarget(ctx, { status: "will-create", source: "remote.github" });
  assert.equal(wc.owner, "o");
  assert.deepEqual(wc.githubRepoTarget.status, "will-create");
});

test("isBlockingWarning: error severity, legacy ci, and conflicts block", () => {
  assert.equal(isBlockingWarning({ severity: "error", message: "x" }), true);
  assert.equal(isBlockingWarning({ feature: "workflows.ci", message: "no CI" }), true);
  assert.equal(isBlockingWarning({ feature: "x", message: "conflicts with foundation.y" }), true);
  assert.equal(isBlockingWarning({ severity: "warn", feature: "x", message: "installed locally" }), false);
});
