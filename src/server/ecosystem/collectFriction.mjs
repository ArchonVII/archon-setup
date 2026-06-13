import { readFile } from "node:fs/promises";
import { FRICTION_CATEGORIES, FRICTION_COSTS } from "../../contracts/vocab.mjs";

const FRICTION_HEADER = ["date", "category", "what happened", "cost", "suggested fix"];

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

export function noLedgerFrictionSummary() {
  return {
    state: "no-ledger",
    count: 0,
    byCategory: zeroCounts(FRICTION_CATEGORIES),
    byCost: zeroCounts(FRICTION_COSTS),
    lastEntryAt: null,
    unparsed: 0,
  };
}

function presentFrictionSummary() {
  return {
    state: "present",
    count: 0,
    byCategory: zeroCounts(FRICTION_CATEGORIES),
    byCost: zeroCounts(FRICTION_COSTS),
    lastEntryAt: null,
    unparsed: 0,
  };
}

function parseTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isHeader(cells) {
  return cells.map((cell) => cell.toLowerCase()).join("\u0000") === FRICTION_HEADER.join("\u0000");
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isValidRow([date, category, whatHappened, cost, suggestedFix]) {
  return Boolean(
    date &&
      FRICTION_CATEGORIES.includes(category) &&
      whatHappened &&
      FRICTION_COSTS.includes(cost) &&
      suggestedFix,
  );
}

// Parse the `.claude/friction.md` table contract from repo-template#78. The
// ledger is hand-appended under pressure, so bad table rows increment
// `unparsed` and never throw.
export function parseFrictionLedger(markdown) {
  const summary = presentFrictionSummary();
  const lines = String(markdown ?? "").split(/\r?\n/);

  for (const line of lines) {
    const cells = parseTableCells(line);
    if (!cells) continue;
    if (isHeader(cells) || isSeparator(cells)) continue;

    if (cells.length !== 5 || !isValidRow(cells)) {
      summary.unparsed += 1;
      continue;
    }

    const [date, category, , cost] = cells;
    summary.count += 1;
    summary.byCategory[category] += 1;
    summary.byCost[cost] += 1;
    if (!summary.lastEntryAt || date > summary.lastEntryAt) summary.lastEntryAt = date;
  }

  return summary;
}

function mergeCounts(target, source) {
  for (const [key, count] of Object.entries(source)) target[key] += count;
}

export async function collectFriction(frictionMdPaths = []) {
  const aggregate = presentFrictionSummary();
  const sources = [];
  const byPath = {};
  let noLedger = 0;

  for (const path of frictionMdPaths) {
    let summary;
    try {
      summary = parseFrictionLedger(await readFile(path, "utf8"));
    } catch {
      summary = noLedgerFrictionSummary();
    }

    if (summary.state === "no-ledger") noLedger += 1;
    aggregate.count += summary.count;
    aggregate.unparsed += summary.unparsed;
    mergeCounts(aggregate.byCategory, summary.byCategory);
    mergeCounts(aggregate.byCost, summary.byCost);
    if (summary.lastEntryAt && (!aggregate.lastEntryAt || summary.lastEntryAt > aggregate.lastEntryAt)) {
      aggregate.lastEntryAt = summary.lastEntryAt;
    }

    byPath[path] = summary;
    sources.push({ path, ...summary });
  }

  return {
    id: "friction",
    status: "green",
    detail: `${aggregate.count} friction entries; ${noLedger} repos without ledgers; ${aggregate.unparsed} unparsed rows`,
    count: aggregate.count,
    byCategory: aggregate.byCategory,
    byCost: aggregate.byCost,
    lastEntryAt: aggregate.lastEntryAt,
    unparsed: aggregate.unparsed,
    noLedger,
    sources,
    byPath,
  };
}
