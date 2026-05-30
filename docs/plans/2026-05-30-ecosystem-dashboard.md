# Ecosystem Dashboard — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a read-only "glance" dashboard to the existing `archon-setup` server that snapshots Joseph's AI ecosystem (open ports + owners, repo health, concurrent-agent/worktree map, Amber status, anomaly/noticed signals) into a machine-readable `ecosystem-state.json` (agents read it) and a self-contained `ecosystem.html` (Joseph glances at it), with all secrets redacted before anything touches disk.

**Architecture:** A new `src/server/ecosystem/` module of **pure parsers + thin I/O collectors** following archon-setup's existing preflight `{ id, status, detail }` contract. A CLI entry (`bin/ecosystem-snapshot.mjs`) composes the collectors, runs every collected string through a redactor, and writes JSON + HTML **atomically** (tmp-then-rename, so a reading agent never sees a torn file). No new network exposure, no editing of any config (read-only), no Amber migration. The live UI screen and RPC method are deferred to Phases 2–3.

**Tech Stack:** Node ≥20 ESM, `node:test` + `node:assert/strict`, `node:child_process` spawn via the repo's `runCommand`, no new dependencies.

**Why this shape (decided by two independent councils + cross-review):**

- Host inside `archon-setup` — its `ROADMAP.md` already plans "Events stream support … and a status-board view" and "Audit existing repo mode," and its "secrets must never touch disk or logs" doctrine matches our redaction requirement.
- Read-only first — `.claude\skills`, `.codex\skills`, `.gemini\skills`, and `.claude\hooks` are all **junctions into `C:\Users\josep\skills\shared`**, so any write hits three live CLIs with no lock. Editing is deferred behind diff-preview + atomic write.
- Port ownership is **timestamped, never asserted** — the live registry proves staleness in both directions (ghost `7881`; live `5300/5912/5913` absent) and every `launcher*` field is `null`.
- Emit JSON in Phase 1 (not deferred to an MCP) — it's the _source_ the HTML renders from, and it's what turns "is 5174 mine?" into a file read today.

---

## Conventions this plan follows (from `AGENTS.md`)

- **Branch:** `agent/claude/<issue>-ecosystem-dashboard` (create an issue first with Acceptance Criteria). **Never commit to `main`.**
- **Conventional Commits:** `<type>(<scope>): <desc>`, one logical unit per commit, selective `git add <path>` (never `-A`).
- **Verify:** `npm test` must pass; record exact output in the PR's `### Verification Notes`.
- **Collector contract:** every collector returns `{ id, status: "green"|"yellow"|"red", detail, ...payload }` exactly like `src/server/preflight/*`.
- **Secrets non-negotiable:** redacted strings only ever reach disk. The redactor is tested first.
- **Test design note:** Split each collector into a **pure parser** (fixture-tested, no I/O) and a **thin async collector** (spawns git/tailscale, calls the parser). Tests target the pure parsers, the redactor, the atomic writer, the aggregator shape, and the renderer — never spawn git/tailscale in CI.

---

