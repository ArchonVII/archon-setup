import { resolve, sep, isAbsolute, join } from "node:path";

// Returns the resolved child path if it lies inside the chosen root.
// Throws otherwise. Use for every filesystem write.
export function safeJoin(root, relativePath) {
  if (!isAbsolute(root)) {
    throw new Error(`safeJoin requires an absolute root, got: ${root}`);
  }
  if (isAbsolute(relativePath)) {
    throw new Error(`safeJoin requires a relative child path, got: ${relativePath}`);
  }
  const resolvedRoot = resolve(root) + sep;
  const candidate = resolve(join(root, relativePath));
  if (candidate !== resolve(root) && !candidate.startsWith(resolvedRoot)) {
    throw new Error(`path escapes root: ${relativePath}`);
  }
  return candidate;
}
