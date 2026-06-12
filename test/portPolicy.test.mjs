import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FORBIDDEN_PORTS,
  STANDARD_DEV_PORT_RANGE,
  validateEntryPorts,
  validatePortAssignment,
} from "../src/server/ecosystem/portPolicy.mjs";

// #214 spec §4.5: explicit reservation lists, 5173 banned, conflicts checked
// against every non-removed registry entry.

const registry = {
  repositories: [
    { id: "hub", lifecycle: "active", reservedPorts: [5180, 5181] },
    { id: "app", lifecycle: "active", reservedPorts: [5182] },
    { id: "gone", lifecycle: "removed", reservedPorts: [5183] },
  ],
};

function codes(result) {
  return result.errors.map((e) => e.code);
}

test("5173 is always forbidden", () => {
  assert.ok(FORBIDDEN_PORTS.includes(5173));
  const result = validatePortAssignment([5173], registry);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ["port-forbidden"]);
});

test("conflicts with another entry's reservation are errors; removed tombstones free their ports", () => {
  const conflict = validatePortAssignment([5180], registry);
  assert.deepEqual(codes(conflict), ["port-conflict"]);
  assert.match(conflict.errors[0].detail, /"hub"/);

  const freed = validatePortAssignment([5183], registry);
  assert.equal(freed.ok, true, "ports of removed entries are reusable");
});

test("excludeId allows self-updates to keep their own ports", () => {
  const self = validatePortAssignment([5182, 5190], registry, { excludeId: "app" });
  assert.equal(self.ok, true);
});

test("invalid and duplicate ports are rejected; out-of-range is a warning only", () => {
  const invalid = validatePortAssignment([0, 70000, 5190.5], registry);
  assert.deepEqual(codes(invalid), ["port-invalid", "port-invalid", "port-invalid"]);

  const dup = validatePortAssignment([5190, 5190], registry);
  assert.deepEqual(codes(dup), ["port-duplicate"]);

  const outside = validatePortAssignment([8765], registry);
  assert.equal(outside.ok, true);
  assert.deepEqual(outside.warnings.map((w) => w.code), ["port-out-of-range"]);
  assert.ok(8765 > STANDARD_DEV_PORT_RANGE.max);
});

test("validateEntryPorts requires devServer.primaryPort to be reserved by the entry", () => {
  const bad = validateEntryPorts(
    { id: "new", reservedPorts: [5190], devServer: { kind: "vite", primaryPort: 5191 } },
    registry,
  );
  assert.equal(bad.ok, false);
  assert.deepEqual(codes(bad), ["dev-server-port-unreserved"]);

  const good = validateEntryPorts(
    { id: "new", reservedPorts: [5190], devServer: { kind: "vite", primaryPort: 5190 } },
    registry,
  );
  assert.equal(good.ok, true);
});
