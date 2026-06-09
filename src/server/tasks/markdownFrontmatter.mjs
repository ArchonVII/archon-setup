function detectEol(value) {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeMarkdown(value) {
  return String(value).replace(/\r\n?/g, "\n").trimEnd();
}

function frontmatterMatch(value) {
  return String(value).match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
}

export function stripYamlFrontmatter(value) {
  const match = frontmatterMatch(value);
  if (!match) return String(value);
  return String(value).slice(match[0].length).replace(/^(?:\r?\n)+/, "");
}

export function markdownMatchesSnapshotAllowingFrontmatter(actual, snapshot) {
  return normalizeMarkdown(actual) === normalizeMarkdown(snapshot)
    || normalizeMarkdown(stripYamlFrontmatter(actual)) === normalizeMarkdown(snapshot);
}

export function applySnapshotPreservingFrontmatter(existing, snapshot) {
  const match = frontmatterMatch(existing);
  if (!match) return snapshot;

  const eol = detectEol(existing);
  const frontmatter = match[0].replace(/(?:\r?\n)+$/, "");
  const snapshotBody = String(snapshot).replace(/\r\n?/g, "\n").replace(/^(?:\n)+/, "");
  return `${frontmatter}${eol}${eol}${eol === "\n" ? snapshotBody : snapshotBody.replace(/\n/g, eol)}`;
}
