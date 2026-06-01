import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HUB_REPOSITORIES,
  collectGovernance,
} from "../src/server/ecosystem/collectGovernance.mjs";

const REQUIRED_GATE = "repo-required-gate / decision";

function okJson(value) {
  return { code: 0, stdout: JSON.stringify(value), stderr: "" };
}

function failJson(value) {
  return { code: 1, stdout: JSON.stringify(value), stderr: "" };
}

function makeGh(routes) {
  return async (cmd, args) => {
    assert.equal(cmd, "gh");
    assert.equal(args[0], "api");
    const path = args[1];
    if (!(path in routes)) throw new Error(`unexpected gh api path: ${path}`);
    return routes[path];
  };
}

test("default governance targets cover the four ArchonVII hub repos", () => {
  assert.deepEqual(
    HUB_REPOSITORIES.map((r) => `${r.owner}/${r.repo}`),
    [
      "ArchonVII/.github",
      "ArchonVII/github-workflows",
      "ArchonVII/repo-template",
      "ArchonVII/archon-setup",
    ]
  );
});

test("collectGovernance distinguishes classic protection from active rulesets and computes posture", async () => {
  const runCommand = makeGh({
    "repos/ArchonVII/archon-setup": okJson({
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true },
    }),
    "repos/ArchonVII/archon-setup/branches/main/protection": okJson({
      required_pull_request_reviews: { required_approving_review_count: 0 },
      required_status_checks: { checks: [{ context: REQUIRED_GATE }] },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      enforce_admins: { enabled: false },
    }),
    "repos/ArchonVII/archon-setup/rulesets": okJson([
      { id: 42, name: "main", target: "branch", enforcement: "active" },
    ]),
    "repos/ArchonVII/archon-setup/rulesets/42": okJson({
      id: 42,
      name: "main",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
      rules: [
        { type: "pull_request", parameters: { required_approving_review_count: 0 } },
        { type: "non_fast_forward" },
        { type: "deletion" },
        { type: "required_status_checks", parameters: { required_status_checks: [{ context: REQUIRED_GATE }] } },
      ],
      bypass_actors: [],
      current_user_can_bypass: "never",
    }),
  });

  const result = await collectGovernance({
    repositories: [{ owner: "ArchonVII", repo: "archon-setup" }],
    runCommand,
  });

  assert.equal(result.status, "green");
  assert.equal(result.repos[0].classic.status, "present");
  assert.equal(result.repos[0].rulesets.status, "present");
  assert.equal(result.repos[0].rulesets.items[0].name, "main");
  assert.deepEqual(result.repos[0].posture, {
    prRequired: "required",
    directPush: "blocked",
    forcePush: "blocked",
    deletion: "blocked",
    requiredGate: "required",
  });
});

test("collectGovernance reports unavailable API permissions as unknown instead of inferring", async () => {
  const unavailable = failJson({ message: "Resource not accessible by integration", status: "403" });
  const result = await collectGovernance({
    repositories: [{ owner: "ArchonVII", repo: "repo-template" }],
    runCommand: makeGh({
      "repos/ArchonVII/repo-template": okJson({
        default_branch: "main",
        permissions: { pull: true },
      }),
      "repos/ArchonVII/repo-template/branches/main/protection": unavailable,
      "repos/ArchonVII/repo-template/rulesets": unavailable,
    }),
  });

  assert.equal(result.status, "yellow");
  assert.equal(result.repos[0].classic.status, "unavailable");
  assert.equal(result.repos[0].rulesets.status, "unavailable");
  assert.deepEqual(result.repos[0].posture, {
    prRequired: "unknown",
    directPush: "unknown",
    forcePush: "unknown",
    deletion: "unknown",
    requiredGate: "unknown",
  });
});

test("collectGovernance reports explicit unprotected state when both APIs are available and empty", async () => {
  const result = await collectGovernance({
    repositories: [{ owner: "ArchonVII", repo: "github-workflows" }],
    runCommand: makeGh({
      "repos/ArchonVII/github-workflows": okJson({
        default_branch: "main",
        permissions: { admin: true, push: true, pull: true },
      }),
      "repos/ArchonVII/github-workflows/branches/main/protection": failJson({
        message: "Branch not protected",
        status: "404",
      }),
      "repos/ArchonVII/github-workflows/rulesets": okJson([]),
    }),
  });

  assert.equal(result.status, "red");
  assert.equal(result.repos[0].classic.status, "absent");
  assert.equal(result.repos[0].rulesets.status, "absent");
  assert.deepEqual(result.repos[0].posture, {
    prRequired: "not-required",
    directPush: "allowed",
    forcePush: "allowed",
    deletion: "allowed",
    requiredGate: "missing",
  });
});
