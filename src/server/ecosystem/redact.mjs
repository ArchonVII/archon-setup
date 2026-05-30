// src/server/ecosystem/redact.mjs
// Redacts common secret formats from any string before it is written to disk.
// Patterns sourced from GitHub token prefixes (ghp_/gho_/github_pat_, docs.github.com),
// AWS access-key id format (AKIA + 16 base32, AWS IAM docs), and generic key=value secrets.
const PATTERNS = [
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/gh[posru]_[A-Za-z0-9]{20,}/g, (m) => `${m.slice(0, 4)}[redacted]`],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1[redacted]"],
  [/((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*)("?)[^"\s&]+\2/gi, "$1[redacted]"],
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
