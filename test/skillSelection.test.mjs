import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentFingerprint } from "../src/server/decisions/decisionDoc.mjs";
import { buildSkillSelectionRecord, validateSkillSelection } from "../src/server/skills/skillSelection.mjs";

const NOW = "2026-06-11T12:00:00.000Z";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function makeSkillsRepo({ catalog = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "archon-skill-selection-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "shared", "open"), { recursive: true });
  await mkdir(join(root, "shared", "test-driven-development"), { recursive: true });
  await writeFile(join(root, "shared", "open", "SKILL.md"), "---\nname: open\n---\r\n# Open\r\nUse before implementation.\r\n", "utf8");
  await writeFile(
    join(root, "shared", "test-driven-development", "SKILL.md"),
    "---\nname: test-driven-development\n---\n# TDD\nWrite the test first.\n",
    "utf8",
  );
  if (catalog) {
    await writeFile(
      join(root, "docs", "skill-catalog.md"),
      [
        "# Skill Catalog",
        "",
        "- [`open`](../shared/open/SKILL.md) - Starts a work session.",
        "- [`test-driven-development`](../shared/test-driven-development/SKILL.md) - Requires tests before code.",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "agent@example.test"]);
  git(root, ["config", "user.name", "Archon Agent"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "chore: seed skills"]);
  return { root, commit: git(root, ["rev-parse", "HEAD"]) };
}

test("buildSkillSelectionRecord records clean selected skills with LF-normalized hashes", async () => {
  const repo = await makeSkillsRepo();

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "ok");
  assert.equal(record.source.commit, repo.commit);
  assert.equal(record.noRelevantSkill, false);
  assert.equal(record.selections[0].name, "open");
  assert.equal(record.selections[0].relpath, "shared/open/SKILL.md");
  assert.equal(
    record.selections[0].skillSha256,
    contentFingerprint("---\nname: open\n---\n# Open\nUse before implementation.\n"),
  );
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord records dirty skills repo without blocking selection", async () => {
  const repo = await makeSkillsRepo();
  await writeFile(join(repo.root, "shared", "open", "SKILL.md"), "---\nname: open\n---\n# Open\nLocally edited.\n", "utf8");

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "repo-dirty");
  assert.equal(record.discovery.fallback, "recorded-dirty-provenance");
  assert.deepEqual(record.discovery.dirtyPaths, ["shared/open/SKILL.md"]);
  assert.equal(record.selections.length, 1);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord represents no relevant skill as first-class provenance", async () => {
  const repo = await makeSkillsRepo();

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    noRelevantSkill: true,
    selectedSkills: [],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "ok");
  assert.equal(record.noRelevantSkill, true);
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord falls back when the catalog is unreadable", async () => {
  const repo = await makeSkillsRepo({ catalog: false });

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "catalog-unreadable");
  assert.equal(record.discovery.fallback, "proceeded-without-skills");
  assert.match(record.discovery.error, /ENOENT/);
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord falls back when the skills repo is missing", async () => {
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: join(tmpdir(), "archon-skill-selection-missing"),
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "repo-missing");
  assert.equal(record.source.commit, null);
  assert.equal(record.discovery.fallback, "proceeded-without-skills");
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord rejects selected skills absent from the catalog allowlist", async () => {
  const repo = await makeSkillsRepo();

  await assert.rejects(
    buildSkillSelectionRecord({
      runId: "run-188",
      skillsRoot: repo.root,
      selectedSkills: [{ name: "missing", whySelected: "This should not be accepted." }],
      now: () => NOW,
    }),
    /selected skill missing is not listed in the catalog/,
  );
});
