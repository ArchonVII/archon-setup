import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contentFingerprint } from "../src/server/decisions/decisionDoc.mjs";
import { runCommand } from "../src/server/lib/commandRunner.mjs";
import { buildSkillSelectionRecord, validateSkillSelection } from "../src/server/skills/skillSelection.mjs";

const NOW = "2026-06-11T12:00:00.000Z";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function makeSkillsRepo({ catalog = true, extraCatalogLines = [] } = {}) {
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
        ...extraCatalogLines,
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

test("buildSkillSelectionRecord falls back in-band when a cataloged SKILL.md is unreadable", async () => {
  const repo = await makeSkillsRepo({
    extraCatalogLines: ["- [`ghost`](../shared/ghost/SKILL.md) - Catalog points at a file that no longer exists."],
  });

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "ghost", whySelected: "The stale catalog entry still names this skill as relevant." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "skill-unreadable");
  assert.equal(record.discovery.fallback, "proceeded-without-skills");
  assert.match(record.discovery.error, /selected skill ghost at shared\/ghost\/SKILL\.md/);
  assert.match(record.discovery.error, /ENOENT/);
  assert.equal(record.source.commit, repo.commit);
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord treats a repo with no readable HEAD as repo-missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "archon-skill-selection-unborn-"));
  git(root, ["init", "-b", "main"]);

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "repo-missing");
  assert.equal(record.source.commit, null);
  assert.equal(record.discovery.fallback, "proceeded-without-skills");
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("validateSkillSelection rejects missing commits except for repo-missing discovery", async () => {
  const repo = await makeSkillsRepo();
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  const tamperedOk = { ...record, source: { ...record.source, commit: null } };
  const checkedOk = validateSkillSelection(tamperedOk);
  assert.equal(checkedOk.valid, false);
  assert.ok(
    checkedOk.errors.some((e) => e.path === "source.commit" && /pinned 40-hex sha/.test(e.message)),
    JSON.stringify(checkedOk.errors),
  );

  const tamperedDirty = {
    ...tamperedOk,
    discovery: { status: "repo-dirty", fallback: "recorded-dirty-provenance", dirtyPaths: ["shared/open/SKILL.md"], error: null },
  };
  assert.equal(validateSkillSelection(tamperedDirty).valid, false);

  const catalogUnreadable = {
    ...tamperedOk,
    discovery: { status: "catalog-unreadable", fallback: "proceeded-without-skills", dirtyPaths: [], error: "ENOENT" },
    selections: [],
  };
  const checkedFailure = validateSkillSelection(catalogUnreadable);
  assert.equal(checkedFailure.valid, false);
  assert.ok(
    checkedFailure.errors.some((e) => e.path === "source.commit" && /catalog-unreadable/.test(e.message)),
    JSON.stringify(checkedFailure.errors),
  );

  const repoMissing = {
    ...tamperedOk,
    discovery: { status: "repo-missing", fallback: "proceeded-without-skills", dirtyPaths: [], error: "not a git repo" },
    selections: [],
  };
  assert.deepEqual(validateSkillSelection(repoMissing).errors, []);

  const repoMissingWithCommit = { ...repoMissing, source: { ...repoMissing.source, commit: repo.commit } };
  const checkedRepoMissing = validateSkillSelection(repoMissingWithCommit);
  assert.equal(checkedRepoMissing.valid, false);
  assert.ok(
    checkedRepoMissing.errors.some((e) => e.path === "source.commit" && /must be null/.test(e.message)),
    JSON.stringify(checkedRepoMissing.errors),
  );
});

