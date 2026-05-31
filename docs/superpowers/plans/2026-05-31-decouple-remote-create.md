# Decouple Remote Features from Repo-Create — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `workflow.*` / `agent-workflow.anomaly-triage` / `remote.labels` / `remote.branch-protection` install against a GitHub repo that already exists (or none) without forcing `gh repo create`.

**Architecture:** Introduce a resolved `githubRepoTarget` (explicit `--owner/--repo` > detected origin > `will-create` when `remote.github` selected > none) and a per-feature `remoteRequirement` enum (`runtime` vs `api-target`). `buildPlan` applies the target, gates features by requirement (runtime→warn, api-target→error when no target), and stamps a single `blocking` boolean on each diagnostic that both the CLI and wizard consume. `taskPhase` stays the only execution-ordering authority.

**Tech Stack:** Node 20+ ESM, `node:test`, no external deps. Tests run with `npm test` (`node --test "test/*.test.mjs"`).

**Spec:** `C:\github\archon-setup\.claude\worktrees\agent+claude+48-decouple-remote-create\docs\superpowers\specs\2026-05-31-existing-repo-workflows-decouple-design.md`

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/server/lib/parseGithubRemote.mjs` | Create | Pure: parse a remote URL → `{owner, repo}` for github.com, else `null` |
| `src/server/preflight/checkOriginRemote.mjs` | Create | Read target's `origin` remote → detected `{owner, repo}` or null; never throws |
| `src/server/planner/repoTarget.mjs` | Create | Pure `resolveRepoTarget()` + `applyResolvedRepoTarget()` + `isBlockingWarning()` |
| `src/server/planner/buildPlan.mjs` | Modify | Apply target; `remoteRequirement` gate; severity+blocking diagnostics; dedupe runtime; CI trigger |
| `src/registry/features.json` | Modify | Add `remoteRequirement`; drop `requires: remote.github`; adjust `capabilitiesNeeded` on 4 groups |
| `src/registry/schema.json` | Modify | Document `remoteRequirement` enum |
| `src/server/onboard/headlessOnboard.mjs` | Modify | `defaultLocalSelection` by `remoteRequirement`; origin detect; validate `--owner/--repo`; re-export `isBlockingWarning` |
| `src/server/preflight/index.mjs` | Modify | Run `checkOriginRemote`; return `originDetected` |
| `src/server/rpc.mjs` | Modify | `preflight.run` passes `originDetected` through |
| `src/ui/app.mjs` | Modify | Carry `originDetected` into `plan.build`; `renderReview` gates on `w.blocking` |
| `test/parseGithubRemote.test.mjs` | Create | Unit tests for the parser |
| `test/checkOriginRemote.test.mjs` | Create | Unit tests for origin detection |
| `test/repoTarget.test.mjs` | Create | Unit tests for resolver + blocking classifier |
| `test/registry.test.mjs` | Modify | Migrate assertions to the new contract |
| `test/onboardHeadless.test.mjs` | Modify | Migrate `isBlockingWarning`/blocking tests; add existing-repo case |

---

## Task 1: `parseGithubRemote` (pure URL parser)

**Files:**
- Create: `src/server/lib/parseGithubRemote.mjs`
- Test: `test/parseGithubRemote.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/parseGithubRemote.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubRemote } from "../src/server/lib/parseGithubRemote.mjs";

