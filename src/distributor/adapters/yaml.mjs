// YAML adapter: hash-comment markers. Danger detection is a tolerant,
// indentation/path-aware line scanner (A9) — it FLAGS duplicate/conflicting
// keys at the same mapping path but never rewrites (DL6). Filesystem-free (A7).
export const commentStyle = "hash";
export const metadataPolicy = { eol: "preserve", preserveExecBit: false, shebangFirstLine: false };

// A mapping key line: indentation, then `key:` optionally followed by a value.
// Lazy `[^:]*?` stops at the first colon so `run: echo a: b` keys on `run`.
// A bare `key:value` (no space after the colon) is a YAML scalar, not a
// mapping, so it is intentionally not matched.
const KEY_LINE = /^(\s*)([^\s#][^:]*?):(?:\s.*|)$/;

// Flag keys that repeat under the same parent mapping. Path awareness keeps a
// top-level `permissions:` distinct from `jobs.<job>.permissions:` and keeps
// sibling jobs distinct, so a managed key never false-conflicts across paths.
export function detectDanger(body) {
  const lines = body.split(/\r\n|\r|\n/);
  const stack = [];
  const seen = new Map();
  const dangers = [];

  lines.forEach((raw, index) => {
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return; // blank or comment
    const match = raw.match(KEY_LINE);
    if (!match) return; // scalar, list item, flow content — not a mapping key

    const indent = match[1].length;
    const key = match[2].trim();
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.map((entry) => entry.key).join(".");
    const path = parent ? `${parent}.${key}` : key;

    if (seen.has(path)) {
      dangers.push({ kind: "duplicate-key", key, path, lines: [seen.get(path), index + 1] });
    } else {
      seen.set(path, index + 1);
    }
    stack.push({ indent, key });
  });

  return dangers;
}
