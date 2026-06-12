import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archonHome,
  defaultOverlayPath,
  loadEffectiveRegistry,
  metaLayerIds,
  removeOverlayEntry,
  upsertOverlayEntry,
} from "../src/server/ecosystem/registryStore.mjs";

// #214: seed + overlay effective-registry semantics. Seed is tracked source;
// every mutation goes to the overlay; meta-layer ids are locked; removal is a
// tombstone by default.

const NOW = "2026-06-12T00:00:00.000Z";

function seedDoc() {
  return {
    schemaVersion: 1,
    updatedAt: "2026-06-12",
    description: "test seed",
    repositories: [
      {
        id: "hub",
        name: "hub",
        owner: "ArchonVII",
        repo: "hub",
        path: "C:/GitHub/hub",
        lifecycle: "active",
        healthTarget: true,
        role: "ecosystem-health-hub",
        reservedPorts: [5180, 5181],
      },
      {
        id: "app-one",
        name: "app-one",
        owner: "ArchonVII",
        repo: "app-one",
        path: "C:/GitHub/app-one",
        lifecycle: "active",
        healthTarget: true,
        role: "application",
        reservedPorts: [5182],
      },
    ],
  };
}

function mapDoc() {
  return { schemaVersion: 1, repos: [{ id: "hub", owner: "ArchonVII", repo: "hub" }] };
}

async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "registry-store-"));
  const seedPath = join(dir, "seed.json");
  const overlayPath = join(dir, "home", "repo-registry.json");
  const mapPath = join(dir, "ecosystem-map.json");
  await writeFile(seedPath, JSON.stringify(seedDoc(), null, 2));
  await writeFile(mapPath, JSON.stringify(mapDoc(), null, 2));
  return { dir, seedPath, overlayPath, mapPath };
}

function appEntry(overrides = {}) {
  return {
    id: "app-two",
    name: "app-two",
    owner: "ArchonVII",
    repo: "app-two",
    path: "D:/code/app-two",
    lifecycle: "active",
    healthTarget: true,
    role: "application",
    reservedPorts: [5190],
    ...overrides,
  };
}

test("loadEffectiveRegistry: seed only — origin stamped, summary counts", async () => {
  const { seedPath, overlayPath } = await makeFixture();
  const registry = await loadEffectiveRegistry({ seedPath, overlayPath });
  assert.equal(registry.overlayPresent, false);
  assert.deepEqual(registry.summary, { active: 2, inactive: 0, removed: 0, total: 2 });
  assert.ok(registry.repositories.every((entry) => entry.origin === "seed"));
});

test("upsertOverlayEntry adds a repo to the overlay and never touches the seed", async () => {
  const { seedPath, overlayPath, mapPath } = await makeFixture();
  const before = await readFile(seedPath, "utf8");

  const result = await upsertOverlayEntry(appEntry(), { seedPath, overlayPath, mapPath, now: NOW });
  assert.equal(result.entry.addedAt, "2026-06-12");

  assert.equal(await readFile(seedPath, "utf8"), before, "seed must be untouched");
  const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
  assert.deepEqual(overlay.repositories.map((e) => e.id), ["app-two"]);

  const registry = await loadEffectiveRegistry({ seedPath, overlayPath });
  const added = registry.repositories.find((e) => e.id === "app-two");
  assert.equal(added.origin, "overlay");
  assert.deepEqual(registry.summary, { active: 3, inactive: 0, removed: 0, total: 3 });
});

test("an overlay entry with a seed id replaces the seed entry wholesale", async () => {
  const { seedPath, overlayPath, mapPath } = await makeFixture();
  await upsertOverlayEntry(
    appEntry({ id: "app-one", repo: "app-one", name: "app-one", path: "D:/moved/app-one", reservedPorts: [5200], notes: "moved" }),
    { seedPath, overlayPath, mapPath, now: NOW },
  );
  const registry = await loadEffectiveRegistry({ seedPath, overlayPath });
  const entry = registry.repositories.find((e) => e.id === "app-one");
  assert.equal(entry.origin, "overlay");
  assert.equal(entry.path, "D:/moved/app-one");
  assert.deepEqual(entry.reservedPorts, [5200]);
  assert.equal(registry.summary.total, 2, "replacement, not addition");
});

