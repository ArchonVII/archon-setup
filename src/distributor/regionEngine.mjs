const STYLE_MARKERS = {
  markdown: {
    // A8: recognize the canonical `MANAGED` shape plus the legacy AGENTS shapes
    // (`MANAGED BLOCK` from managedMarkdownBlock.mjs, `GLOBAL UPDATE` from
    // globalUpdates.mjs) as known regions, so delegation never reclassifies an
    // existing AGENTS block as a malformed/unknown marker. Longest keyword first.
    begin: /^\s*<!--\s*BEGIN ARCHONVII (?:MANAGED BLOCK|GLOBAL UPDATE|MANAGED):\s*([A-Za-z0-9._-]+)\s*-->\s*$/,
    end: /^\s*<!--\s*END ARCHONVII (?:MANAGED BLOCK|GLOBAL UPDATE|MANAGED):\s*([A-Za-z0-9._-]+)\s*-->\s*$/,
  },
  hash: {
    begin: /^\s*#\s*BEGIN ARCHONVII MANAGED:\s*([A-Za-z0-9._-]+)\s*$/,
    end: /^\s*#\s*END ARCHONVII MANAGED:\s*([A-Za-z0-9._-]+)\s*$/,
  },
};

export function parseRegions(body, style) {
  const markers = STYLE_MARKERS[style];
  if (!markers) throw new Error(`unsupported managed-region style: ${style}`);

  const regions = [];
  const diagnostics = [];
  const seenIds = new Set();
  let open = null;

  for (const line of linesWithOffsets(body)) {
    const begin = line.text.match(markers.begin);
    if (begin) {
      if (open) {
        diagnostics.push({ kind: "nested", id: begin[1], parentId: open.id, line: line.number });
        continue;
      }
      open = { id: begin[1], innerStart: line.fullEnd, startLine: line.number };
      continue;
    }

    const end = line.text.match(markers.end);
    if (end) {
      if (open && end[1] === open.id) {
        const innerEnd = trimBoundaryLineBreak(body, open.innerStart, line.start);
        if (seenIds.has(open.id)) {
          diagnostics.push({ kind: "duplicate-id", id: open.id, line: open.startLine });
        }
        seenIds.add(open.id);
        regions.push({
          id: open.id,
          innerStart: open.innerStart,
          innerEnd,
          inner: body.slice(open.innerStart, innerEnd),
          startLine: open.startLine,
          endLine: line.number,
        });
        open = null;
      }
      continue;
    }

    if (line.text.includes("ARCHONVII MANAGED")) {
      diagnostics.push({ kind: "malformed-marker", line: line.number });
    }
  }

  if (open) {
    diagnostics.push({ kind: "missing-end", id: open.id, line: open.startLine });
  }

  return { regions, diagnostics };
}

export function replaceRegionInner(body, id, newInner, style) {
  const parsed = parseRegions(body, style);
  if (parsed.diagnostics.length) {
    throw new Error(`cannot replace region "${id}" in malformed managed regions`);
  }

  const matches = parsed.regions.filter((region) => region.id === id);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one managed region "${id}", found ${matches.length}`);
  }

  const region = matches[0];
  const next = `${body.slice(0, region.innerStart)}${newInner}${body.slice(region.innerEnd)}`;
  return { body: next, changed: next !== body };
}

export function reconcile(consumerBody, desired, style, options = {}) {
  const parsed = parseRegions(consumerBody, style);
  if (parsed.diagnostics.length) {
    return { status: "conflict", changed: false, result: null, regions: [], diagnostics: parsed.diagnostics };
  }

  // A1: the unknown/deprecated check runs against the full catalog (knownIds),
  // independent of which regions this run selected (desired). When no catalog is
  // supplied, the desired set is the only thing we know about.
  const knownIds = new Set(options.knownIds ?? desired.map((region) => region.id));
  let result = consumerBody;
  let changed = false;
  const regions = [];
  let hasAdoptionNeeded = false;
  let hasConflict = false;

  for (const consumerRegion of parsed.regions) {
    // Known ids are replaced below (if desired) or left untouched and unflagged
    // (known-but-unselected, e.g. filtered out by --id). Only ids absent from the
    // full catalog are conflicts (A1).
    if (knownIds.has(consumerRegion.id)) continue;
    hasConflict = true;
    regions.push({ id: consumerRegion.id, status: "conflict", reason: "unknown-id", changed: false });
  }

  for (const desiredRegion of desired) {
    if (!parsed.regions.some((region) => region.id === desiredRegion.id)) {
      hasAdoptionNeeded = true;
      regions.push({ id: desiredRegion.id, status: "adoption_needed", changed: false });
      continue;
    }

    const replaced = replaceRegionInner(result, desiredRegion.id, desiredRegion.inner, style);
    result = replaced.body;
    changed = changed || replaced.changed;
    regions.push({ id: desiredRegion.id, status: "clean_apply", changed: replaced.changed });
  }

  if (hasConflict) {
    return { status: "conflict", changed: false, result: null, regions, diagnostics: [] };
  }

  if (hasAdoptionNeeded) {
    return { status: "adoption_needed", changed: false, result: null, regions, diagnostics: [] };
  }

  return { status: "clean_apply", changed, result, regions, diagnostics: [] };
}

function trimBoundaryLineBreak(body, min, end) {
  if (end <= min) return end;
  if (body[end - 1] === "\n") {
    const candidate = body[end - 2] === "\r" ? end - 2 : end - 1;
    return Math.max(min, candidate);
  }
  if (body[end - 1] === "\r") return Math.max(min, end - 1);
  return end;
}

function* linesWithOffsets(body) {
  let offset = 0;
  let number = 1;

  while (offset < body.length) {
    const start = offset;
    let end = body.length;
    let fullEnd = body.length;

    for (let i = offset; i < body.length; i += 1) {
      if (body[i] === "\n") {
        end = i;
        fullEnd = i + 1;
        break;
      }
      if (body[i] === "\r") {
        end = i;
        fullEnd = body[i + 1] === "\n" ? i + 2 : i + 1;
        break;
      }
    }

    yield { text: body.slice(start, end), start, fullEnd, number };
    offset = fullEnd;
    number += 1;
  }
}