## Output contract (`ecosystem-state.json`, schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-30T20:00:00.000Z",
  "summary": { "green": 2, "yellow": 1, "red": 0 },
  "ports": [
    {
      "port": 5174,
      "pid": 49472,
      "process": "node.exe",
      "command": "…vite…",
      "startedAt": "…",
      "recordedAt": "…",
      "live": true
    }
  ],
  "repos": [
    {
      "name": "archon-setup",
      "path": "C:\\GitHub\\archon-setup",
      "branch": "main",
      "dirty": false,
      "lastCommit": { "hash": "abc1234", "committedAt": "…", "subject": "…" },
      "worktrees": [{ "path": "…", "branch": "…" }]
    }
  ],
  "amber": {
    "id": "amber",
    "status": "red",
    "detail": "amber-wsl offline (last seen …)",
    "online": false,
    "lastSeen": "…"
  },
  "signals": {
    "id": "signals",
    "status": "green",
    "detail": "1 anomaly, 3 noticed",
    "anomalies": 1,
    "noticed": 3,
    "recent": ["…"]
  }
}
```

A short `docs/ECOSYSTEM_STATE.md` documents this contract so any of the three CLIs can consume it.

---

## Task 0: Issue + branch

**Step 1:** Create the GitHub issue (Task form) with Acceptance Criteria = "Phase-1 collectors + redactor + atomic writer + CLI produce a redacted `ecosystem-state.json` and `ecosystem.html`; `npm test` green."

Run: `gh issue create --repo ArchonVII/archon-setup --title "feat: ecosystem dashboard (phase 1 snapshot)" --body "..."`

**Step 2:** Create the branch (use a worktree per superpowers:using-git-worktrees).

Run: `git -C C:\GitHub\archon-setup worktree add ..\archon-setup-ecosystem -b agent/claude/<issue>-ecosystem-dashboard`
Expected: new worktree on the feature branch. All subsequent paths below are relative to that worktree root.

**Step 3:** Confirm baseline green.

Run: `npm test`
Expected: existing suite passes (this is your regression baseline).

---

## Task 1: Secret redactor (build this FIRST — it gates every disk write)

**Files:**

- Create: `src/server/ecosystem/redact.mjs`
- Test: `test/ecosystemRedact.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactString, redactDeep } from "../src/server/ecosystem/redact.mjs";

test("redacts GitHub PAT and classic token formats", () => {
  assert.match(
    redactString("ghp_ABCDEFGHIJ0123456789KLMNOP"),
    /ghp_\[redacted\]/,
  );
  assert.match(
    redactString("github_pat_11ABCDEFG0123456789_longtail"),
    /github_pat_\[redacted\]/,
  );
  assert.doesNotMatch(
    redactString("ghp_ABCDEFGHIJ0123456789KLMNOP"),
    /0123456789/,
  );
});

test("redacts bearer tokens and key=value secrets, keeps surrounding text", () => {
  assert.equal(
    redactString("Authorization: Bearer abcdef123456"),
    "Authorization: Bearer [redacted]",
  );
  assert.equal(
    redactString("--token=supersecretvalue --port 5174"),
    "--token=[redacted] --port 5174",
  );
});

