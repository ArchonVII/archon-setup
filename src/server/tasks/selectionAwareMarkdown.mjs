import { posix } from "node:path";

import { parseDocMap } from "../../snapshots/repo-template/scripts/docs/lib.mjs";

const MARKDOWN_LINK = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SEED_PATHS = new Set(["docs/CANON.md", "docs/INDEX.md"]);

function patternMatchesInstalledPath(pattern, installedPaths) {
  const normalized = normalizeRepoPath(pattern);
  if (!normalized.includes("*")) return installedPaths.has(normalized);
  const expression = normalized
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  const matcher = new RegExp(`^${expression}$`);
  return [...installedPaths].some((path) => matcher.test(path));
}

function quoteYaml(value) {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
  return JSON.stringify(String(value));
}

function renderListSection(name, entries, keys) {
  const lines = [`${name}:`];
  for (const entry of entries) {
    const presentKeys = keys.filter((key) => entry[key] !== undefined);
    if (presentKeys.length === 0) continue;
    lines.push(`  - ${presentKeys[0]}: ${quoteYaml(entry[presentKeys[0]])}`);
    for (const key of presentKeys.slice(1)) lines.push(`    ${key}: ${quoteYaml(entry[key])}`);
  }
  return lines;
}

function serializeDocMap(docMap) {
  const lines = [`version: ${docMap.version}`, ""];
  lines.push(...renderListSection("generated", docMap.generated, ["path", "class", "generator", "block", "inputs"]), "");
  lines.push(...renderListSection("checked", docMap.checked, ["path", "owns", "checks"]), "");
  lines.push(...renderListSection("human", docMap.human, ["path", "heal_when"]), "");
  lines.push("required:", "  base:");
  for (const path of docMap.required.base) lines.push(`    - ${quoteYaml(path)}`);
  lines.push("", "code_roots:");
  for (const [root, owner] of Object.entries(docMap.code_roots)) lines.push(`  ${root}: ${quoteYaml(owner)}`);
  return `${lines.join("\n")}\n`;
}

// The provider doc-map describes repo-template's complete surface. Consumers
// receive only the entries their selected install closure can actually own.
// Rendered outputs (currently docs/STATUS.md) are retained because they are
// created on demand; committed/release outputs require a snapshot-managed
// target so a generic README without the provider marker is never promised.
export function renderSelectionAwareDocMap(
  body,
  installedPathValues,
  managedSnapshotPathValues = installedPathValues,
  additionalCodeRootValues = []
) {
  const installedPaths = new Set([...installedPathValues].map(normalizeRepoPath));
  const managedSnapshotPaths = new Set([...managedSnapshotPathValues].map(normalizeRepoPath));
  const source = parseDocMap(body);
  const generated = source.generated.filter((entry) =>
    entry.class === "rendered" || managedSnapshotPaths.has(normalizeRepoPath(entry.path))
  );
  const checked = source.checked.filter((entry) => patternMatchesInstalledPath(entry.path, installedPaths));
  const checkedPaths = new Set(checked.map((entry) => normalizeRepoPath(entry.path)));
  const human = source.human.filter((entry) => patternMatchesInstalledPath(entry.path, installedPaths));
  const required = {
    base: source.required.base.filter((path) => installedPaths.has(normalizeRepoPath(path))),
  };
  const codeRoots = Object.fromEntries(
    Object.entries(source.code_roots).filter(([, owner]) =>
      owner === "self" || owner === "unmapped_ok" || checkedPaths.has(normalizeRepoPath(owner))
    )
  );
  const canon = checked.find((entry) => normalizeRepoPath(entry.path) === "docs/CANON.md");
  if (canon) {
    canon.owns = [...new Set(canon.owns || [])];
    const additionalRoots = [...new Set(additionalCodeRootValues)]
      .map(normalizeRepoPath)
      .filter((root) => /^[A-Za-z0-9_-]+$/.test(root) && !root.includes("/"))
      .sort();
    for (const root of additionalRoots) {
      if (Object.hasOwn(codeRoots, root)) continue;
      codeRoots[root] = "docs/CANON.md";
      canon.owns.push(`${root}/**`);
    }
  }
  return serializeDocMap({ version: source.version, generated, checked, human, required, code_roots: codeRoots });
}

