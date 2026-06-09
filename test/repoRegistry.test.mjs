import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REPO_REGISTRY_PATH,
  activeRepoEntries,
  loadRepoRegistry,
  normalizeRepoRegistry,
} from "../src/server/ecosystem/repoRegistry.mjs";

test("normalizeRepoRegistry separates active health targets from inactive entries", () => {
  const registry = normalizeRepoRegistry({
    repositories: [
      { id: "active", name: "active", path: "C:/repo/active", lifecycle: "active", healthTarget: true },
      { id: "inactive", name: "inactive", path: "C:/repo/inactive", lifecycle: "inactive", healthTarget: false },
    ],
  }, "registry.json");

  assert.equal(registry.summary.active, 1);
  assert.equal(registry.summary.inactive, 1);
  assert.deepEqual(activeRepoEntries(registry).map((entry) => entry.id), ["active"]);
});

test("default repo registry records the corrected active and inactive repo set", async () => {
  const registry = await loadRepoRegistry(DEFAULT_REPO_REGISTRY_PATH);
  assert.equal(registry.summary.active, 9);
  assert.equal(registry.summary.inactive, 1);

  const activeIds = new Set(activeRepoEntries(registry).map((entry) => entry.id));
  for (const id of [
    "archon",
    "archon-setup",
    "github-workflows",
    "repo-template",
    "org-defaults",
    "pigafetta",
    "jma-history",
    "skills-review",
    "hudson-bend",
  ]) {
    assert.ok(activeIds.has(id), `${id} should be an active health target`);
  }

  const jmaUi = registry.repositories.find((entry) => entry.id === "jma-ui");
  assert.equal(jmaUi.lifecycle, "inactive");
  assert.equal(jmaUi.healthTarget, false);
});
