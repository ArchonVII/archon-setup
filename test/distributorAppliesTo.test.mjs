import { test } from "node:test";
import assert from "node:assert/strict";

import { appliesTo } from "../src/distributor/appliesTo.mjs";

// NFR "Applicability gating": the engine never decides whether a file belongs
// in a repo — this predicate does, seeded from the entry's appliesToDefault.
// Every decision must be explainable (M0 acceptance criterion).

test("existing-file-only entries apply only when the target file exists", () => {
  const entry = { id: "x", appliesToDefault: "existing-file-only" };

  const present = appliesTo(entry, { targetExists: true });
  assert.equal(present.applies, true);
  assert.equal(present.reason, "target-file-exists");

  const absent = appliesTo(entry, { targetExists: false });
  assert.equal(absent.applies, false);
  assert.equal(absent.reason, "not-applicable");
});

test("always entries apply even when the target file is absent (file-create, A5)", () => {
  const entry = { id: "x", appliesToDefault: "always" };

  const absent = appliesTo(entry, { targetExists: false });
  assert.equal(absent.applies, true);
  assert.equal(absent.reason, "applies-by-default");
});

test("unknown appliesToDefault values fail closed with an explainable reason", () => {
  const entry = { id: "x", appliesToDefault: "mystery-mode" };

  const result = appliesTo(entry, { targetExists: true });
  assert.equal(result.applies, false);
  assert.equal(result.reason, "unknown-applies-to-default");
});
