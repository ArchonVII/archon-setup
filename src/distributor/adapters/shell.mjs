// Shell adapter: hash-comment markers. The distributor must preserve the
// executable bit and keep the shebang on line 1 when writing (A7 metadata
// policy); this module only declares that policy. Filesystem-free.
export const commentStyle = "hash";
export const metadataPolicy = { eol: "preserve", preserveExecBit: true, shebangFirstLine: true };

export function detectDanger() {
  return [];
}
