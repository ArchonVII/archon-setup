// src/server/ecosystem/writeAtomic.mjs
import { writeFile, rename } from "node:fs/promises";

// Writes to <path>.tmp then renames over <path>. rename is atomic on the same
// volume (POSIX + NTFS), so a concurrent reader sees either the old file or the
// new one — never a half-written file. Used because agents read ecosystem-state.json.
export async function writeAtomic(path, content) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
  return { path };
}
