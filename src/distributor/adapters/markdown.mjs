// Markdown adapter: HTML-comment managed-region markers, prose body (no
// structural danger to detect). Filesystem-free (A7) — the distributor owns
// all stat/chmod/read/write; this module only declares policy + pure checks.
export const commentStyle = "markdown";
export const metadataPolicy = { eol: "preserve", preserveExecBit: false, shebangFirstLine: false };

export function detectDanger() {
  return [];
}
