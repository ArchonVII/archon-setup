// src/server/ecosystem/redact.mjs
// Redacts common secret formats from any string before it is written to disk.
// Patterns sourced from GitHub token prefixes (ghp_/gho_/github_pat_, docs.github.com),
// AWS access-key id format (AKIA + 16 base32, AWS IAM docs), and generic key=value secrets.
const PATTERNS = [
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/gh[posru]_[A-Za-z0-9]{20,}/g, (m) => `${m.slice(0, 4)}[redacted]`],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  // user:password@host in connection strings (postgres://, redis://, etc.) — requires the @host to avoid matching plain URLs like http://127.0.0.1:5174
  [/(\/\/[^:@\s]{0,64}:)([^@\s]+)(@)/g, "$1[redacted]$3"],
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]"],
  [/((?:token|secret|password|passwd|api[_-]?key)"?\s*[=:]\s*)("?)[^"\s&]+\2/gi, "$1[redacted]"],
  // argv-leak backstop: redacts the VALUE in an accidental `gh secret set NAME
  // VALUE` (lane F sets secrets via stdin with `--body` omitted, never argv —
  // this is defence-in-depth). The (?!-) keeps real flags like --repo visible.
  [/(gh\s+secret\s+set\s+\S+\s+)(?!-)(\S+)/g, "$1[redacted]"],
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
