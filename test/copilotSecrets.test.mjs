import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as setRepoSecrets from "../src/server/tasks/setRepoSecrets.mjs";
import * as enableCopilot from "../src/server/tasks/enableCopilot.mjs";
import { buildSecretSetCommand, secretRemoteAction } from "../src/server/tasks/setRepoSecrets.mjs";
import { classifyCopilotTarget } from "../src/server/tasks/enableCopilot.mjs";
import { redactString } from "../src/server/ecosystem/redact.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURES = JSON.parse(readFileSync(join(ROOT, "src/registry/features.json"), "utf8"));

// --- the security-critical contract: the value never leaves stdin -------------

test("buildSecretSetCommand carries the value on stdin, never on argv", () => {
  const SECRET = "ghp_supersecretvalue1234567890";
  const { cmd, args, stdin } = buildSecretSetCommand({
    name: "NPM_TOKEN",
    value: SECRET,
    owner: "ArchonVII",
    repo: "demo",
  });
  assert.equal(cmd, "gh");
  assert.equal(stdin, SECRET);
  assert.ok(!args.join(" ").includes(SECRET), "secret value must never appear anywhere in argv");
});

test("buildSecretSetCommand targets the repo and reads the body from stdin", () => {
  const { args } = buildSecretSetCommand({ name: "NPM_TOKEN", value: "x", owner: "ArchonVII", repo: "demo" });
  assert.deepEqual(args.slice(0, 3), ["secret", "set", "NPM_TOKEN"]);
  assert.ok(args.includes("--repo") && args.includes("ArchonVII/demo"), "must target owner/repo");
  assert.ok(args.includes("--body") && args.includes("-"), "value must be read from stdin via --body -");
});

test("secretRemoteAction records the name + wasSet but never the value", () => {
  const entry = secretRemoteAction("NPM_TOKEN");
  assert.equal(entry.type, "secret.set");
  assert.equal(entry.name, "NPM_TOKEN");
  assert.equal(entry.wasSet, true);
  assert.ok(!("value" in entry), "the manifest entry must not carry a value field");
});

// --- redaction backstop -------------------------------------------------------

test("redactString masks an accidental `gh secret set NAME VALUE` argv leak", () => {
  const masked = redactString("running: gh secret set NPM_TOKEN s3cr3t-value-not-a-flag");
  assert.doesNotMatch(masked, /s3cr3t-value-not-a-flag/);
  assert.match(masked, /gh secret set NPM_TOKEN/); // name preserved
  assert.match(masked, /\[redacted\]/);
});

test("redactString still masks a GitHub token (existing pattern regression)", () => {
  const masked = redactString("token=ghp_abcdefghijklmnopqrstuvwxyz0123");
  assert.doesNotMatch(masked, /ghp_abcdefghijklmnopqrstuvwxyz0123/);
});

// --- Copilot enablement: org-only, with a manual checklist --------------------

test("classifyCopilotTarget blocks a personal (User) account", () => {
  const r = classifyCopilotTarget({ ownerType: "User" });
  assert.equal(r.status, "blocked");
  assert.match(r.reason, /org/i);
});

test("classifyCopilotTarget returns a manual checklist for an organization", () => {
  const r = classifyCopilotTarget({ ownerType: "Organization" });
  assert.equal(r.status, "manual-required");
  assert.ok(Array.isArray(r.checklist) && r.checklist.length > 0, "org path must include a manual checklist");
});

// --- staged-disabled registry wiring -----------------------------------------

test("the copilot features are registered, disabled, non-default, in the copilot group", () => {
  for (const id of ["copilot.enable-repo", "copilot.repo-secret"]) {
    const f = FEATURES.find((x) => x.id === id);
    assert.ok(f, `feature ${id} must exist`);
    assert.equal(f.disabled, true, `${id} must be disabled (v0.4 gate)`);
    assert.equal(f.default, false, `${id} must not be a default`);
    assert.equal(f.group, "copilot");
  }
});

test("the copilot features map to their tasks", () => {
  assert.ok(FEATURES.find((x) => x.id === "copilot.enable-repo").tasks.includes("enableCopilot"));
  assert.ok(FEATURES.find((x) => x.id === "copilot.repo-secret").tasks.includes("setRepoSecrets"));
});

test("setRepoSecrets and enableCopilot are valid task modules", () => {
  for (const mod of [setRepoSecrets, enableCopilot]) {
    assert.equal(typeof mod.check, "function");
    assert.equal(typeof mod.apply, "function");
    assert.equal(typeof mod.verify, "function");
  }
});
