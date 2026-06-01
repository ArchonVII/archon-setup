import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "../src/server/ecosystem/renderHtml.mjs";

const SNAP = {
  schemaVersion: 1, generatedAt: "2026-05-30T20:00:00.000Z",
  summary: { green: 2, yellow: 1, red: 1 },
  ports: [{ port: 5174, command: "vite", live: true, recordedAt: "t" }],
  repos: [{ name: "archon-setup", branch: "main", dirty: false, worktrees: [] }],
  governance: {
    repos: [{
      owner: "ArchonVII",
      name: "archon-setup",
      defaultBranch: "main",
      classic: { status: "present" },
      rulesets: { status: "absent", items: [] },
      posture: {
        prRequired: "required",
        directPush: "blocked",
        forcePush: "blocked",
        deletion: "blocked",
        requiredGate: "required",
      },
    }],
  },
  amber: { online: false, detail: "offline" },
  signals: { anomalies: 1, noticed: 0, recent: ["- [bug] x"] },
};

test("renderHtml emits a self-contained document with the key facts", () => {
  const html = renderHtml(SNAP);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /5174/);
  assert.match(html, /archon-setup/);
  assert.match(html, /Repository governance/);
  assert.match(html, /classic: present/);
  assert.match(html, /required gate: required/);
  assert.match(html, /offline/i);
  assert.doesNotMatch(html, /<script src=/); // self-contained, no external scripts
});
