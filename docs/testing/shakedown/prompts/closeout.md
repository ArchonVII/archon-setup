Before marking ready, run the repo's required verification commands, update the PR body with exact
evidence, update `docs/repo-update-log.md` when required, confirm the issue link exists, run
`npm run agent:close-preflight -- --repo OWNER/REPO --pr <number>`, and only then run
`npm run agent:pr-ready -- --repo OWNER/REPO --pr <number>`. Never run `gh pr ready` directly.
