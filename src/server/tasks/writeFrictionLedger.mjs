import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { safeWriteFile } from "../lib/safeWriteFile.mjs";
import { safeJoin } from "../lib/paths.mjs";
import { recordCreatedFile } from "../lib/manifest.mjs";
import { writeSnapshotFile } from "./repoTemplateSnapshot.mjs";

const LEDGER_PATH = ".claude/friction.md";
const GITIGNORE_PATH = ".gitignore";
const REQUIRED_GITIGNORE_LINES = [".claude/*", "!.claude/friction.md"];
const LEDGER_HEADER = "| date | category | what happened | cost | suggested fix |";
const LEDGER_SEPARATOR = "|---|---|---|---|---|";

async function fileExists(ctx, relativePath) {
  try {
    await access(safeJoin(ctx.targetPath, relativePath), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function hasLine(body, line) {
  return new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(body);
}

function gitignoreHasFrictionException(body) {
  return REQUIRED_GITIGNORE_LINES.every((line) => hasLine(body, line));
}

function ensureGitignoreFrictionException(body) {
  const missing = REQUIRED_GITIGNORE_LINES.filter((line) => !hasLine(body, line));
  if (!missing.length) return body;

  const trimmed = String(body ?? "").trimEnd();
  const prefix = trimmed ? `${trimmed}\n\n` : "";
  return `${prefix}# ArchonVII friction ledger\n${missing.join("\n")}\n`;
}

export function frictionLedgerSeed(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const comment = lines.find((line) => line.trim().startsWith("<!--")) ?? "<!-- Log non-bug workflow hiccups here. -->";
  return `${comment.trim()}\n${LEDGER_HEADER}\n${LEDGER_SEPARATOR}\n`;
}

async function readGitignore(ctx) {
  try {
    return await readFile(safeJoin(ctx.targetPath, GITIGNORE_PATH), "utf8");
  } catch {
    return "";
  }
}

export async function check(ctx) {
  if (!(await fileExists(ctx, LEDGER_PATH))) return "needs-apply";
  if (!gitignoreHasFrictionException(await readGitignore(ctx))) return "needs-apply";
  return "already-done";
}

export async function apply(ctx) {
  const ledgerResult = await writeSnapshotFile(ctx, LEDGER_PATH, { transform: frictionLedgerSeed });
  const gitignoreBody = await readGitignore(ctx);
  const nextGitignore = ensureGitignoreFrictionException(gitignoreBody);
  const gitignoreResult = nextGitignore === gitignoreBody
    ? { status: "unchanged", path: safeJoin(ctx.targetPath, GITIGNORE_PATH) }
    : await safeWriteFile(ctx.targetPath, GITIGNORE_PATH, nextGitignore, { overwrite: true });

  recordCreatedFile(ctx, gitignoreResult, {
    path: GITIGNORE_PATH,
    source: "archon-setup:friction-ledger-gitignore-exception",
  });
  return [ledgerResult, gitignoreResult];
}

export async function verify(ctx) {
  try {
    const ledger = await readFile(safeJoin(ctx.targetPath, LEDGER_PATH), "utf8");
    if (!/^\| date \| category \| what happened \| cost \| suggested fix \|/m.test(ledger)) {
      return { ok: false, error: `${LEDGER_PATH} is missing the friction table header` };
    }
    if (!gitignoreHasFrictionException(await readGitignore(ctx))) {
      return { ok: false, error: `${GITIGNORE_PATH} is missing the friction ledger exception` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function rollbackHint(ctx) {
  return `Delete ${ctx.targetPath}/.claude/friction.md and remove the .claude/friction.md exception from ${ctx.targetPath}/.gitignore to retry.`;
}
