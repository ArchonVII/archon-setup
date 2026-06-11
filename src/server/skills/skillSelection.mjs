import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSchemaSupported, validate } from "../../contracts/validate.mjs";
import { contentFingerprint } from "../decisions/decisionDoc.mjs";
import { runCommand as defaultRunCommand } from "../lib/commandRunner.mjs";
import { safeJoin } from "../lib/paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_SELECTION_SCHEMA = JSON.parse(
  readFileSync(join(HERE, "..", "..", "contracts", "schemas", "skill-selection.schema.json"), "utf8"),
);
assertSchemaSupported(SKILL_SELECTION_SCHEMA);

const DEFAULT_SOURCE_REPO = "ArchonVII/jma-skill-review";
const DEFAULT_SOURCE_ROOT = "shared/";
const DEFAULT_CATALOG_RELPATH = "docs/skill-catalog.md";
const FAILURE_STATUSES = ["status-unreadable", "catalog-unreadable", "catalog-ambiguous", "skill-unreadable", "repo-missing"];

export function validateSkillSelection(record) {
  const checked = validate(SKILL_SELECTION_SCHEMA, record);
  const errors = [...checked.errors];
  // Truthfulness invariant (#195 review): every discovery status except
  // repo-missing must pin the skills-repo commit, or the recorded SKILL.md
  // hashes and discovery failure are unauditable. repo-missing is the only
  // status where the builder cannot read a commit.
  const status = record?.discovery?.status;
  const usable = ["ok", "repo-dirty"].includes(status);
  const sourceCommit = record?.source?.commit;
  if (status && status !== "repo-missing" && sourceCommit === null) {
    errors.push({
      path: "source.commit",
      message: `commit must be a pinned 40-hex sha when discovery.status is "${status}"`,
    });
  }
  if (status === "repo-missing" && sourceCommit !== null && sourceCommit !== undefined) {
    errors.push({
      path: "source.commit",
      message: 'commit must be null when discovery.status is "repo-missing"',
    });
  }
  const fallback = record?.discovery?.fallback;
  if (status === "ok" && fallback !== null && fallback !== undefined) {
    errors.push({
      path: "discovery.fallback",
      message: 'fallback must be null when discovery.status is "ok"',
    });
  }
  if (status === "repo-dirty" && fallback !== "recorded-dirty-provenance") {
    errors.push({
      path: "discovery.fallback",
      message: 'fallback must be "recorded-dirty-provenance" when discovery.status is "repo-dirty"',
    });
  }
  if (FAILURE_STATUSES.includes(status) && fallback !== "proceeded-without-skills") {
    errors.push({
      path: "discovery.fallback",
      message: `fallback must be "proceeded-without-skills" when discovery.status is "${status}"`,
    });
  }
  // A "successful" record must say something (#195 review): on usable statuses
  // it either records selected guidance or explicitly claims no relevant skill
  // existed — an empty ok record defeats the audit purpose of the field.
  if (usable && record?.noRelevantSkill === false && Array.isArray(record?.selections) && record.selections.length === 0) {
    errors.push({
      path: "selections",
      message: "usable discovery must either record selected skills or set noRelevantSkill: true",
    });
  }
  if (record?.noRelevantSkill === true && Array.isArray(record?.selections) && record.selections.length > 0) {
    errors.push({
      path: "selections",
      message: "noRelevantSkill records cannot also carry selections",
    });
  }
  // Status and dirtyPaths must agree: "ok" claiming cleanliness cannot carry
  // contrary evidence, and "repo-dirty" must justify itself with the paths.
  const dirtyPaths = record?.discovery?.dirtyPaths;
  if (status === "ok" && Array.isArray(dirtyPaths) && dirtyPaths.length > 0) {
    errors.push({
      path: "discovery.dirtyPaths",
      message: 'an "ok" record cannot carry dirty paths; record repo-dirty instead',
    });
  }
  if (status === "repo-dirty" && Array.isArray(dirtyPaths) && dirtyPaths.length === 0) {
    errors.push({
      path: "discovery.dirtyPaths",
      message: 'a "repo-dirty" record must list the dirty paths that justify it',
    });
  }
  // One selection per skill name: duplicates would let a record carry two
  // different relpaths/hashes for the same name — catalog ambiguity smuggled
  // inside an otherwise valid record.
  if (Array.isArray(record?.selections)) {
    const seen = new Set();
    for (let i = 0; i < record.selections.length; i += 1) {
      const name = record.selections[i]?.name;
      if (typeof name !== "string") continue;
      if (seen.has(name)) {
        errors.push({
          path: `selections[${i}].name`,
          message: `duplicate selection name "${name}"; one selection per skill`,
        });
      }
      seen.add(name);
    }
  }
  return { valid: errors.length === 0, errors };
}