test("redactDeep walks objects and arrays, preserving structure", () => {
  const input = {
    command: "vite --token=secretXYZ",
    nested: ["plain", "password: hunter2"],
  };
  const out = redactDeep(input);
  assert.equal(out.command, "vite --token=[redacted]");
  assert.equal(out.nested[0], "plain");
  assert.match(out.nested[1], /password: \[redacted\]/i);
  assert.equal(input.command, "vite --token=secretXYZ"); // original untouched (pure)
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemRedact.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/redact.mjs
// Redacts common secret formats from any string before it is written to disk.
// Patterns sourced from GitHub token prefixes (ghp_/gho_/github_pat_, docs.github.com),
// AWS access-key id format (AKIA + 16 base32, AWS IAM docs), and generic key=value secrets.
const PATTERNS = [
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/gh[posru]_[A-Za-z0-9]{20,}/g, (m) => `${m.slice(0, 4)}[redacted]`],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]"],
  [
    /((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*)("?)[^"\s&]+\2/gi,
    "$1[redacted]",
  ],
];

export function redactString(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redactDeep(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = redactDeep(v);
    return o;
  }
  return value;
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemRedact.test.mjs`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/server/ecosystem/redact.mjs test/ecosystemRedact.test.mjs
git commit -m "feat(ecosystem): add secret redactor for snapshot output"
```

---

## Task 2: Atomic writer (tmp-then-rename — prevents torn reads by agents)

**Files:**

- Create: `src/server/ecosystem/writeAtomic.mjs`
- Test: `test/ecosystemWriteAtomic.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../src/server/ecosystem/writeAtomic.mjs";

test("writeAtomic writes full content and leaves no .tmp behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eco-"));
  try {
    const target = join(dir, "state.json");
    await writeAtomic(target, '{"ok":true}');
    assert.equal(await readFile(target, "utf8"), '{"ok":true}');
    await assert.rejects(readFile(target + ".tmp", "utf8")); // tmp cleaned up
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemWriteAtomic.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/writeAtomic.mjs
import { writeFile, rename } from "node:fs/promises";

// Writes to <path>.tmp then renames over <path>. rename is atomic on the same
// volume (POSIX + NTFS), so a concurrent reader sees either the old file or the
// new one — never a half-written file. Used because agents read ecosystem-state.json.
export async function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
  return { path };
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemWriteAtomic.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/ecosystem/writeAtomic.mjs test/ecosystemWriteAtomic.test.mjs
git commit -m "feat(ecosystem): add atomic tmp-then-rename writer"
```

---

## Task 3: Ports collector (parser + liveness)

**Files:**

- Create: `src/server/ecosystem/collectPorts.mjs`
- Test: `test/ecosystemPorts.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePortRegistry } from "../src/server/ecosystem/collectPorts.mjs";

const REGISTRY = {
  5174: {
    pid: 49472,
    process: "node.exe",
    command: "vite --port 5174",
    startedAt: "a",
    recordedAt: "b",
  },
  7881: {
    pid: 44868,
    process: "node.exe",
    command: "tsx zombie",
    startedAt: "c",
    recordedAt: "d",
  },
};

test("parsePortRegistry marks liveness via injected probe and sorts by port", () => {
  const alivePids = new Set([49472]); // 7881's pid is dead
  const r = parsePortRegistry(REGISTRY, (pid) => alivePids.has(pid));
  assert.equal(r.id, "ports");
  assert.equal(r.ports[0].port, 5174);
  assert.equal(r.ports[0].live, true);
  assert.equal(r.ports[1].port, 7881);
  assert.equal(r.ports[1].live, false);
  assert.match(r.detail, /1\/2/); // 1 of 2 live
});

test("parsePortRegistry tolerates empty registry", () => {
  const r = parsePortRegistry({}, () => true);
  assert.equal(r.status, "yellow");
  assert.deepEqual(r.ports, []);
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemPorts.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/collectPorts.mjs
import { readFile } from "node:fs/promises";

// process.kill(pid, 0) sends no signal but throws ESRCH if the pid is gone.
// EPERM means it exists but isn't ours — still "alive". (Node docs: process.kill)
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Pure: shape the registry object, marking liveness via the injected probe.
export function parsePortRegistry(registryObj, isAlive) {
  const ports = Object.entries(registryObj || {})
    .map(([port, e]) => ({
      port: Number(port),
      pid: e.pid ?? null,
      process: e.process ?? null,
      command: e.command ?? "",
      startedAt: e.startedAt ?? null,
      recordedAt: e.recordedAt ?? null,
      live: e.pid != null ? isAlive(e.pid) : false,
    }))
    .sort((a, b) => a.port - b.port);
  const liveCount = ports.filter((p) => p.live).length;
  return {
    id: "ports",
    status: ports.length === 0 ? "yellow" : "green",
    detail:
      ports.length === 0
        ? "no ports recorded"
        : `${liveCount}/${ports.length} recorded ports live`,
    ports,
  };
}

export async function collectPorts(registryPath, { isAlive = pidAlive } = {}) {
  let raw;
  try {
    raw = await readFile(registryPath, "utf8");
  } catch {
    return {
      id: "ports",
      status: "yellow",
      detail: "no port registry found",
      ports: [],
    };
  }
  try {
    return parsePortRegistry(JSON.parse(raw), isAlive);
  } catch (e) {
    return {
      id: "ports",
      status: "red",
      detail: "port registry not valid JSON",
      error: e.message,
      ports: [],
    };
  }
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemPorts.test.mjs`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/server/ecosystem/collectPorts.mjs test/ecosystemPorts.test.mjs
git commit -m "feat(ecosystem): add port collector with liveness probe"
```

---

## Task 4: Repo collector (git parsers + thin collector)

**Files:**

- Create: `src/server/ecosystem/collectRepos.mjs`
- Test: `test/ecosystemRepos.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLastCommit,
  parseWorktrees,
  isDirty,
} from "../src/server/ecosystem/collectRepos.mjs";

test("parseLastCommit splits hash|iso|subject (subject may contain pipes)", () => {
  const c = parseLastCommit(
    "abc1234|2026-05-30T10:00:00-05:00|feat: add a|b thing",
  );
  assert.equal(c.hash, "abc1234");
  assert.equal(c.committedAt, "2026-05-30T10:00:00-05:00");
  assert.equal(c.subject, "feat: add a|b thing");
});

test("parseLastCommit returns null for empty input", () => {
  assert.equal(parseLastCommit("  "), null);
});

test("parseWorktrees reads porcelain blocks", () => {
  const porcelain = [
    "worktree C:/GitHub/archon-setup",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree C:/GitHub/archon-setup-ecosystem",
    "HEAD def456",
    "branch refs/heads/agent/claude/1-ecosystem-dashboard",
    "",
  ].join("\n");
  const wt = parseWorktrees(porcelain);
  assert.equal(wt.length, 2);
  assert.equal(wt[1].branch, "agent/claude/1-ecosystem-dashboard");
});

test("isDirty true only when porcelain has content", () => {
  assert.equal(isDirty(""), false);
  assert.equal(isDirty(" M src/x.mjs\n"), true);
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemRepos.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/collectRepos.mjs
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../lib/commandRunner.mjs";

export function parseLastCommit(raw) {
  const line = (raw || "").trim();
  if (!line) return null;
  const [hash, committedAt, ...rest] = line.split("|");
  return { hash, committedAt, subject: rest.join("|") };
}

export function parseWorktrees(porcelain) {
  const blocks = (porcelain || "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.map((block) => {
    const path = /^worktree (.+)$/m.exec(block)?.[1] ?? null;
    const branchRef = /^branch (.+)$/m.exec(block)?.[1] ?? null;
    const branch = branchRef ? branchRef.replace(/^refs\/heads\//, "") : null;
    return { path, branch };
  });
}

export function isDirty(porcelain) {
  return (porcelain || "").trim().length > 0;
}

async function git(repoPath, args) {
  const { code, stdout } = await runCommand("git", ["-C", repoPath, ...args], {
    timeoutMs: 15_000,
  });
  return code === 0 ? stdout : "";
}

async function collectOneRepo(name, repoPath) {
  const [logOut, statusOut, branchOut, wtOut] = await Promise.all([
    git(repoPath, ["log", "-1", "--format=%h|%cI|%s"]),
    git(repoPath, ["status", "--porcelain"]),
    git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(repoPath, ["worktree", "list", "--porcelain"]),
  ]);
  return {
    name,
    path: repoPath,
    branch: branchOut.trim() || null,
    dirty: isDirty(statusOut),
    lastCommit: parseLastCommit(logOut),
    worktrees: parseWorktrees(wtOut),
  };
}

// Enumerates first-level git repos under githubRoot and collects health for each.
export async function collectRepos(githubRoot) {
  let entries;
  try {
    entries = await readdir(githubRoot, { withFileTypes: true });
  } catch {
    return {
      id: "repos",
      status: "yellow",
      detail: `no repo root at ${githubRoot}`,
      repos: [],
    };
  }
  const candidates = entries.filter((e) => e.isDirectory());
  const repos = [];
  for (const e of candidates) {
    const repoPath = join(githubRoot, e.name);
    const head = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
    if (head.trim() === "true")
      repos.push(await collectOneRepo(e.name, repoPath));
  }
  const dirty = repos.filter((r) => r.dirty).length;
  return {
    id: "repos",
    status: repos.length === 0 ? "yellow" : "green",
    detail: `${repos.length} repos, ${dirty} dirty`,
    repos,
  };
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemRepos.test.mjs`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/server/ecosystem/collectRepos.mjs test/ecosystemRepos.test.mjs
git commit -m "feat(ecosystem): add repo health collector with worktree map"
```

---

## Task 5: Amber (tailscale) collector

**Files:**

- Create: `src/server/ecosystem/collectAmber.mjs`
- Test: `test/ecosystemAmber.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTailscaleStatus } from "../src/server/ecosystem/collectAmber.mjs";

const STATUS = {
  Peer: {
    k1: {
      HostName: "amber-wsl",
      Online: false,
      LastSeen: "2026-05-22T00:00:00Z",
    },
    k2: { HostName: "phone", Online: true, LastSeen: "2026-05-30T00:00:00Z" },
  },
};

test("parseTailscaleStatus finds the amber node case-insensitively", () => {
  const r = parseTailscaleStatus(STATUS, /amber/i);
  assert.equal(r.online, false);
  assert.equal(r.lastSeen, "2026-05-22T00:00:00Z");
  assert.equal(r.status, "red");
});

test("parseTailscaleStatus yellow when node not present", () => {
  const r = parseTailscaleStatus({ Peer: {} }, /amber/i);
  assert.equal(r.status, "yellow");
  assert.equal(r.online, false);
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemAmber.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/collectAmber.mjs
import { runCommand } from "../lib/commandRunner.mjs";

export function parseTailscaleStatus(statusJson, nodeRe) {
  const peers = Object.values(statusJson?.Peer ?? {});
  const node = peers.find((p) => nodeRe.test(p.HostName || ""));
  if (!node) {
    return {
      id: "amber",
      status: "yellow",
      detail: "amber node not found in tailnet",
      online: false,
      lastSeen: null,
    };
  }
  const online = Boolean(node.Online);
  return {
    id: "amber",
    status: online ? "green" : "red",
    detail: online
      ? `${node.HostName} online`
      : `${node.HostName} offline (last seen ${node.LastSeen})`,
    online,
    lastSeen: node.LastSeen ?? null,
  };
}

export async function collectAmber(nodeRe = /amber/i) {
  try {
    const { code, stdout } = await runCommand(
      "tailscale",
      ["status", "--json"],
      { timeoutMs: 8_000 },
    );
    if (code !== 0)
      return {
        id: "amber",
        status: "yellow",
        detail: "tailscale status failed",
        online: false,
        lastSeen: null,
      };
    return parseTailscaleStatus(JSON.parse(stdout), nodeRe);
  } catch (e) {
    return {
      id: "amber",
      status: "yellow",
      detail: "tailscale unavailable",
      online: false,
      lastSeen: null,
      error: e.message,
    };
  }
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemAmber.test.mjs`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/server/ecosystem/collectAmber.mjs test/ecosystemAmber.test.mjs
git commit -m "feat(ecosystem): add amber tailscale status collector"
```

---

## Task 6: Signals collector (anomalies.md + noticed.md)

**Files:**

- Create: `src/server/ecosystem/collectSignals.mjs`
- Test: `test/ecosystemSignals.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSignalList } from "../src/server/ecosystem/collectSignals.mjs";

test("parseSignalList counts markdown list/heading items and returns recent N", () => {
  const md =
    "# Anomalies\n\n- [bug] x: one\n- [sec] y: two\n- [bug] z: three\n";
  const r = parseSignalList(md, 2);
  assert.equal(r.count, 3);
  assert.deepEqual(r.recent, ["- [bug] z: three", "- [sec] y: two"]); // most-recent first
});

test("parseSignalList tolerates empty/missing content", () => {
  const r = parseSignalList("", 5);
  assert.equal(r.count, 0);
  assert.deepEqual(r.recent, []);
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemSignals.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/collectSignals.mjs
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Counts "- " bullet items; treats file order as chronological (append-only logs),
// so the most recent items are the last lines.
export function parseSignalList(md, recentN) {
  const items = (md || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
  return { count: items.length, recent: items.slice(-recentN).reverse() };
}

export async function collectSignals(
  anomaliesPath,
  noticedPaths = [],
  { recentN = 5 } = {},
) {
  const read = async (p) => {
    try {
      return await readFile(p, "utf8");
    } catch {
      return "";
    }
  };
  const anomalies = parseSignalList(await read(anomaliesPath), recentN);
  let noticedCount = 0;
  const noticedRecent = [];
  for (const p of noticedPaths) {
    const r = parseSignalList(await read(p), recentN);
    noticedCount += r.count;
    noticedRecent.push(...r.recent);
  }
  return {
    id: "signals",
    status: anomalies.count > 0 ? "yellow" : "green",
    detail: `${anomalies.count} anomalies, ${noticedCount} noticed`,
    anomalies: anomalies.count,
    noticed: noticedCount,
    recent: [...anomalies.recent, ...noticedRecent].slice(0, recentN),
  };
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemSignals.test.mjs`
Expected: PASS (2 tests).

**Step 5: Commit**

```bash
git add src/server/ecosystem/collectSignals.mjs test/ecosystemSignals.test.mjs
git commit -m "feat(ecosystem): add anomalies/noticed signal collector"
```

---

## Task 7: Aggregator (`buildSnapshot`)

**Files:**

- Create: `src/server/ecosystem/snapshot.mjs`
- Test: `test/ecosystemSnapshot.test.mjs`

**Step 1: Write the failing test** (injects fake collectors — no I/O)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSnapshot } from "../src/server/ecosystem/snapshot.mjs";

test("assembleSnapshot builds summary and merges payloads", () => {
  const snap = assembleSnapshot(
    {
      ports: {
        id: "ports",
        status: "green",
        detail: "",
        ports: [{ port: 5174 }],
      },
      repos: {
        id: "repos",
        status: "green",
        detail: "",
        repos: [{ name: "x" }],
      },
      amber: {
        id: "amber",
        status: "red",
        detail: "",
        online: false,
        lastSeen: "z",
      },
      signals: {
        id: "signals",
        status: "yellow",
        detail: "",
        anomalies: 1,
        noticed: 0,
        recent: [],
      },
    },
    "2026-05-30T20:00:00.000Z",
  );
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.generatedAt, "2026-05-30T20:00:00.000Z");
  assert.deepEqual(snap.summary, { green: 2, yellow: 1, red: 1 });
  assert.equal(snap.ports[0].port, 5174);
  assert.equal(snap.amber.online, false);
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemSnapshot.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// src/server/ecosystem/snapshot.mjs
import { collectPorts } from "./collectPorts.mjs";
import { collectRepos } from "./collectRepos.mjs";
import { collectAmber } from "./collectAmber.mjs";
import { collectSignals } from "./collectSignals.mjs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

// Pure: combine four collector results into the schemaVersion-1 snapshot object.
export function assembleSnapshot(
  { ports, repos, amber, signals },
  generatedAt,
) {
  const checks = [ports, repos, amber, signals];
  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0 },
  );
  return {
    schemaVersion: 1,
    generatedAt,
    summary,
    ports: ports.ports ?? [],
    repos: repos.repos ?? [],
    amber,
    signals,
  };
}

// Thin I/O wrapper: runs all collectors in parallel and assembles.
export async function buildSnapshot({
  portRegistryPath,
  githubRoot,
  amberNode,
  anomaliesPath,
}) {
  // noticed.md lives at <repo>/.claude/noticed.md for each repo under githubRoot
  let noticedPaths = [];
  try {
    const entries = await readdir(githubRoot, { withFileTypes: true });
    noticedPaths = entries
      .filter((e) => e.isDirectory())
      .map((e) => join(githubRoot, e.name, ".claude", "noticed.md"));
  } catch {
    /* no root */
  }

  const [ports, repos, amber, signals] = await Promise.all([
    collectPorts(portRegistryPath),
    collectRepos(githubRoot),
    collectAmber(amberNode),
    collectSignals(anomaliesPath, noticedPaths),
  ]);
  return assembleSnapshot(
    { ports, repos, amber, signals },
    new Date().toISOString(),
  );
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemSnapshot.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/ecosystem/snapshot.mjs test/ecosystemSnapshot.test.mjs
git commit -m "feat(ecosystem): add snapshot aggregator"
```

---

## Task 8: HTML renderer (self-contained glance view)

**Files:**

- Create: `src/server/ecosystem/renderHtml.mjs`
- Test: `test/ecosystemRenderHtml.test.mjs`

**Step 1: Write the failing test**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml } from "../src/server/ecosystem/renderHtml.mjs";

const SNAP = {
  schemaVersion: 1,
  generatedAt: "2026-05-30T20:00:00.000Z",
  summary: { green: 2, yellow: 1, red: 1 },
  ports: [{ port: 5174, command: "vite", live: true, recordedAt: "t" }],
  repos: [
    { name: "archon-setup", branch: "main", dirty: false, worktrees: [] },
  ],
  amber: { online: false, detail: "offline" },
  signals: { anomalies: 1, noticed: 0, recent: ["- [bug] x"] },
};

test("renderHtml emits a self-contained document with the key facts", () => {
  const html = renderHtml(SNAP);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /5174/);
  assert.match(html, /archon-setup/);
  assert.match(html, /offline/i);
  assert.doesNotMatch(html, /<script src=/); // self-contained, no external scripts
});
```

**Step 2: Run to verify it fails**

Run: `node --test test/ecosystemRenderHtml.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement** (minimal, inline CSS; Phase 3 aligns it with the `html-output` design tokens)

```javascript
// src/server/ecosystem/renderHtml.mjs
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const dot = (ok) => `<span class="dot ${ok ? "g" : "r"}"></span>`;

export function renderHtml(snap) {
  const ports = snap.ports
    .map(
      (p) =>
        `<li>${dot(p.live)} <a href="http://127.0.0.1:${p.port}">:${p.port}</a> <code>${esc(p.command)}</code> <small>${esc(p.recordedAt)}</small></li>`,
    )
    .join("");
  const repos = snap.repos
    .map(
      (r) =>
        `<li>${dot(!r.dirty)} <b>${esc(r.name)}</b> @${esc(r.branch)}${r.dirty ? " (dirty)" : ""}${r.worktrees.length > 1 ? ` · ${r.worktrees.length} worktrees` : ""}</li>`,
    )
    .join("");
  const recent = (snap.signals.recent || [])
    .map((s) => `<li>${esc(s)}</li>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>AI Ecosystem</title><style>
  body{font:14px/1.5 system-ui,sans-serif;background:#0b0e14;color:#d6deeb;margin:0;padding:24px;max-width:1100px}
  h1{font-size:18px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#7c8aa5;margin:24px 0 8px}
  ul{list-style:none;padding:0;margin:0}li{padding:4px 0;border-bottom:1px solid #1b2230}
  code{color:#c3e88d}a{color:#82aaff}small{color:#5c6b85}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%}.g{background:#22c55e}.r{background:#ef4444}
  .meta{color:#5c6b85}
</style></head><body>
<h1>AI Ecosystem <span class="meta">— generated ${esc(snap.generatedAt)}</span></h1>
<p class="meta">Amber: ${dot(snap.amber.online)} ${esc(snap.amber.detail)} · signals: ${snap.signals.anomalies} anomalies, ${snap.signals.noticed} noticed</p>
<h2>Ports (timestamped, not authoritative)</h2><ul>${ports || "<li>none</li>"}</ul>
<h2>Repos</h2><ul>${repos || "<li>none</li>"}</ul>
<h2>Recent signals</h2><ul>${recent || "<li>none</li>"}</ul>
</body></html>`;
}
```

**Step 4: Run to verify it passes**

Run: `node --test test/ecosystemRenderHtml.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/server/ecosystem/renderHtml.mjs test/ecosystemRenderHtml.test.mjs
git commit -m "feat(ecosystem): add self-contained html renderer"
```

---

## Task 9: CLI entry (`bin/ecosystem-snapshot.mjs`) — redact → write atomically

**Files:**

- Create: `bin/ecosystem-snapshot.mjs`
- Modify: `package.json:9-14` (add `"snapshot"` script)

**Step 1: Implement the CLI** (no unit test — it's the I/O composition; covered by the Task 10 live run)

```javascript
#!/usr/bin/env node
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { buildSnapshot } from "../src/server/ecosystem/snapshot.mjs";
import { redactDeep } from "../src/server/ecosystem/redact.mjs";
import { renderHtml } from "../src/server/ecosystem/renderHtml.mjs";
import { writeAtomic } from "../src/server/ecosystem/writeAtomic.mjs";

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const home = homedir();
const outDir = resolve(flag("out-dir", join(home, ".claude")));
const githubRoot = resolve(flag("github-root", "C:\\GitHub"));
const portRegistryPath = resolve(
  flag("port-registry", join(home, ".claude", "port-registry.json")),
);
const anomaliesPath = resolve(
  flag("anomalies", join(home, ".claude", "anomalies.md")),
);
const amberNode = new RegExp(flag("amber-node", "amber"), "i");

const snap = await buildSnapshot({
  portRegistryPath,
  githubRoot,
  amberNode,
  anomaliesPath,
});
const safe = redactDeep(snap); // SECRETS NEVER TOUCH DISK — redact before any write

await writeAtomic(
  join(outDir, "ecosystem-state.json"),
  JSON.stringify(safe, null, 2),
);
await writeAtomic(join(outDir, "ecosystem.html"), renderHtml(safe));

console.log(`ecosystem snapshot written to ${outDir}`);
console.log(
  `  ports: ${safe.ports.length} · repos: ${safe.repos.length} · amber: ${safe.amber.online ? "online" : "offline"} · summary: ${JSON.stringify(safe.summary)}`,
);
```

**Step 2: Add the npm script** — in `package.json` scripts block:

```json
"snapshot": "node bin/ecosystem-snapshot.mjs",
```

**Step 3: Commit**

```bash
git add bin/ecosystem-snapshot.mjs package.json
git commit -m "feat(ecosystem): add snapshot CLI entry with redaction + atomic write"
```

---

## Task 10: Live verification (real run against the machine)

**Step 1:** Full suite green.

Run: `npm test`
Expected: PASS — all `ecosystem*` tests plus the pre-existing suite. Record output for the PR.

**Step 2:** Real snapshot against the live machine.

Run: `npm run snapshot`
Expected: console prints port/repo/amber counts; `C:\Users\josep\.claude\ecosystem-state.json` and `ecosystem.html` exist.

**Step 3:** Adversarial redaction check — confirm no secret leaked.

Run: `node -e "const s=require('fs').readFileSync(process.env.USERPROFILE+'/.claude/ecosystem-state.json','utf8'); if(/ghp_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}|Bearer [A-Za-z0-9]/.test(s)){console.error('LEAK');process.exit(1)} console.log('clean')"`
Expected: `clean`.

**Step 4:** Eyeball the glance view.

Run: `start C:\Users\josep\.claude\ecosystem.html`
Expected: ports list shows live/dead dots (the ghost `7881`-style entries dead, current ports live), repos with branches/worktrees, Amber offline indicator. Confirm the "is 5174 mine?" question is now answerable at a glance.

**Step 5:** Adversarial re-run (idempotence).

Run: `npm run snapshot` (again)
Expected: succeeds, overwrites cleanly, no `.tmp` left behind.

---

## Task 11: Document the contract + wire regeneration

**Files:**

- Create: `docs/ECOSYSTEM_STATE.md` (the schema above + "agents may read `~/.claude/ecosystem-state.json`")
- Note in PR: regeneration is wired **outside this repo** as a `~/.claude` SessionStart hook or a Windows Task Scheduler entry calling `npm --prefix C:\GitHub\archon-setup run snapshot`. Do not bind it inside archon-setup (keeps the product portable).

**Commit:**

```bash
git add docs/ECOSYSTEM_STATE.md
git commit -m "docs(ecosystem): document ecosystem-state.json contract"
```

---

## Task 12: PR

- Push the branch; open a PR with `## Verification` + `### Verification Notes` (paste the `npm test` output and the Task 10 real-run output), at least one `- [x]`, and `Closes #<issue>`.
- Do **not** merge to `main` directly — let review + branch protection gate it.

---

## Out of scope for Phase 1 (future phases — do NOT build now)

- **Phase 2 — agent read path:** `ecosystem.snapshot` read-only RPC method in `src/server/rpc.mjs` (GET, not in `STATE_CHANGING`) so the live server can serve the snapshot; optional tiny MCP wrapper exposing `get_port_owner(port)`.
- **Phase 2 — config drift:** a collector that checks `CLAUDE.md` / `GEMINI.md` are faithful **pointers** to `AGENTS.md` (per archon's own doctrine), flagging independent-policy drift — not a 3-way diff.
- **Phase 3 — live UI screen:** an "Ecosystem" page in `src/ui/app.mjs`, styled with the `html-output` design tokens; auto-refresh.
- **Phase 3 — gated editing:** in-app config edit behind diff-preview + atomic write + never-on-main + active-session check. Highest-risk; needs its own plan.
- **Amber:** renew the Tailscale key (verify the expiry date first) and fix `tailscaled` autostart in WSL so the dashboard's Amber light can ever go green. Migration decision deferred until the dashboard shows ~2 weeks of Amber uptime.
