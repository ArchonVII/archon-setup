import { writeFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { safeJoin } from "./paths.mjs";

// Writes `content` to `<root>/<relativePath>`. Refuses to overwrite unless
// `overwrite: true`. Always creates parent directories.
export async function safeWriteFile(root, relativePath, content, { overwrite = false } = {}) {
  const full = safeJoin(root, relativePath);
  await mkdir(dirname(full), { recursive: true });

  let exists = false;
  try {
    await access(full, constants.F_OK);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists && !overwrite) {
    return { status: "already-exists", path: full };
  }
  await writeFile(full, content, "utf8");
  return { status: exists ? "overwrote" : "created", path: full };
}
