// Applicability gating (NFR): the region engine never decides whether a file
// belongs in a repo. This predicate does, seeded from the catalog entry's
// appliesToDefault (A4/A5). Decisions are explainable: every result carries a
// stable reason string. Unknown policies fail closed.
export function appliesTo(entry, { targetExists }) {
  switch (entry.appliesToDefault) {
    case "existing-file-only":
      return targetExists
        ? { applies: true, reason: "target-file-exists" }
        : { applies: false, reason: "not-applicable" };
    case "always":
      return targetExists
        ? { applies: true, reason: "target-file-exists" }
        : { applies: true, reason: "applies-by-default" };
    default:
      return { applies: false, reason: "unknown-applies-to-default" };
  }
}