test("buildSkillSelectionRecord fails in-band when the worktree status cannot be read", async () => {
  const repo = await makeSkillsRepo();
  const failingStatus = async (cmd, args, options = {}) => {
    if (cmd === "git" && args[0] === "status") {
      return { code: 128, stdout: "", stderr: "fatal: index file corrupt" };
    }
    return runCommand(cmd, args, options);
  };

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    runCommand: failingStatus,
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "status-unreadable");
  assert.equal(record.discovery.fallback, "proceeded-without-skills");
  assert.match(record.discovery.error, /index file corrupt/);
  assert.equal(record.source.commit, repo.commit);
  assert.deepEqual(record.discovery.dirtyPaths, []);
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord fails in-band when a selected skill is cataloged at multiple paths", async () => {
  const repo = await makeSkillsRepo({
    extraCatalogLines: ["- [`open`](../shared/open-alt/SKILL.md) - Same name, different path."],
  });

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "catalog-ambiguous");
  assert.equal(record.discovery.fallback, "proceeded-without-skills");
  assert.match(record.discovery.error, /open is cataloged at multiple paths/);
  assert.match(record.discovery.error, /shared\/open\/SKILL\.md/);
  assert.match(record.discovery.error, /shared\/open-alt\/SKILL\.md/);
  assert.deepEqual(record.selections, []);
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord tolerates harmless duplicate catalog lines and unselected ambiguity", async () => {
  const repo = await makeSkillsRepo({
    extraCatalogLines: [
      "- [`open`](../shared/open/SKILL.md) - Repeated line, identical path.",
      "- [`ghost`](../shared/ghost-a/SKILL.md) - Ambiguous but never selected.",
      "- [`ghost`](../shared/ghost-b/SKILL.md) - Ambiguous but never selected.",
    ],
  });

  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  assert.equal(record.discovery.status, "ok");
  assert.equal(record.selections.length, 1);
  assert.equal(record.selections[0].relpath, "shared/open/SKILL.md");
  assert.deepEqual(validateSkillSelection(record).errors, []);
});

test("buildSkillSelectionRecord rejects a call with neither selections nor a noRelevantSkill claim", async () => {
  const repo = await makeSkillsRepo();

  await assert.rejects(
    buildSkillSelectionRecord({
      runId: "run-188",
      skillsRoot: repo.root,
      selectedSkills: [],
      now: () => NOW,
    }),
    /either select at least one skill or set noRelevantSkill: true/,
  );
});

test("validateSkillSelection rejects empty successful records and lying noRelevantSkill claims", async () => {
  const repo = await makeSkillsRepo();
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  const emptyOk = { ...record, selections: [] };
  const checkedEmpty = validateSkillSelection(emptyOk);
  assert.equal(checkedEmpty.valid, false);
  assert.ok(
    checkedEmpty.errors.some((e) => e.path === "selections" && /noRelevantSkill: true/.test(e.message)),
    JSON.stringify(checkedEmpty.errors),
  );

  const lyingClaim = { ...record, noRelevantSkill: true };
  const checkedLying = validateSkillSelection(lyingClaim);
  assert.equal(checkedLying.valid, false);
  assert.ok(
    checkedLying.errors.some((e) => e.path === "selections" && /cannot also carry selections/.test(e.message)),
    JSON.stringify(checkedLying.errors),
  );

  const failureEmpty = {
    ...record,
    selections: [],
    discovery: { status: "catalog-unreadable", fallback: "proceeded-without-skills", dirtyPaths: [], error: "ENOENT" },
  };
  assert.deepEqual(validateSkillSelection(failureEmpty).errors, []);
});

test("validateSkillSelection rejects status/dirtyPaths contradictions", async () => {
  const repo = await makeSkillsRepo();
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  const okWithDirt = {
    ...record,
    discovery: { ...record.discovery, status: "ok", dirtyPaths: ["shared/open/SKILL.md"] },
  };
  const checkedOk = validateSkillSelection(okWithDirt);
  assert.equal(checkedOk.valid, false);
  assert.ok(
    checkedOk.errors.some((e) => e.path === "discovery.dirtyPaths" && /cannot carry dirty paths/.test(e.message)),
    JSON.stringify(checkedOk.errors),
  );

  const dirtyWithoutPaths = {
    ...record,
    discovery: { status: "repo-dirty", fallback: "recorded-dirty-provenance", dirtyPaths: [], error: null },
  };
  const checkedDirty = validateSkillSelection(dirtyWithoutPaths);
  assert.equal(checkedDirty.valid, false);
  assert.ok(
    checkedDirty.errors.some((e) => e.path === "discovery.dirtyPaths" && /must list the dirty paths/.test(e.message)),
    JSON.stringify(checkedDirty.errors),
  );
});

