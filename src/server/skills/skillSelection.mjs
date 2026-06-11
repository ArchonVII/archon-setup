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

export function validateSkillSelection(record) {
  return validate(SKILL_SELECTION_SCHEMA, record);
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
  const entries = new Map();
  const linkPattern = /-\s+\[`([^`]+)`\]\(([^)]+)\)/g;
  for (const match of catalogBody.matchAll(linkPattern)) {
    const name = match[1];
    const link = match[2];
    const absoluteSkillPath = resolve(skillsRoot, catalogDir, link);
    const relpath = relpathInside(skillsRoot, absoluteSkillPath);
    if (!relpath || !relpath.endsWith("/SKILL.md")) continue;
    if (!entries.has(name)) entries.set(name, relpath);
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
  for (const selected of selectedSkills) {
    if (!selected.whySelected || !String(selected.whySelected).trim()) {
      throw new Error(`selected skill ${selected.name ?? "(unknown)"} is missing whySelected`);
    }
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
  const commit = commitResult.ok ? commitResult.stdout : null;
  const statusResult = await git({ skillsRoot, args: ["status", "--porcelain"], runCommand });
  const dirtyPaths = statusResult.ok ? dirtyPathsFromPorcelain(statusResult.stdout) : [];

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
    const relpath = catalogEntries.get(selected.name);
    if (!relpath) throw new Error(`selected skill ${selected.name} is not listed in the catalog`);
    const skillBody = await readFile(safeJoin(skillsRoot, relpath), "utf8");
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
