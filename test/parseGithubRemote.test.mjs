import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubRemote } from "../src/server/lib/parseGithubRemote.mjs";

test("parses https with and without .git and trailing slash", () => {
  assert.deepEqual(parseGithubRemote("https://github.com/owner/repo"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("https://github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("https://github.com/owner/repo/"), { owner: "owner", repo: "repo" });
});

test("parses scp-style and ssh:// forms", () => {
  assert.deepEqual(parseGithubRemote("git@github.com:owner/repo.git"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("ssh://git@github.com/owner/repo"), { owner: "owner", repo: "repo" });
  assert.deepEqual(parseGithubRemote("ssh://git@github.com/owner/repo.git"), { owner: "owner", repo: "repo" });
});

test("rejects non-repo URLs, non-github hosts, and junk", () => {
  assert.equal(parseGithubRemote("https://github.com/owner/repo/issues"), null);
  assert.equal(parseGithubRemote("https://github.com/owner"), null);
  assert.equal(parseGithubRemote("https://gitlab.com/owner/repo.git"), null);
  assert.equal(parseGithubRemote("git@example.com:owner/repo.git"), null);
  assert.equal(parseGithubRemote(""), null);
  assert.equal(parseGithubRemote(null), null);
  assert.equal(parseGithubRemote("https://github.com/owner/repo?x=1"), null);
  assert.equal(parseGithubRemote("https://github.com/owner/repo#readme"), null);
});