export function docMapGeneratorCommands(body) {
  return [...new Set(parseDocMap(body).generated.map((entry) => entry.generator).filter(Boolean))].sort();
}

export function normalizeRepoPath(path) {
  return posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function markdownTarget(rawTarget, sourcePath) {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const close = target.indexOf(">");
    if (close < 0) return null;
    target = target.slice(1, close);
  } else {
    target = target.split(/\s+/, 1)[0];
  }
  target = target.split("#", 1)[0].split("?", 1)[0];
  if (!target || target.startsWith("#") || target.startsWith("/") || EXTERNAL_SCHEME.test(target)) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  return normalizeRepoPath(posix.join(posix.dirname(sourcePath), target));
}

export function relativeMarkdownTargets(body, sourcePath) {
  const withoutCodeExamples = body
    .replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/`+[^`\n]*`+/g, (span) => span.replace(/[^\n]/g, " "));
  const targets = new Set();
  for (const match of withoutCodeExamples.matchAll(MARKDOWN_LINK)) {
    const target = markdownTarget(match[1], sourcePath);
    if (target) targets.add(target);
  }
  return [...targets].sort();
}

function hasMissingTarget(body, sourcePath, installedPaths) {
  return relativeMarkdownTargets(body, sourcePath).some((target) => !installedPaths.has(target));
}

function filterFrontmatterWikilinks(frontmatter, sourcePath, installedPaths) {
  return frontmatter
    .split("\n")
    .filter((line) => {
      const match = line.match(/^\s*-\s*["']?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]["']?\s*$/);
      if (!match) return true;
      const target = normalizeRepoPath(posix.join(posix.dirname(sourcePath), `${match[1]}.md`));
      return installedPaths.has(target);
    })
    .join("\n");
}

function splitFrontmatter(body) {
  if (!body.startsWith("---\n")) return { frontmatter: "", content: body };
  const end = body.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: "", content: body };
  return {
    frontmatter: body.slice(0, end + 5),
    content: body.slice(end + 5),
  };
}

function renderIndexForSelection(content, sourcePath, installedPaths) {
  const linkedLines = content
    .split("\n")
    .filter((line) => !hasMissingTarget(line, sourcePath, installedPaths));
  const withoutEmptyGroups = linkedLines.filter((line, index) => {
    if (!line.startsWith("### ")) return true;
    for (let cursor = index + 1; cursor < linkedLines.length; cursor += 1) {
      const candidate = linkedLines[cursor];
      if (candidate.startsWith("#") || candidate.startsWith("<!-- END ")) return false;
      if (candidate.startsWith("- ")) return true;
    }
    return false;
  });
  return withoutEmptyGroups.join("\n").replace(/\n{3,}/g, "\n\n");
}

// CANON.md and INDEX.md are seed-only consumer documents. The provider copies
// describe repo-template's full documentation tree, so a smaller onboarding
// selection must remove navigation to capabilities it did not install. Existing
// consumer copies are never rewritten by writeDocSystem; this renderer is used
// only when the seed is first created and by the pre-apply selection validator.
export function renderSelectionAwareSeed(body, sourcePath, installedPathValues) {
  const normalizedSource = normalizeRepoPath(sourcePath);
  if (!SEED_PATHS.has(normalizedSource)) return body;

  const installedPaths = new Set([...installedPathValues].map(normalizeRepoPath));
  const { frontmatter, content } = splitFrontmatter(body.replaceAll("\r\n", "\n"));
  const renderedFrontmatter = frontmatter
    ? filterFrontmatterWikilinks(frontmatter, normalizedSource, installedPaths)
    : "";

  let renderedContent;
  if (normalizedSource === "docs/INDEX.md") {
    renderedContent = renderIndexForSelection(content, normalizedSource, installedPaths);
  } else {
    renderedContent = content
      .split(/\n{2,}/)
      .filter((paragraph) => !hasMissingTarget(paragraph, normalizedSource, installedPaths))
      .join("\n\n");
  }

  return `${renderedFrontmatter}${renderedContent}`;
}
