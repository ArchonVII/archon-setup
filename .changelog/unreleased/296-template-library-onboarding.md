- Headless/default onboarding now installs the repo-template `templates/**`
  library through the locked `agent-workflow.template-library` feature, with
  exact audit/drift repair coverage for the reusable agent, prompt, report,
  operations, GitHub, and partial templates. The headless onboard CLI also
  resolves relative target paths before planning, so documented commands such
  as `npm run onboard -- . --audit` work from the target repository. (#296)
