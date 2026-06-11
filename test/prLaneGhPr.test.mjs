import { test } from "node:test";
import assert from "node:assert/strict";

import { addPrLabel, createDraftPr, getPrView, listPrChecks, queueAutoMerge } from "../src/server/prlane/ghPr.mjs";

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
    { code: 0, stdout: JSON.stringify([{ name: "test", state: "SUCCESS", bucket: "pass" }]), stderr: "" },
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
  assert.deepEqual(calls[1].args, ["pr", "checks", "457", "--repo", "ArchonVII/consumer-repo", "--json", "name,state,bucket,link,workflow"]);
  assert.deepEqual(checks, [{ name: "test", state: "SUCCESS", bucket: "pass" }]);
});

test("ghPr treats pending check exit code 8 as resumable status output", async () => {
  const { runGh } = fakeGh([
    { code: 8, stdout: JSON.stringify([{ name: "test", state: "PENDING", bucket: "pending" }]), stderr: "" },
  ]);

  const checks = await listPrChecks({ repoSlug: "ArchonVII/consumer-repo", prNumber: 457, runGh });

  assert.deepEqual(checks, [{ name: "test", state: "PENDING", bucket: "pending" }]);
});

test("ghPr can create a non-draft PR for auto-merge mode", async () => {
  const { calls, runGh } = fakeGh([{ code: 0, stdout: "https://github.com/ArchonVII/consumer-repo/pull/457\n", stderr: "" }]);

  await createDraftPr({
    repoSlug: "ArchonVII/consumer-repo",
    base: "main",
    head: "agent/refresh/run-159",
    title: "feat(agents): refresh managed regions",
    body: "body",
    draft: false,
    runGh,
  });

  assert.equal(calls[0].args.includes("--draft"), false);
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

test("ghPr fetches the PR's actual labels and body and surfaces gh failures", async () => {
  const { calls, runGh } = fakeGh([
    { code: 0, stdout: JSON.stringify({ labels: [{ name: "automated-distribution" }], body: "Closes #163" }), stderr: "" },
  ]);

  const view = await getPrView({ repoSlug: "ArchonVII/consumer-repo", prNumber: 163, runGh });

  assert.deepEqual(calls[0].args, ["pr", "view", "163", "--repo", "ArchonVII/consumer-repo", "--json", "labels,body"]);
  assert.deepEqual(view, { labels: [{ name: "automated-distribution" }], body: "Closes #163" });

  await assert.rejects(
    getPrView({ repoSlug: "ArchonVII/consumer-repo", prNumber: 163, runGh: async () => ({ code: 1, stdout: "", stderr: "no pr" }) }),
    /gh pr view failed: no pr/,
  );
});