test("parses https with and without .git and trailing slash", () => {
  assert.deepEqual(parseGithubRemote("https://github.com/owner/repo"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("https://github.com/owner/repo/"), { owner: "owner", repo: "repo" });
});

test("parses scp-style and ssh:// forms", () => {
  assert.deepEqual(parseGithubRemote("git@github.com:owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("ssh://git@github.com/owner/repo"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("ssh://git@github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
});

test("rejects non-repo URLs, non-github hosts, and junk", () => {
  assert.equal(parseGithubRemote("https://github.com/owner/repo/issues"), null);
  assert.equal(parseGithubRemote("https://github.com/owner"), null);
  assert.equal(parseGithubRemote("https://gitlab.com/owner/repo.git"), null);
  assert.equal(parseGithubRemote("git@example.com:owner/repo.git"), null);
  assert.equal(parseGithubRemote(""), null);
  assert.equal(parseGithubRemote(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/parseGithubRemote.test.mjs"`
Expected: FAIL — `Cannot find module '../src/server/lib/parseGithubRemote.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// src/server/lib/parseGithubRemote.mjs
// Parses a git remote URL into { owner, repo } for github.com ONLY.
// Returns null for anything else (other hosts, extra path segments, junk).
// MVP scope: github.com. GitHub Enterprise hosts are future work.
const PATTERNS = [
  // https://github.com/owner/repo(.git)(/)
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  // ssh://git@github.com/owner/repo(.git)
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  // git@github.com:owner/repo.git  (scp-style)
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
];

export function parseGithubRemote(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  for (const re of PATTERNS) {
    const m = trimmed.match(re);
    if (m) return { owner: m[1], repo: m[2] };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/parseGithubRemote.test.mjs"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/parseGithubRemote.mjs test/parseGithubRemote.test.mjs
git commit -m "feat(remote): parse github.com remote URLs to owner/repo (#48)"
```

---

## Task 2: `checkOriginRemote` (origin detection, never throws)

**Files:**
- Create: `src/server/preflight/checkOriginRemote.mjs`
- Test: `test/checkOriginRemote.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/checkOriginRemote.test.mjs
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkOriginRemote } from "../src/server/preflight/checkOriginRemote.mjs";

const execFileP = promisify(execFile);
const tmp = (p = "archon-origin-") => mkdtemp(join(tmpdir(), p));

test("non-git directory -> { originDetected: null }, no throw", async () => {
  const root = await tmp();
  assert.deepEqual(await checkOriginRemote(root), { originDetected: null });
});

test("git repo with no origin -> null, no throw", async () => {
  const root = await tmp();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  assert.deepEqual(await checkOriginRemote(root), { originDetected: null });
});

test("git repo with a github origin -> detected owner/repo", async () => {
  const root = await tmp();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "remote", "add", "origin", "git@github.com:ArchonVII/example.git"]);
  assert.deepEqual(await checkOriginRemote(root), { originDetected: { owner: "ArchonVII", repo: "example" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/checkOriginRemote.test.mjs"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/server/preflight/checkOriginRemote.mjs
import { runCommand } from "../lib/commandRunner.mjs";
import { parseGithubRemote } from "../lib/parseGithubRemote.mjs";

// Detects an existing GitHub `origin` remote in the target dir.
// Pure detection of repository STATE — not a capability, not a red/green check.
// Degrades to { originDetected: null } on any failure (no git, no repo, no origin).
export async function checkOriginRemote(target) {
  if (!target) return { originDetected: null };
  try {
    const res = await runCommand("git", ["-C", target, "remote", "get-url", "origin"], { timeoutMs: 10_000 });
    if (res.code !== 0) return { originDetected: null };
    return { originDetected: parseGithubRemote(res.stdout.trim()) };
  } catch {
    return { originDetected: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/checkOriginRemote.test.mjs"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/preflight/checkOriginRemote.mjs test/checkOriginRemote.test.mjs
git commit -m "feat(preflight): detect existing github origin remote (#48)"
```

---

## Task 3: `resolveRepoTarget` + `applyResolvedRepoTarget` + `isBlockingWarning`

**Files:**
- Create: `src/server/planner/repoTarget.mjs`
- Test: `test/repoTarget.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/repoTarget.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "test/repoTarget.test.mjs"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// src/server/planner/repoTarget.mjs
// Pure repo-target resolution. See spec §1.
// Precedence: explicit owner/repo > detected github origin > will-create
// (only when remote.github selected) > none.
export function resolveRepoTarget({ explicit, originDetected, selection = [] } = {}) {
  if (explicit && explicit.owner && explicit.repo) {
    return { status: "known", source: "explicit", owner: explicit.owner, repo: explicit.repo };
  }
  if (originDetected && originDetected.owner && originDetected.repo) {
    return { status: "known", source: "origin", owner: originDetected.owner, repo: originDetected.repo };
  }
  if (selection.includes("remote.github")) {
    return { status: "will-create", source: "remote.github" };
  }
  return { status: "none" };
}

// Returns a NEW context with the resolved target applied. Never mutates input.
// For "known", owner/repo become the single source of truth downstream tasks read.
export function applyResolvedRepoTarget(context, target) {
  if (target.status === "known") {
    return { ...context, owner: target.owner, repo: target.repo, githubRepoTarget: target };
  }
  return { ...context, githubRepoTarget: target };
}

// Single source of truth for whether a diagnostic blocks Execute.
// Both runOnboard (CLI) and renderReview (wizard) consume buildPlan's stamped
// `blocking`, which is computed from this.
export function isBlockingWarning(w) {
  return (
    w.severity === "error" ||
    w.feature === "workflows.ci" || // legacy: missing/duplicate language-CI choice
    /conflicts with/.test(w.message) // legacy: feature conflicts
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/repoTarget.test.mjs"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/planner/repoTarget.mjs test/repoTarget.test.mjs
git commit -m "feat(planner): resolveRepoTarget + blocking classifier (#48)"
```

---

## Task 4: Registry change + schema + migrate registry tests

This task changes the contract, so existing `registry.test.mjs` assertions that
encode the OLD coupling are updated first (they will fail), then `features.json`
is changed to satisfy the new contract.

**Files:**
- Modify: `test/registry.test.mjs`
- Modify: `src/registry/features.json`
- Modify: `src/registry/schema.json`

- [ ] **Step 1: Update the existing registry tests to the new contract**

In `test/registry.test.mjs`, apply each edit below.

(a) Replace the "closes over required features transitively" test (it asserted `workflow.pr-policy` pulls in `remote.github`):

```js
test("plan.build closes over feature-id requires transitively", async () => {
  // required-gate requires the check-map feature (a real feature-id dependency)
  const plan = await buildPlan({
    selection: ["workflow.required-gate"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  assert.ok(plan.selectedFeatureIds.includes("agent-workflow.check-map"));
  assert.ok(!plan.selectedFeatureIds.includes("remote.github"), "must NOT pull in repo-create");
});
```

(b) Replace the "anomaly-triage ... depends on remote.github" test:

```js
test("agent-workflow.anomaly-triage is a runtime feature, not coupled to repo-create", async () => {
  const { features, groups } = await loadRegistry();
  const triage = features.find((f) => f.id === "agent-workflow.anomaly-triage");
  assert.ok(triage, "anomaly-triage feature missing");
  assert.equal(triage.group, "agent-workflow");
  assert.equal(triage.remoteRequirement, "runtime");
  assert.ok(!(triage.requires || []).includes("remote.github"));
  assert.ok(triage.creates.includes(".github/workflows/anomaly-triage.yml"));
  const group = groups.find((g) => g.id === "agent-workflow");
  assert.ok(group, "agent-workflow group missing from groups.json");
});
```

(c) Replace the "planning anomaly-triage pulls in remote.github transitively" test:

```js
test("planning anomaly-triage plans the workflow without repo-create", async () => {
  const plan = await buildPlan({
    selection: ["agent-workflow.anomaly-triage"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(!plan.selectedFeatureIds.includes("remote.github"));
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  assert.ok(
    plan.files.some((f) => f.path === ".github/workflows/anomaly-triage.yml"),
    "anomaly-triage workflow should be planned for creation"
  );
});
```

(d) In "workflows.ci group ... contains node/python/minimal CI features", replace the line `assert.ok(f.requires.includes("remote.github"));` with:

```js
    assert.equal(f.remoteRequirement, "runtime");
    assert.ok(!(f.requires || []).includes("remote.github"));
```

(e) In "planner does not warn about CI when a language-CI feature is selected", delete this line:

```js
  assert.ok(plan.selectedFeatureIds.includes("remote.github"), "transitive remote.github");
```

(f) In "required-gate feature is the default CI contract", replace `assert.ok(gate.requires.includes("remote.github"));` with:

```js
  assert.equal(gate.remoteRequirement, "runtime");
  assert.ok(gate.requires.includes("agent-workflow.check-map"));
  assert.ok(!gate.requires.includes("remote.github"));
```

(g) In "planning the required gate also plans the check map and avoids legacy CI warning", replace `assert.ok(plan.selectedFeatureIds.includes("remote.github"));` with:

```js
  assert.ok(!plan.selectedFeatureIds.includes("remote.github"), "required gate alone does not create a repo");
```

**Local-baseline filter migration.** Removing `requires: remote.github` means the
"local baseline" can no longer be defined as "default features that don't require
remote.github" — those features (e.g. `remote.labels`) would now leak into the
baseline. Redefine it as "default features with no `remoteRequirement`". Update
every place that computes it, so the full suite stays green:

(h) In `test/foundationParity.test.mjs`, replace:

```js
    .filter((feature) => feature.default && !(feature.requires || []).includes("remote.github"))
```

with:

```js
    .filter((feature) => feature.default && !feature.remoteRequirement)
```

(i) In `test/manifestAccuracy.test.mjs`, replace:

```js
    .filter((feature) => feature.default && !(feature.requires || []).includes("remote.github"))
```

with:

```js
    .filter((feature) => feature.default && !feature.remoteRequirement)
```

(j) In `test/onboardHeadless.test.mjs`, replace the entire "defaultLocalSelection is every default feature that needs no remote" test with:

```js
test("defaultLocalSelection is every default feature with no remoteRequirement", async () => {
  const { features } = await loadRegistry();
  const expected = features.filter((f) => f.default && !f.remoteRequirement).map((f) => f.id);
  assert.deepEqual(defaultLocalSelection(features), expected);
  assert.ok(expected.includes("foundation.hooks"));
  assert.ok(!expected.includes("remote.labels"), "api-target features are not in the local baseline");
  assert.ok(!expected.includes("workflow.required-gate"), "runtime features are not in the local baseline");
});
```

- [ ] **Step 2: Run the registry tests to verify they now fail**

Run: `node --test "test/registry.test.mjs"`
Expected: FAIL — features still have `requires: ["remote.github"]` and lack `remoteRequirement`.

- [ ] **Step 3: Edit `src/registry/features.json`**

For each of the feature objects below, make exactly these field changes (leave all other fields untouched):

- `remote.labels`: remove `"requires": ["remote.github"]`; add `"remoteRequirement": "api-target"` and `"capabilitiesNeeded": ["gh.authenticated"]`.
- `remote.branch-protection`: remove `"requires": ["remote.github"]`; add `"remoteRequirement": "api-target"`. Keep its existing `"capabilitiesNeeded": ["gh.branchProtectionAllowed"]`.
- `agent-workflow.anomaly-triage`: change `"requires": ["remote.github"]` to `"requires": []` (or remove the key); add `"remoteRequirement": "runtime"`.
- `workflow.pr-policy`, `workflow.semantic-pr-title`, `workflow.pr-body-autoinject`, `workflow.branch-naming`, `workflow.node-ci`, `workflow.python-ci`, `workflow.minimal-ci`: remove `"requires": ["remote.github"]`; add `"remoteRequirement": "runtime"`.
- `workflow.required-gate`: change `"requires": ["remote.github", "agent-workflow.check-map"]` to `"requires": ["agent-workflow.check-map"]`; add `"remoteRequirement": "runtime"`.

Leave `remote.github` itself unchanged.

- [ ] **Step 3b: Update `defaultLocalSelection` to filter by `remoteRequirement`**

In `src/server/onboard/headlessOnboard.mjs`, replace:

```js
export function defaultLocalSelection(features) {
  return features
    .filter((f) => f.default && !(f.requires || []).includes("remote.github"))
    .map((f) => f.id);
}
```

with:

```js
export function defaultLocalSelection(features) {
  return features.filter((f) => f.default && !f.remoteRequirement).map((f) => f.id);
}
```

This keeps the headless local baseline identical to before (foundations +
check-map): api-target and runtime features are excluded because they now carry a
`remoteRequirement`.

- [ ] **Step 4: Document the field in `src/registry/schema.json`**

Add this property inside `properties` (after `capabilitiesNeeded`):

```json
    "remoteRequirement": {
      "type": "string",
      "enum": ["runtime", "api-target"],
      "description": "How the feature depends on a GitHub repo: 'runtime' writes a local caller that runs once on GitHub (no auth); 'api-target' mutates a live repo via the API (needs auth + a resolved target). Absent = local-only."
    },
```

- [ ] **Step 5: Run the FULL suite to verify green**

Run: `npm test`
Expected: PASS, 0 fail. The registry assertions now match; the filter migration
(h/i/j/3b) keeps the headless + foundation-parity + manifest-accuracy tests green
because the local baseline is unchanged.

Note: the "every feature.requires points at a real feature id" test still passes
because the remaining `requires` entries (e.g. `agent-workflow.check-map`,
`foundation.git-init`) are real feature ids. `buildPlan` is NOT modified in this
task — the new `remoteRequirement` field is simply ignored by it for now (the
gate arrives in Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/registry/features.json src/registry/schema.json src/server/onboard/headlessOnboard.mjs test/registry.test.mjs test/foundationParity.test.mjs test/manifestAccuracy.test.mjs test/onboardHeadless.test.mjs
git commit -m "feat(registry): remoteRequirement enum; drop repo-create coupling (#48)"
```

---

## Task 5: `buildPlan` — apply target, requirement gate, blocking stamp

**Files:**
- Modify: `src/server/planner/buildPlan.mjs`
- Test: `test/registry.test.mjs` (add new planner tests)

- [ ] **Step 1: Write the failing planner tests**

Append to `test/registry.test.mjs`:

```js
// --- #48: remoteRequirement gate + repo target ---

test("workflow alone: installs locally, no repo-create, non-blocking runtime warning", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(plan.ordered.some((u) => u.taskId === "installWorkflow"));
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  const runtimeWarn = plan.warnings.filter((w) => w.feature === "remote.runtime");
  assert.equal(runtimeWarn.length, 1, "exactly one deduped runtime warning");
  assert.equal(runtimeWarn[0].severity, "warn");
  assert.equal(runtimeWarn[0].blocking, false);
});

test("workflow needs no gh.authenticated (no blocking auth warning)", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(!plan.warnings.some((w) => w.blocking && /capability/.test(w.message)));
});

test("multiple runtime features with no target -> one deduped runtime warning", async () => {
  const plan = await buildPlan({
    selection: ["workflow.pr-policy", "workflow.branch-naming", "agent-workflow.anomaly-triage"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.equal(plan.warnings.filter((w) => w.feature === "remote.runtime").length, 1);
});

test("api-target with no target and no remote.github -> blocking error", async () => {
  const plan = await buildPlan({
    selection: ["remote.labels"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  const err = plan.warnings.find((w) => w.feature === "remote.labels" && w.severity === "error");
  assert.ok(err, "expected blocking error diagnostic");
  assert.equal(err.blocking, true);
  assert.ok(!plan.warnings.some((w) => w.feature === "remote.runtime"), "no misleading runtime warning");
});

test("api-target with detected origin -> known target, no repo-create", async () => {
  const plan = await buildPlan({
    selection: ["remote.labels"],
    options: {},
    context: {
      targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {},
      originDetected: { owner: "ArchonVII", repo: "example" },
    },
  });
  assert.ok(!plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  assert.equal(plan.context.owner, "ArchonVII");
  assert.equal(plan.context.repo, "example");
  assert.equal(plan.context.githubRepoTarget.status, "known");
  assert.ok(!plan.warnings.some((w) => w.feature === "remote.labels" && w.severity === "error"));
});

test("remote.github + remote.labels: create present, labels phase-ordered after", async () => {
  const plan = await buildPlan({
    selection: ["remote.github", "remote.labels", "foundation.git-init"],
    options: {},
    context: { targetPath: "X", owner: "o", repo: "r", visibility: "private", capabilities: {} },
  });
  const tasks = plan.ordered.map((u) => u.taskId);
  assert.ok(tasks.includes("ghRepoCreateAndPush"));
  assert.ok(tasks.indexOf("applyLabels") > tasks.indexOf("ghRepoCreateAndPush"));
});

test("api-target + will-create with empty identity -> blocking error", async () => {
  const plan = await buildPlan({
    selection: ["remote.github", "remote.labels", "foundation.git-init"],
    options: {},
    context: { targetPath: "X", owner: "", repo: "", visibility: "private", capabilities: {} },
  });
  assert.ok(plan.warnings.some((w) => w.feature === "remote.labels" && w.severity === "error"));
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test "test/registry.test.mjs"`
Expected: FAIL — `remote.runtime` warnings/`blocking`/`githubRepoTarget` not produced yet.

- [ ] **Step 3: Edit `src/server/planner/buildPlan.mjs`**

3a. Add the import at the top (after the existing imports):

```js
import { resolveRepoTarget, applyResolvedRepoTarget, isBlockingWarning } from "./repoTarget.mjs";
```

3b. Replace the plan-initialization block. Find:

```js
  const plan = {
    context: { ...context },
    selectedFeatureIds: resolved.map((f) => f.id),
```

Replace with (resolve the target from the closed-over selection, then apply it):

```js
  const explicit = context.owner && context.repo ? { owner: context.owner, repo: context.repo } : null;
  const resolvedTarget = resolveRepoTarget({
    explicit,
    originDetected: context.originDetected || null,
    selection: resolved.map((f) => f.id),
  });
  const planContext = applyResolvedRepoTarget(context, resolvedTarget);

  const plan = {
    context: { ...planContext },
    selectedFeatureIds: resolved.map((f) => f.id),
```

3c. Replace the capability-gate loop. Find:

```js
  // Capability gate
  for (const f of resolved) {
    for (const cap of f.capabilitiesNeeded || []) {
      if (!context.capabilities?.[cap]) {
        plan.warnings.push({
          feature: f.id,
          message: `missing capability: ${cap}`,
        });
      }
    }
  }
```

Replace with (keep capability warnings as `severity: "warn"`, add the
remoteRequirement gate, collect runtime features for dedupe):

```js
  // Capability gate (non-blocking warnings)
  for (const f of resolved) {
    for (const cap of f.capabilitiesNeeded || []) {
      if (!planContext.capabilities?.[cap]) {
        plan.warnings.push({ feature: f.id, message: `missing capability: ${cap}`, severity: "warn" });
      }
    }
  }

  // remoteRequirement gate (spec §3). runtime -> warn (deduped); api-target -> error.
  const targetKnown = resolvedTarget.status === "known";
  const willCreate = resolvedTarget.status === "will-create";
  const haveCreateIdentity = Boolean(planContext.owner && planContext.repo);
  let runtimeNeedsTarget = false;
  for (const f of resolved) {
    if (f.remoteRequirement === "runtime") {
      if (!targetKnown && !willCreate) runtimeNeedsTarget = true;
    } else if (f.remoteRequirement === "api-target") {
      if (resolvedTarget.status === "none") {
        plan.warnings.push({
          feature: f.id,
          message: `needs a GitHub repo target — point at an existing repo or select "Create GitHub repo".`,
          severity: "error",
        });
      } else if (willCreate && !haveCreateIdentity) {
        plan.warnings.push({
          feature: f.id,
          message: `cannot run: "Create GitHub repo" is selected but owner/repo are not set.`,
          severity: "error",
        });
      }
    }
  }
  if (runtimeNeedsTarget) {
    plan.warnings.push({
      feature: "remote.runtime",
      message:
        `GitHub workflow files will be installed locally, but they will not run until ` +
        `this directory is pushed to GitHub. To create and push a new GitHub repo now, ` +
        `also select "Create GitHub repo."`,
      severity: "warn",
    });
  }
```

3d. Update the "Required CI" trigger. Find:

```js
  if (resolvedIds.has("remote.github")) {
    const ciSelected = resolved.filter((f) => f.group === "workflows.ci");
```

Replace the `if` condition only:

```js
  const hasRemoteIntent = resolved.some((f) => f.remoteRequirement || f.group === "remote");
  if (resolvedTarget.status !== "none" && hasRemoteIntent) {
    const ciSelected = resolved.filter((f) => f.group === "workflows.ci");
```

(The `hasRemoteIntent` guard is required: a purely local onboard may still have a
`known` target because `owner`/`repo` are set for CODEOWNERS/manifest. Without the
guard, that would wrongly demand a CI choice and block the local baseline. The CI
contract only applies when the user actually selects a remote/runtime/api feature.)

3e. Stamp `blocking` on every diagnostic. Find the final `return plan;` and
insert immediately before it:

```js
  for (const w of plan.warnings) w.blocking = isBlockingWarning(w);

  return plan;
```

3f. So a detected-origin owner reaches CODEOWNERS, use the resolved context in
the codeowners skip check. Find (inside the `for (const c of f.creates...)`
loop):

```js
      if (f.id === "foundation.codeowners" && !codeownersOwner(context)) {
```

Replace with:

```js
      if (f.id === "foundation.codeowners" && !codeownersOwner(planContext)) {
```

This is behavior-preserving when no origin is detected (`planContext.owner`
equals `context.owner`); with a detected origin it lets CODEOWNERS use the
resolved owner.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. (New planner tests pass; migrated tests from Task 4 still pass.)

- [ ] **Step 5: Commit**

```bash
git add src/server/planner/buildPlan.mjs test/registry.test.mjs
git commit -m "feat(planner): apply repo target + remoteRequirement gate + blocking stamp (#48)"
```

---

## Task 6: Headless onboard — origin auto-detect + blocking consistency

**Files:**
- Modify: `src/server/onboard/headlessOnboard.mjs`
- Modify: `test/onboardHeadless.test.mjs`

Note: `defaultLocalSelection` was already migrated to filter by `remoteRequirement`
in Task 4 (step 3b), and its test rewritten there (edit j). This task adds origin
auto-detection + `--owner/--repo` validation, and aligns the CLI's blocking gate
with the `w.blocking` flag `buildPlan` now stamps (Task 5).

- [ ] **Step 1: Write the failing existing-repo test**

Append to `test/onboardHeadless.test.mjs`:

```js
test("onboarding an existing-origin repo installs a workflow without repo-create", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  const root = await tempRoot();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "remote", "add", "origin", "git@github.com:ArchonVII/example.git"]);

  const result = await runOnboard({ targetPath: root, features: ["workflow.pr-policy"], dryRun: true });

  assert.equal(result.ok, true);
  assert.ok(!result.plan.ordered.some((u) => u.taskId === "ghRepoCreateAndPush"));
  assert.ok(result.plan.files.some((f) => f.path === ".github/workflows/pr-policy.yml"));
  assert.equal(result.plan.context.githubRepoTarget.status, "known");
  assert.equal(result.plan.context.owner, "ArchonVII");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "test/onboardHeadless.test.mjs"`
Expected: FAIL — `runOnboard` does not detect origin yet, so `githubRepoTarget.status`
is `"none"` (not `"known"`) and `context.owner` is `""`.

- [ ] **Step 3: Add origin detection + `--owner/--repo` validation in `runOnboard`**

In `src/server/onboard/headlessOnboard.mjs`:

3a. Add the `checkOriginRemote` import. Find:

```js
import { loadRegistry, buildPlan } from "../planner/buildPlan.mjs";
import { executePlan } from "../executor/executePlan.mjs";
```

Replace with:

```js
import { loadRegistry, buildPlan } from "../planner/buildPlan.mjs";
import { executePlan } from "../executor/executePlan.mjs";
import { checkOriginRemote } from "../preflight/checkOriginRemote.mjs";
```

3b. Validate the pair and detect origin. Find:

```js
  const known = new Set(allFeatures.map((f) => f.id));
  const unknown = selection.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`unknown feature(s): ${unknown.join(", ")}`);

  const context = {
    targetPath,
    owner,
    account: owner, // owner doubles as the active account when set headlessly
    repo,
    visibility,
    capabilities,
    sourceSnapshots: await loadSourceSnapshots(),
  };
```

Replace with:

```js
  const known = new Set(allFeatures.map((f) => f.id));
  const unknown = selection.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`unknown feature(s): ${unknown.join(", ")}`);

  if (Boolean(owner) !== Boolean(repo)) {
    throw new Error("--owner and --repo must be provided together (or neither)");
  }

  const { originDetected } = await checkOriginRemote(targetPath);

  const context = {
    targetPath,
    owner,
    account: owner, // owner doubles as the active account when set headlessly
    repo,
    visibility,
    capabilities,
    originDetected,
    sourceSnapshots: await loadSourceSnapshots(),
  };
```

- [ ] **Step 4: Align the CLI blocking gate with the stamped `blocking` flag**

`buildPlan` now stamps `w.blocking` (Task 5), computed by the single classifier
`repoTarget.isBlockingWarning`. The CLI should consume the stamped flag directly,
not re-classify. Remove the local classifier and its now-redundant unit test.

4a. In `src/server/onboard/headlessOnboard.mjs`, delete the local function:

```js
export function isBlockingWarning(w) {
  return w.feature === "workflows.ci" || /conflicts with/.test(w.message);
}
```

4b. In `runOnboard`, change the blocking filter. Find:

```js
  const blockingWarnings = (plan.warnings || []).filter(isBlockingWarning);
```

Replace with:

```js
  const blockingWarnings = (plan.warnings || []).filter((w) => w.blocking);
```

4c. In `test/onboardHeadless.test.mjs`, remove `isBlockingWarning` from the import
list (it is no longer exported here — its classifier logic is tested in
`test/repoTarget.test.mjs`). Change:

```js
import {
  runOnboard,
  defaultLocalSelection,
  isBlockingWarning,
  loadSourceSnapshots,
} from "../src/server/onboard/headlessOnboard.mjs";
```

to:

```js
import {
  runOnboard,
  defaultLocalSelection,
  loadSourceSnapshots,
} from "../src/server/onboard/headlessOnboard.mjs";
```

4d. In `test/onboardHeadless.test.mjs`, delete the entire test named
`"isBlockingWarning mirrors the wizard's Execute gate"` (its behavior is now
covered by `test/repoTarget.test.mjs`).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. The "blocking warnings halt execution and write nothing" test still
passes: selecting `["foundation.readme", "remote.github"]` yields a blocking
`workflows.ci` diagnostic (`blocking: true` after stamping), so `runOnboard`
returns `ok: false` with `blockingWarnings.length > 0` and writes nothing.

- [ ] **Step 6: Commit**

```bash
git add src/server/onboard/headlessOnboard.mjs test/onboardHeadless.test.mjs
git commit -m "feat(onboard): origin auto-detect + stamped-blocking gate (#48)"
```

---

## Task 7: Wizard + RPC wiring (minimal gating — Option A)

**Files:**
- Modify: `src/server/preflight/index.mjs`
- Modify: `src/server/rpc.mjs`
- Modify: `src/ui/app.mjs`

- [ ] **Step 1: Write the failing preflight test**

Append to `test/checkOriginRemote.test.mjs`:

```js
test("runPreflight surfaces originDetected for a github target", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  const { runPreflight } = await import("../src/server/preflight/index.mjs");

  const root = await tmp();
  await execFileP("git", ["-C", root, "init", "-b", "main"]);
  await execFileP("git", ["-C", root, "remote", "add", "origin", "https://github.com/ArchonVII/example.git"]);

  const pre = await runPreflight({ target: root });
  assert.deepEqual(pre.originDetected, { owner: "ArchonVII", repo: "example" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "test/checkOriginRemote.test.mjs"`
Expected: FAIL — `pre.originDetected` is undefined.

- [ ] **Step 3: Wire `checkOriginRemote` into preflight**

In `src/server/preflight/index.mjs`:

3a. Add the import at the top:

```js
import { checkOriginRemote } from "./checkOriginRemote.mjs";
```

3b. In `runPreflight`, compute origin detection alongside the checks. Find:

```js
  const [node, git, ghPair, actionlint, network, targetCheck, hooksPathCheck] = await Promise.all(tasks);
```

Add immediately after it:

```js
  const { originDetected } = target ? await checkOriginRemote(target) : { originDetected: null };
```

3c. Change the final `return` of `runPreflight`. Find:

```js
  return { checks, summary };
```

Replace with:

```js
  return { checks, summary, originDetected };
```

- [ ] **Step 4: Pass `originDetected` through RPC**

In `src/server/rpc.mjs`, find:

```js
  async "preflight.run"({ target }) {
    const pre = await runPreflight({ target });
    return { ...pre, capabilities: deriveCapabilities(pre) };
  },
```

It already spreads `...pre`, so `originDetected` is included automatically. No
change needed — confirm by reading the method.

- [ ] **Step 5: Carry `originDetected` into the plan and gate the wizard**

In `src/ui/app.mjs`:

5a. Store it after preflight. Find:

```js
      state.preflight = pre;
      state.capabilities = pre.capabilities;
```

Add after:

```js
      state.originDetected = pre.originDetected || null;
```

5b. Include it in `plan.build` context. Find:

```js
        context: {
          ...state.context,
          capabilities: state.capabilities,
          account: state.capabilities?.account,
          sourceSnapshots: state.snapshots?.snapshots || {},
        },
```

Replace with:

```js
        context: {
          ...state.context,
          capabilities: state.capabilities,
          account: state.capabilities?.account,
          originDetected: state.originDetected,
          sourceSnapshots: state.snapshots?.snapshots || {},
        },
```

5c. Gate Review on the stamped `blocking` flag (single source of truth). Find:

```js
  const blockingWarnings = (state.plan.warnings || []).filter(
    (w) => w.feature === "workflows.ci" || /conflicts with/.test(w.message)
  );
```

Replace with:

```js
  const blockingWarnings = (state.plan.warnings || []).filter((w) => w.blocking);
```

5d. Add `state.originDetected: null` to the initial `state` object. Find:

```js
  preflight: null,
  capabilities: null,
```

Replace with:

```js
  preflight: null,
  capabilities: null,
  originDetected: null,
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (preflight test passes; nothing else regressed).

- [ ] **Step 7: Manual wizard smoke (per AGENTS.md UI rule)**

Run: `npm run dev` (then exercise the Review screen mentally/manually — the
browser app has no automated harness). Confirm the page builds without console
errors. Record what was exercised in the PR's Verification Notes. Stop the
server when done.

- [ ] **Step 8: Commit**

```bash
git add src/server/preflight/index.mjs src/ui/app.mjs test/checkOriginRemote.test.mjs
git commit -m "feat(wizard): origin detection in preflight + blocking-flag gate (#48)"
```

---

## Task 8: Docs + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document existing-repo onboarding in the README**

In `README.md`, in the "Headless onboarding" subsection (added in #46), after the
options table, add:

```markdown
**Existing repos.** Point `onboard` at a repo that already has a github `origin`
and select GitHub features without `remote.github` — workflow callers are
written locally, and `remote.labels` / `remote.branch-protection` target the
detected `owner/repo`. No new repo is created. Pass `--owner`/`--repo` to target
a specific repo (e.g. an upstream instead of a fork); explicit values win over
the detected origin.
```

- [ ] **Step 2: Run the full suite and record output**

Run: `npm test`
Expected: PASS, 0 fail. Record the `ℹ tests / pass / fail` lines for the PR.

- [ ] **Step 3: Adversarial idempotency check (per AGENTS.md)**

Run this one-off to confirm re-running the same existing-repo plan twice is
clean:

```bash
node -e "import('./src/server/onboard/headlessOnboard.mjs').then(async ({runOnboard}) => { const r = await runOnboard({targetPath: process.cwd(), features:['workflow.pr-policy'], dryRun:true}); console.log('status', r.plan.context.githubRepoTarget.status, 'create?', r.plan.ordered.some(u=>u.taskId==='ghRepoCreateAndPush')); })"
```

Expected: prints `status known create? false` (this repo has a github origin).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): existing-repo onboarding via headless onboard (#48)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §1 repo target → Tasks 3,5; §2 parser → Task 1; §3 enum/gate → Tasks 4,5; §4 ordering → unchanged (asserted in Task 5 test); §5 severity/blocking → Tasks 3,5,6,7; guardrails 1&2 → Tasks 3,5; data flow → Tasks 2,6,7; test matrix → Tasks 1–6. Covered.
- **Ripple captured:** `defaultLocalSelection` + the three test helpers move from `requires`-based to `remoteRequirement`-based filtering (Task 6 / Task 4); ~10 old-contract assertions in `registry.test.mjs` migrated (Task 4).
- **Type consistency:** `githubRepoTarget` shape, `remoteRequirement` values (`runtime`/`api-target`), `severity` (`warn`/`error`), and `blocking` boolean are used identically across Tasks 3–7. `isBlockingWarning` is defined once (Task 3), imported everywhere.
- **No placeholders:** every code/edit step shows the actual content.
