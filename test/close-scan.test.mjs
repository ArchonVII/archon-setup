import { test } from "node:test";
import assert from "node:assert/strict";

import { decideNodeTest } from "../scripts/close/scan-complete.mjs";

// archon-setup#286 lockstep: archon-setup's OWN root close tooling
// (scripts/close/scan-complete.mjs, mirrored from the repo-template snapshot via
// `npm run agent:self-apply`) must distinguish an ABSENT package.json (skip the
// local node-test green, matching the gate's `npm run --if-present`) from a
// PRESENT-BUT-UNPARSEABLE one (RUN `npm test` so the EJSONPARSE the required gate
// hits surfaces locally instead of being masked green-by-skip). The original
// `hasNpmScript` swallowed JSON.parse errors and conflated the two states.

test("decideNodeTest distinguishes absent / unparseable / present package.json (#286)", () => {
  const throwing = () => {
    throw new SyntaxError("Unexpected token } in JSON");
  };

  // Absent package.json -> skip green (matches the gate's `npm run --if-present`).
  assert.deepEqual(decideNodeTest({ exists: false, readPackageJson: throwing }), {
    run: false,
    reason: "no-package-json",
  });

  // Present but MALFORMED -> must RUN npm test so the EJSONPARSE surfaces exactly
  // as the required gate sees it, instead of being masked green-by-skip.
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: throwing }), {
    run: true,
    reason: "unparseable-package-json",
  });

  // Present, no `test` script -> skip green (baseline'd repo).
  assert.deepEqual(
    decideNodeTest({ exists: true, readPackageJson: () => ({ scripts: { build: "x" } }) }),
    { run: false, reason: "no-test-script" },
  );
  assert.deepEqual(decideNodeTest({ exists: true, readPackageJson: () => ({}) }), {
    run: false,
    reason: "no-test-script",
  });
  // Whitespace-only test script is treated as absent.
  assert.deepEqual(
    decideNodeTest({ exists: true, readPackageJson: () => ({ scripts: { test: "   " } }) }),
    { run: false, reason: "no-test-script" },
  );

  // Present WITH a real `test` script -> run.
  assert.deepEqual(
    decideNodeTest({ exists: true, readPackageJson: () => ({ scripts: { test: "node --test" } }) }),
    { run: true, reason: "has-test-script" },
  );
});