test("port policy is enforced at the store gate: 5173 and conflicts are refused", async () => {
  const { seedPath, overlayPath, mapPath } = await makeFixture();
  await assert.rejects(
    upsertOverlayEntry(appEntry({ reservedPorts: [5173] }), { seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "port-forbidden",
  );
  await assert.rejects(
    upsertOverlayEntry(appEntry({ reservedPorts: [5182] }), { seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "port-conflict",
  );
  // Self-update keeps its own ports without conflicting with itself.
  const ok = await upsertOverlayEntry(
    appEntry({ id: "app-one", path: "C:/GitHub/app-one", reservedPorts: [5182] }),
    { seedPath, overlayPath, mapPath, now: NOW },
  );
  assert.deepEqual(ok.entry.reservedPorts, [5182]);
});

test("meta-layer ids: owner/repo/role locked, removal refused either way", async () => {
  const { seedPath, overlayPath, mapPath } = await makeFixture();
  await assert.rejects(
    upsertOverlayEntry(
      appEntry({ id: "hub", repo: "hub", owner: "ArchonVII", role: "application", path: "C:/GitHub/hub" }),
      { seedPath, overlayPath, mapPath, now: NOW },
    ),
    (err) => err.code === "meta-layer-locked",
  );
  // Editable fields still pass for a meta-layer id.
  const ok = await upsertOverlayEntry(
    appEntry({ id: "hub", repo: "hub", role: "ecosystem-health-hub", path: "C:/GitHub/hub", reservedPorts: [5180, 5181], notes: "annotated" }),
    { seedPath, overlayPath, mapPath, now: NOW },
  );
  assert.equal(ok.entry.notes, "annotated");

  await assert.rejects(
    removeOverlayEntry("hub", { seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "meta-layer-locked",
  );
  await assert.rejects(
    removeOverlayEntry("hub", { hard: true, seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "meta-layer-locked",
  );
});

test("removal: soft tombstone for seed entries, hard delete only for overlay-only entries", async () => {
  const { seedPath, overlayPath, mapPath } = await makeFixture();

  const soft = await removeOverlayEntry("app-one", { reason: "retired", seedPath, overlayPath, mapPath, now: NOW });
  assert.equal(soft.removed, "soft");
  assert.equal(soft.entry.lifecycle, "removed");
  assert.equal(soft.entry.removedAt, "2026-06-12");

  let registry = await loadEffectiveRegistry({ seedPath, overlayPath });
  assert.deepEqual(registry.summary, { active: 1, inactive: 0, removed: 1, total: 2 });
  const tomb = registry.repositories.find((e) => e.id === "app-one");
  assert.equal(tomb.healthTarget, false);

  await assert.rejects(
    removeOverlayEntry("app-one", { hard: true, seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "hard-delete-seed-entry",
  );

  await upsertOverlayEntry(appEntry(), { seedPath, overlayPath, mapPath, now: NOW });
  const hard = await removeOverlayEntry("app-two", { hard: true, seedPath, overlayPath, mapPath, now: NOW });
  assert.equal(hard.removed, "hard");
  registry = await loadEffectiveRegistry({ seedPath, overlayPath });
  assert.equal(registry.repositories.some((e) => e.id === "app-two"), false);
});

test("unknown id and invalid entries fail closed", async () => {
  const { seedPath, overlayPath, mapPath } = await makeFixture();
  await assert.rejects(
    removeOverlayEntry("nope", { seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "unknown-repo",
  );
  await assert.rejects(
    upsertOverlayEntry(appEntry({ role: "mystery" }), { seedPath, overlayPath, mapPath, now: NOW }),
    (err) => err.code === "registry-schema-invalid",
  );
  // A corrupt overlay refuses to load rather than guessing.
  const dir = await mkdtemp(join(tmpdir(), "registry-store-bad-"));
  const seed2 = join(dir, "seed.json");
  await writeFile(seed2, JSON.stringify(seedDoc(), null, 2));
  const badOverlay = join(dir, "overlay.json");
  await writeFile(badOverlay, JSON.stringify({ schemaVersion: 1, repositories: [{ id: "x" }] }));
  await assert.rejects(
    loadEffectiveRegistry({ seedPath: seed2, overlayPath: badOverlay }),
    (err) => err.code === "registry-schema-invalid",
  );
});

test("ARCHON_HOME overrides the overlay home", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "archon-home-"));
  const prev = process.env.ARCHON_HOME;
  process.env.ARCHON_HOME = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.ARCHON_HOME;
    else process.env.ARCHON_HOME = prev;
  });
  assert.equal(archonHome(), dir);
  assert.equal(defaultOverlayPath(), join(dir, "repo-registry.json"));
});

test("metaLayerIds reads config/ecosystem-map.json (real file)", async () => {
  const ids = await metaLayerIds();
  for (const id of ["org-defaults", "github-workflows", "repo-template", "archon-setup", "skills-review"]) {
    assert.ok(ids.has(id), `${id} should be a meta-layer id`);
  }
});
