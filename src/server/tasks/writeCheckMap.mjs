import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { normalizeSnapshotText } from "./repoTemplateSnapshot.mjs";

const SNAPSHOTS_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "snapshots"
);

const CHECK_MAP_SNAPSHOT = join(SNAPSHOTS_ROOT, "repo-template", ".agent", "check-map.yml");

// #293: the vendored gate caller that onboarding installs (the same file the
// workflow.required-gate feature copies via installWorkflow). Its active
// `stack:` value is the single source of truth for the check-map default —
// the documented path-to-check contract must never disagree with the stack
// the installed caller actually runs.
const GATE_CALLER_SNAPSHOT = join(SNAPSHOTS_ROOT, "github-workflows", "repo-required-gate.yml");

// An ACTIVE stack line has only blanks before `stack:`, so the caller's
// commented stack variants (`# stack: minimal`, `# stack: python`, ...) and
// prose mentions (`stack=minimal`) never match. `\r?$` tolerates CRLF —
// snapshots have had CRLF drift before (repo-template#146).
const ACTIVE_STACK_LINE = /^([ \t]*)stack:[ \t]*([^\s#]+)[ \t]*\r?$/gm;

// Extracts the single active `stack:` value from a gate-caller workflow body.
// Throws on zero or multiple active lines: a broken derivation must fail the
// onboarding run loudly, never silently ship a stack the gate disagrees with.
export function extractActiveStack(gateCallerBody) {
  const matches = [...gateCallerBody.matchAll(ACTIVE_STACK_LINE)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one active "stack:" line in the repo-required-gate caller snapshot, ` +
        `found ${matches.length}; cannot derive the check-map default stack (#293)`
    );
  }
  return matches[0][2];
}

// Renders the check-map body onboarding emits: the repo-template snapshot with
// `defaults.stack` rewritten to the gate caller's active stack (#293).
// auditPlan reuses this renderer so the audit's expected body never drifts
// from what onboarding actually writes (the renderAgentsBody pattern from
// #291/#306). Pure so tests can exercise malformed inputs directly.
export function renderCheckMapBody(checkMapSnapshotBody, gateCallerBody) {
  const stack = extractActiveStack(gateCallerBody);
  const body = normalizeSnapshotText(checkMapSnapshotBody);
  const matches = [...body.matchAll(ACTIVE_STACK_LINE)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one "stack:" line in the check-map snapshot, found ${matches.length}; ` +
        `cannot rewrite defaults.stack to match the gate caller (#293)`
    );
  }
  return body.replace(ACTIVE_STACK_LINE, `$1stack: ${stack}`);
}

// Reads both vendored snapshots and returns the derived check-map body. The
// single entry point for "what does onboarding write" — used by apply() here
// and by auditPlan's expected-body table.
export async function loadCheckMapBody() {
  const [checkMapSnapshot, gateCaller] = await Promise.all([
    readFile(CHECK_MAP_SNAPSHOT, "utf8"),
    readFile(GATE_CALLER_SNAPSHOT, "utf8"),
  ]);
  return renderCheckMapBody(checkMapSnapshot, gateCaller);
}

export async function check(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/check-map.yml");
  try {
    await access(target, constants.F_OK);
    return "already-done";
  } catch {
    return "needs-apply";
  }
}

export async function apply(ctx) {
  const body = await loadCheckMapBody();
  const result = await safeWriteFile(ctx.targetPath, ".agent/check-map.yml", body);
  recordCreatedFile(ctx, result, {
    path: ".agent/check-map.yml",
    source: "snapshot:repo-template/.agent/check-map.yml",
  });
  return result;
}

export async function verify(ctx) {
  const target = safeJoin(ctx.targetPath, ".agent/check-map.yml");
  try {
    const body = await readFile(target, "utf8");
    if (!body.includes("repo-required-gate / decision")) {
      return { ok: false, error: "check map does not reference repo-required-gate / decision" };
    }
    // Deliberately no stack assertion here: the emitted default matches the
    // gate caller at apply time, but the check-map is repo-owned afterward —
    // an owner-customized stack must not fail verify()/--audit re-runs (#293).
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.agent/check-map.yml to retry.`;
}
