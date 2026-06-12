import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #214 sync gate: every meta-layer repo in config/ecosystem-map.json must
// exist in the seed registry with matching identity fields, so the map and
// the registry cannot drift apart silently. The map never gains application
// repos (coordination isolation); the registry is the superset.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadJson(path) {
  // CRLF-safe on Windows checkouts (autocrlf): JSON.parse ignores \r in
  // whitespace, but normalize string values when comparing paths below.
  return JSON.parse(readFileSync(path, "utf8"));
}

// Path comparison: forward slashes, no trailing slash, case-insensitive drive
// letters (Windows checkouts mix C:/ and c:/ spellings).
function normalizePath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

const map = loadJson(join(ROOT, "config", "ecosystem-map.json"));
const seed = loadJson(join(ROOT, "src", "server", "ecosystem", "repoRegistry.json"));
const seedById = new Map(seed.repositories.map((entry) => [entry.id, entry]));

test("every ecosystem-map repo exists in the seed registry with matching identity", () => {
  assert.ok(map.repos.length >= 5, "map should describe the meta layer");
  for (const repo of map.repos) {
    const entry = seedById.get(repo.id);
    assert.ok(entry, `map repo "${repo.id}" missing from the seed registry`);
    assert.equal(entry.owner, repo.owner, `${repo.id}: owner mismatch`);
    assert.equal(entry.repo, repo.repo, `${repo.id}: repo mismatch`);
    assert.equal(entry.role, repo.role, `${repo.id}: role mismatch`);
    assert.equal(
      normalizePath(entry.path),
      normalizePath(repo.localPath),
      `${repo.id}: path mismatch (registry "${entry.path}" vs map "${repo.localPath}")`,
    );
  }
});

test("meta-layer entries in the seed are active health targets", () => {
  for (const repo of map.repos) {
    const entry = seedById.get(repo.id);
    assert.equal(entry.lifecycle, "active", `${repo.id} must stay active in the seed`);
    assert.equal(entry.healthTarget, true, `${repo.id} must stay a health target`);
  }
});