test("validateSkillSelection enforces fallback semantics by discovery status", async () => {
  const repo = await makeSkillsRepo();
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  const okWithFallback = { ...record, discovery: { ...record.discovery, fallback: "proceeded-without-skills" } };
  const checkedOk = validateSkillSelection(okWithFallback);
  assert.equal(checkedOk.valid, false);
  assert.ok(
    checkedOk.errors.some((e) => e.path === "discovery.fallback" && /must be null/.test(e.message)),
    JSON.stringify(checkedOk.errors),
  );

  const dirtyWithoutFallback = {
    ...record,
    discovery: { status: "repo-dirty", fallback: null, dirtyPaths: ["shared/open/SKILL.md"], error: null },
  };
  const checkedDirty = validateSkillSelection(dirtyWithoutFallback);
  assert.equal(checkedDirty.valid, false);
  assert.ok(
    checkedDirty.errors.some((e) => e.path === "discovery.fallback" && /recorded-dirty-provenance/.test(e.message)),
    JSON.stringify(checkedDirty.errors),
  );

  const failureWithoutFallback = {
    ...record,
    discovery: { status: "skill-unreadable", fallback: null, dirtyPaths: [], error: "ENOENT" },
    selections: [],
  };
  const checkedFailure = validateSkillSelection(failureWithoutFallback);
  assert.equal(checkedFailure.valid, false);
  assert.ok(
    checkedFailure.errors.some((e) => e.path === "discovery.fallback" && /proceeded-without-skills/.test(e.message)),
    JSON.stringify(checkedFailure.errors),
  );
});

test("validateSkillSelection rejects blank whySelected rationales", async () => {
  const repo = await makeSkillsRepo();
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  const blankRationale = {
    ...record,
    selections: [{ ...record.selections[0], whySelected: "   " }],
  };
  const checked = validateSkillSelection(blankRationale);
  assert.equal(checked.valid, false);
  assert.ok(
    checked.errors.some((e) => e.path === "selections[0].whySelected" && /pattern/.test(e.message)),
    JSON.stringify(checked.errors),
  );
});

test("validateSkillSelection rejects duplicate selection names", async () => {
  const repo = await makeSkillsRepo();
  const record = await buildSkillSelectionRecord({
    runId: "run-188",
    skillsRoot: repo.root,
    selectedSkills: [{ name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." }],
    now: () => NOW,
  });

  const duplicated = {
    ...record,
    selections: [
      record.selections[0],
      { ...record.selections[0], relpath: "shared/open-alt/SKILL.md", skillSha256: "1".repeat(64) },
    ],
  };
  const checked = validateSkillSelection(duplicated);
  assert.equal(checked.valid, false);
  assert.ok(
    checked.errors.some((e) => e.path === "selections[1].name" && /duplicate selection name "open"/.test(e.message)),
    JSON.stringify(checked.errors),
  );
});

test("buildSkillSelectionRecord rejects the same skill selected twice", async () => {
  const repo = await makeSkillsRepo();

  await assert.rejects(
    buildSkillSelectionRecord({
      runId: "run-188",
      skillsRoot: repo.root,
      selectedSkills: [
        { name: "open", whySelected: "The lane starts from an issue and needs the standard repo-opening workflow." },
        { name: "open", whySelected: "Listed again by mistake." },
      ],
      now: () => NOW,
    }),
    /selected skill open is listed more than once/,
  );
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
