import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, join } from "node:path";

// Validates a target directory chosen by the user.
// Accepts:
//   - a non-existent path whose parent exists and is writable (we'll create it)
//   - an existing empty directory
//   - an existing directory containing only `.git`
// Rejects everything else.
export async function checkTargetPath(target) {
  if (!target || typeof target !== "string") {
    return { id: "target", status: "red", detail: "No target path provided." };
  }
  const full = resolve(target);

  let exists = false;
  try {
    await access(full, constants.F_OK);
    exists = true;
  } catch {}

  if (!exists) {
    const parent = dirname(full);
    try {
      await access(parent, constants.W_OK);
      return {
        id: "target",
        status: "green",
        detail: `Will create ${full}`,
        path: full,
        willCreate: true,
      };
    } catch {
      return {
        id: "target",
        status: "red",
        detail: `Parent directory not writable: ${parent}`,
        path: full,
      };
    }
  }

  const s = await stat(full);
  if (!s.isDirectory()) {
    return { id: "target", status: "red", detail: `Not a directory: ${full}`, path: full };
  }

  const entries = await readdir(full);
  const significant = entries.filter((e) => e !== ".git");
  if (significant.length > 0) {
    return {
      id: "target",
      status: "red",
      detail: `Directory is not empty: ${full}`,
      path: full,
      contents: significant.slice(0, 10),
    };
  }

  // Check that we're not nested inside another git repo.
  let cur = full;
  while (true) {
    const parent = dirname(cur);
    if (parent === cur) break;
    try {
      await access(join(parent, ".git"), constants.F_OK);
      return {
        id: "target",
        status: "yellow",
        detail: `Target is inside another git repository: ${parent}`,
        path: full,
      };
    } catch {}
    cur = parent;
  }

  return { id: "target", status: "green", detail: `Empty directory ready: ${full}`, path: full };
}