function discovery(status, { fallback = null, dirtyPaths = [], error = null } = {}) {
  return { status, fallback, dirtyPaths, error };
}

function baseRecord({ runId, selectedAt, sourceRepo, sourceRoot, catalogRelpath, commit, discoveryInfo, noRelevantSkill, selections }) {
  return {
    schemaVersion: 1,
    kind: "skill-selection",
    runId,
    selectedAt,
    source: { repo: sourceRepo, root: sourceRoot, catalogRelpath, commit },
    discovery: discoveryInfo,
    noRelevantSkill,
    selections,
  };
}

async function git({ skillsRoot, args, runCommand }) {
  try {
    const result = await runCommand("git", args, { cwd: skillsRoot });
    if (result.code !== 0) return { ok: false, error: result.stderr?.trim() || result.stdout?.trim() || `git exit ${result.code}` };
    return { ok: true, stdout: result.stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function dirtyPathsFromPorcelain(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parsed = /^(?:[ MADRCU?!]{1,2})\s+(.+)$/.exec(line);
      const rawPath = parsed ? parsed[1] : line.trimStart();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
      return path.replace(/^"|"$/g, "").replace(/\\/g, "/");
    });
}

function relpathInside(root, absolutePath) {
  const rootAbs = resolve(root);
  const targetAbs = resolve(absolutePath);
  if (targetAbs !== rootAbs && !targetAbs.startsWith(`${rootAbs}${sep}`)) return null;
  return relative(rootAbs, targetAbs).replace(/\\/g, "/");
}

function parseCatalog(catalogBody, { skillsRoot, catalogRelpath }) {
  const catalogDir = dirname(catalogRelpath);
  // name -> array of DISTINCT relpaths; >1 entry means the catalog is
  // ambiguous for that name (same-name same-path repetition is harmless).
  const entries = new Map();
  const linkPattern = /-\s+\[`([^`]+)`\]\(([^)]+)\)/g;
  for (const match of catalogBody.matchAll(linkPattern)) {
    const name = match[1];
    const link = match[2];
    const absoluteSkillPath = resolve(skillsRoot, catalogDir, link);
    const relpath = relpathInside(skillsRoot, absoluteSkillPath);
    if (!relpath || !relpath.endsWith("/SKILL.md")) continue;
    const paths = entries.get(name) ?? [];
    if (!paths.includes(relpath)) paths.push(relpath);
    entries.set(name, paths);
  }
  return entries;
}

async function readCatalog({ skillsRoot, catalogRelpath }) {
  return readFile(safeJoin(skillsRoot, catalogRelpath), "utf8");
}

function assertValidRecord(record) {
  const checked = validateSkillSelection(record);
  if (!checked.valid) {
    const detail = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`SkillSelection schema invalid: ${detail}`);
  }
}

export async function buildSkillSelectionRecord({
  runId,
  skillsRoot,
  selectedSkills = [],
  noRelevantSkill = false,
  sourceRepo = DEFAULT_SOURCE_REPO,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  catalogRelpath = DEFAULT_CATALOG_RELPATH,
  runCommand = defaultRunCommand,
  now = () => new Date().toISOString(),
}) {
  if (!runId) throw new Error("runId is required");
  if (!skillsRoot) throw new Error("skillsRoot is required");
  if (noRelevantSkill && selectedSkills.length > 0) {
    throw new Error("noRelevantSkill records cannot also carry selected skills");
  }
  if (!noRelevantSkill && selectedSkills.length === 0) {
    // An empty "successful" record would claim nothing (#195 review): the
    // caller must either select skills or explicitly claim none were relevant.
    throw new Error("either select at least one skill or set noRelevantSkill: true");
  }
  const selectedNames = new Set();
  for (const selected of selectedSkills) {
    if (!selected.whySelected || !String(selected.whySelected).trim()) {
      throw new Error(`selected skill ${selected.name ?? "(unknown)"} is missing whySelected`);
    }
    if (selectedNames.has(selected.name)) {
      throw new Error(`selected skill ${selected.name} is listed more than once`);
    }
    selectedNames.add(selected.name);
  }

  const selectedAt = now();
  const inside = await git({ skillsRoot, args: ["rev-parse", "--is-inside-work-tree"], runCommand });
  if (!inside.ok || inside.stdout !== "true") {
    const record = baseRecord({
      runId,
      selectedAt,
      sourceRepo,
      sourceRoot,
      catalogRelpath,
      commit: null,
      discoveryInfo: discovery("repo-missing", { fallback: "proceeded-without-skills", error: inside.error }),
      noRelevantSkill: false,
      selections: [],
    });
    assertValidRecord(record);
    return record;
  }

  const commitResult = await git({ skillsRoot, args: ["rev-parse", "HEAD"], runCommand });
  if (!commitResult.ok) {
    // A worktree with no readable HEAD (unborn branch, corrupt repo) cannot pin
    // provenance; record it as repo-missing rather than emitting an "ok" record
    // with a null commit (#195 review).
    const record = baseRecord({
      runId,
      selectedAt,
      sourceRepo,
      sourceRoot,
      catalogRelpath,
      commit: null,
      discoveryInfo: discovery("repo-missing", { fallback: "proceeded-without-skills", error: commitResult.error }),
      noRelevantSkill: false,
      selections: [],
    });
    assertValidRecord(record);
    return record;
  }
  const commit = commitResult.stdout;
  const statusResult = await git({ skillsRoot, args: ["status", "--porcelain"], runCommand });
  if (!statusResult.ok) {
    // A status read failure (corrupt or inaccessible index) means cleanliness
    // was never established — record it as an in-band discovery failure rather
    // than falling through to an "ok" record claiming a clean repo (#195 review).
    const record = baseRecord({
      runId,
      selectedAt,
      sourceRepo,
      sourceRoot,
      catalogRelpath,
      commit,
      discoveryInfo: discovery("status-unreadable", {
        fallback: "proceeded-without-skills",
        error: statusResult.error,
      }),
      noRelevantSkill: false,
      selections: [],
    });
    assertValidRecord(record);
    return record;
  }
  const dirtyPaths = dirtyPathsFromPorcelain(statusResult.stdout);

  let catalog;
  try {
    catalog = await readCatalog({ skillsRoot, catalogRelpath });
  } catch (err) {
    const record = baseRecord({
      runId,
      selectedAt,
      sourceRepo,
      sourceRoot,
      catalogRelpath,
      commit,
      discoveryInfo: discovery("catalog-unreadable", {
        fallback: "proceeded-without-skills",
        dirtyPaths,
        error: err.message,
      }),
      noRelevantSkill: false,
      selections: [],
    });
    assertValidRecord(record);
    return record;
  }

  const catalogEntries = parseCatalog(catalog, { skillsRoot, catalogRelpath });
  const selections = [];
  for (const selected of selectedSkills) {
    const paths = catalogEntries.get(selected.name);
    if (!paths) throw new Error(`selected skill ${selected.name} is not listed in the catalog`);
    if (paths.length > 1) {
      // A selected name cataloged at multiple distinct paths is ambiguous
      // provenance — the record could pin a different SKILL.md than the one
      // the operator meant. Fail discovery in-band (#195 review; skills-policy
      // treats same-name different-content as a hard failure).
      const record = baseRecord({
        runId,
        selectedAt,
        sourceRepo,
        sourceRoot,
        catalogRelpath,
        commit,
        discoveryInfo: discovery("catalog-ambiguous", {
          fallback: "proceeded-without-skills",
          dirtyPaths,
          error: `selected skill ${selected.name} is cataloged at multiple paths: ${paths.join(", ")}`,
        }),
        noRelevantSkill: false,
        selections: [],
      });
      assertValidRecord(record);
      return record;
    }
    const relpath = paths[0];
    let skillBody;
    try {
      skillBody = await readFile(safeJoin(skillsRoot, relpath), "utf8");
    } catch (err) {
      // A cataloged-but-unreadable SKILL.md (stale catalog, permissions) is a
      // discovery failure, recorded in-band like catalog-unreadable instead of
      // letting the advisory skill layer block the mechanical lane (#195 review).
      const record = baseRecord({
        runId,
        selectedAt,
        sourceRepo,
        sourceRoot,
        catalogRelpath,
        commit,
        discoveryInfo: discovery("skill-unreadable", {
          fallback: "proceeded-without-skills",
          dirtyPaths,
          error: `selected skill ${selected.name} at ${relpath}: ${err.message}`,
        }),
        noRelevantSkill: false,
        selections: [],
      });
      assertValidRecord(record);
      return record;
    }
    selections.push({
      name: selected.name,
      relpath,
      skillSha256: contentFingerprint(skillBody),
      whySelected: selected.whySelected,
    });
  }

  const record = baseRecord({
    runId,
    selectedAt,
    sourceRepo,
    sourceRoot,
    catalogRelpath,
    commit,
    discoveryInfo: dirtyPaths.length
      ? discovery("repo-dirty", { fallback: "recorded-dirty-provenance", dirtyPaths })
      : discovery("ok"),
    noRelevantSkill,
    selections,
  });
  assertValidRecord(record);
  return record;
}
