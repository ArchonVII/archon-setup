import { test } from "node:test";
import assert from "node:assert/strict";

import { addPrLabel, createDraftPr, listPrChecks, queueAutoMerge } from "../src/server/prlane/ghPr.mjs";

function fakeGh(responses) {
  const calls = [];
  const runGh = async (args, options = {}) => {
    calls.push({ args, options });
    const response = responses.shift();
    if (!response) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    return typeof response === "function" ? response(args, options) : response;
  };
  return { calls, runGh };
}

test("ghPr creates a draft PR with a stdin body and parses the returned URL", async () => {
  const { calls, runGh } = fakeGh([{ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/457\n", stderr: "" }]);

  const pr = await createDraftPr({
    repoSlug: "ArchonVII/consumer-repo",
    base: "main",
    head: "agent/refresh/run-159",
    title: "feat(agents): refresh managed regions",
    body: "## Summary\n\nManaged-region refresh.\n",
    runGh,
  });

  assert.deepEqual(pr, { number: 457, url: "https://github.com/ArchonVII/consumer-repo/pull/457" });
  assert.deepEqual(calls[0].args, [
    "pr",
    "create",
    "--repo",
    "ArchonVII/consumer-repo",
    "--base",
    "main",
    "--head",
    "agent/refresh/run-159",
    "--title",
    "feat(agents): refresh managed regions",
    "--draft",
    "--body-file",
    "-",
  ]);
  assert.equal(calls[0].options.stdin, "## Summary\n\nManaged-region refresh.\n");
});

test("ghPr labels the PR and reads JSON check status", async () => {
  const { calls, runGh } = fakeGh([
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: JSON.stringify([{ name: "test", status: "passed" }]), stderr: "" },
  ]);

  await addPrLabel({ repoSlug: "ArchonVII/consumer-repo", prNumber: 457, label: "automated-distribution", runGh });
  const checks = await listPrChecks({ repoSlug: "ArchonVII/consumer-repo", prNumber: 457, runGh });

  assert.deepEqual(calls[0].args, [
    "pr",
    "edit",
    "457",
    "--repo",
    "ArchonVII/consumer-repo",
    "--add-label",
    "automated-distribution",
  ]);
  assert.deepEqual(calls[1].args, ["pr", "checks", "457", "--repo", "ArchonVII/consumer-repo", "--json", "name,status,conclusion"]);
  assert.deepEqual(checks, [{ name: "test", status: "passed" }]);
});

test("ghPr queues auto-merge without force flags", async () => {
  const { calls, runGh } = fakeGh([{ code: 0, stdout: "", stderr: "" }]);

  await queueAutoMerge({ repoSlug: "ArchonVII/consumer-repo", prNumber: 457, method: "squash", runGh });

  assert.deepEqual(calls[0].args, [
    "pr",
    "merge",
    "457",
    "--repo",
    "ArchonVII/consumer-repo",
    "--auto",
    "--squash",
    "--delete-branch",
  ]);
  assert.equal(calls[0].args.some((arg) => /force/i.test(arg)), false);
});

test("ghPr reports gh failures and malformed JSON with actionable errors", async () => {
  await assert.rejects(
    createDraftPr({
      repoSlug: "ArchonVII/consumer-repo",
      base: "main",
      head: "agent/refresh/run-159",
      title: "feat(agents): refresh managed regions",
      body: "body",
      runGh: async () => ({ code: 1, stdout: "", stderr: "missing auth" }),
    }),
    /gh pr create failed: missing auth/,
  );

  await assert.rejects(
    listPrChecks({
      repoSlug: "ArchonVII/consumer-repo",
      prNumber: 457,
      runGh: async () => ({ code: 0, stdout: "not-json", stderr: "" }),
    }),
    /gh pr checks returned unparseable JSON/,
  );
});
