// Parses a git remote URL into { owner, repo } for github.com ONLY.
// Returns null for anything else (other hosts, extra path segments, junk).
// MVP scope: github.com. GitHub Enterprise hosts are future work.
const PATTERNS = [
  // https://github.com/owner/repo(.git)(/)
  /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/,
  // ssh://git@github.com/owner/repo(.git)
  /^ssh:\/\/git@github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?$/,
  // git@github.com:owner/repo.git  (scp-style)
  /^git@github\.com:([^/?#]+)\/([^/?#]+?)(?:\.git)?$/,
];

export function parseGithubRemote(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  for (const re of PATTERNS) {
    const m = trimmed.match(re);
    if (m) return { owner: m[1], repo: m[2] };
  }
  return null;
}
