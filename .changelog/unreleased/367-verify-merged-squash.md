## fix(onboard): verify-merged recognizes squash-merged repair PRs

- Keep the PR-head ancestor check as the fast path, and when it fails fall back to the PR's recorded merge state: MERGED with the merge commit reachable from the fetched default branch confirms the squash landed instead of always reporting blocked.
