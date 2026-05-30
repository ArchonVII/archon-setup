import { test } from "node:test";
import assert from "node:assert/strict";
import { redactString, redactDeep } from "../src/server/ecosystem/redact.mjs";

test("redacts GitHub PAT and classic token formats", () => {
  assert.match(redactString("ghp_ABCDEFGHIJ0123456789KLMNOP"), /ghp_\[redacted\]/);
  assert.match(redactString("github_pat_11ABCDEFG0123456789_longtail"), /github_pat_\[redacted\]/);
  assert.doesNotMatch(redactString("ghp_ABCDEFGHIJ0123456789KLMNOP"), /0123456789/);
});

test("redacts bearer tokens and key=value secrets, keeps surrounding text", () => {
  assert.equal(redactString("Authorization: Bearer abcdef123456"), "Authorization: Bearer [redacted]");
  assert.equal(redactString("--token=supersecretvalue --port 5174"), "--token=[redacted] --port 5174");
});

test("redactDeep walks objects and arrays, preserving structure", () => {
  const input = { command: "vite --token=secretXYZ", nested: ["plain", "password: hunter2"] };
  const out = redactDeep(input);
  assert.equal(out.command, "vite --token=[redacted]");
  assert.equal(out.nested[0], "plain");
  assert.match(out.nested[1], /password: \[redacted\]/i);
  assert.equal(input.command, "vite --token=secretXYZ"); // original untouched (pure)
});

test("redacts JSON-quoted secret values", () => {
  assert.match(redactString('{"password":"hunter2"}'), /\[redacted\]/);
  assert.doesNotMatch(redactString('{"password":"hunter2"}'), /hunter2/);
  assert.match(redactString('{"token": "abc123def456"}'), /\[redacted\]/);
});
