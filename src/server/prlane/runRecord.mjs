import { appendFile, mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MACHINE = JSON.parse(readFileSync(join(HERE, "..", "..", "contracts", "run-states.json"), "utf8"));

const STATES = new Map(MACHINE.states.map((state) => [state.id, state]));
const TERMINAL = new Set(MACHINE.states.filter((state) => state.terminal).map((state) => state.id));
const EXPLICIT_TRANSITIONS = new Set(MACHINE.transitions.map(({ from, to }) => `${from}->${to}`));

function requireKnownState(state) {
  if (!STATES.has(state)) throw new Error(`unknown run state "${state}"`);
}

function requiredFieldsFor(state) {
  return STATES.get(state).requires ?? [];
}

function missingRequiredField(state, entry) {
  for (const field of requiredFieldsFor(state)) {
    if (entry[field] === undefined || entry[field] === null) return field;
  }
  return null;
}

function wildcardAllows(from, to) {
  for (const wildcard of MACHINE.wildcardTransitions ?? []) {
    if (wildcard.to !== to || !wildcard.fromAnyNonTerminal) continue;
    if (TERMINAL.has(from)) continue;
    if ((wildcard.excludeFrom ?? []).includes(from)) continue;
    return true;
  }
  return false;
}

function transitionAllowed(from, to) {
  if (EXPLICIT_TRANSITIONS.has(`${from}->${to}`)) return true;
  return wildcardAllows(from, to);
}

function validateAppend({ entries, state, entry }) {
  requireKnownState(state);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("run state entry must be an object");
  }

  const missing = missingRequiredField(state, entry);
  if (missing) throw new Error(`missing required field "${missing}" for state ${state}`);

  const previous = entries.at(-1);
  if (!previous) {
    if (state !== MACHINE.initial) throw new Error(`first run state must be ${MACHINE.initial}, got ${state}`);
    return;
  }

  if (previous.runId !== entry.runId) {
    throw new Error(`runId mismatch: existing ${previous.runId}, new ${entry.runId}`);
  }
  if (previous.baseSha && entry.baseSha && previous.baseSha !== entry.baseSha) {
    throw new Error(`baseSha mismatch: existing ${previous.baseSha}, new ${entry.baseSha}`);
  }
  if (TERMINAL.has(previous.state) && state !== "rollback_requested") {
    throw new Error(`terminal state ${previous.state} may only transition to rollback_requested`);
  }
  if (!transitionAllowed(previous.state, state)) {
    throw new Error(`illegal transition ${previous.state} -> ${state}`);
  }
}

export async function readRunRecord(recordPath) {
  let body = "";
  try {
    body = await readFile(recordPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const entries = body
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        const entry = JSON.parse(line);
        requireKnownState(entry.state);
        return entry;
      } catch (err) {
        throw new Error(`invalid run record line ${index + 1}: ${err.message}`);
      }
    });
  return { entries, current: entries.at(-1) ?? null };
}

export async function appendRunState({ recordPath, state, entry, now = new Date().toISOString() }) {
  const { entries } = await readRunRecord(recordPath);
  validateAppend({ entries, state, entry });

  await mkdir(dirname(recordPath), { recursive: true });
  const line = JSON.stringify({ ...entry, state, ts: now });
  await appendFile(recordPath, `${line}\n`, "utf8");
  return line;
}
