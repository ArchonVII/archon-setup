function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectEol(value) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeManagedBody(body) {
  return body.trim().replace(/\r\n?/g, "\n");
}

function withEol(value, eol) {
  return eol === "\n" ? value : value.replace(/\n/g, eol);
}

function blockPattern(id) {
  const start = `<!-- BEGIN ARCHONVII MANAGED BLOCK: ${id} -->`;
  const end = `<!-- END ARCHONVII MANAGED BLOCK: ${id} -->`;
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
}

export function formatManagedBlock(id, body, eol = "\n") {
  const normalized = [
    `<!-- BEGIN ARCHONVII MANAGED BLOCK: ${id} -->`,
    normalizeManagedBody(body),
    `<!-- END ARCHONVII MANAGED BLOCK: ${id} -->`,
  ].join("\n");
  return withEol(normalized, eol);
}

export function hasCurrentManagedBlock(current, id, body) {
  const match = current.match(blockPattern(id));
  if (!match) return false;
  return match[0] === formatManagedBlock(id, body, detectEol(current));
}

export function reconcileManagedBlock(current, id, body) {
  const eol = detectEol(current);
  const block = formatManagedBlock(id, body, eol);
  const pattern = blockPattern(id);

  if (pattern.test(current)) {
    const next = current.replace(pattern, block);
    return { body: next, changed: next !== current };
  }

  const separator = current.length === 0
    ? ""
    : current.endsWith(`${eol}${eol}`)
      ? ""
      : current.endsWith(eol)
        ? eol
        : `${eol}${eol}`;
  return { body: `${current}${separator}${block}${eol}`, changed: true };
}

export function reconcileManagedBlockNearTop(current, id, body) {
  const eol = detectEol(current);
  const block = formatManagedBlock(id, body, eol);
  const pattern = blockPattern(id);
  const withoutBlock = current.replace(pattern, "").replace(/\r?\n{3,}/g, "\n\n");
  const next = insertNearTop(withoutBlock, block, eol);
  return { body: next, changed: next !== current };
}

function insertNearTop(current, block, eol) {
  if (current.length === 0) return `${block}${eol}`;
  const normalized = current.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let insertLine = 0;

  if (lines[0] === "---") {
    const end = lines.findIndex((line, index) => index > 0 && line === "---");
    if (end !== -1) insertLine = end + 1;
  }
  while (lines[insertLine] === "") insertLine += 1;

  if (/^#\s+/.test(lines[insertLine] || "")) insertLine += 1;
  while (lines[insertLine] === "") insertLine += 1;

  const firstSection = lines.findIndex((line, index) => index >= insertLine && /^##\s+/.test(line));
  if (firstSection !== -1) insertLine = firstSection;
  else insertLine = lines.length;

  const before = lines.slice(0, insertLine).join("\n").trimEnd();
  const after = lines.slice(insertLine).join("\n").trim();
  const joined = [
    before,
    block.replace(/\r\n?/g, "\n"),
    after,
  ].filter(Boolean).join("\n\n");
  return withEol(`${joined}\n`, eol);
}
