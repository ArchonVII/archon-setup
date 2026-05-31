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
