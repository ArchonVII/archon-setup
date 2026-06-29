### Fixed

- The onboarding planner's "Create GitHub repo" omission guard now gates on a
  non-empty `plan.remoteMutations` set instead of any `remoteRequirement`, so a
  workflow-only local plan is no longer spuriously blocked while genuine
  new-repo plans still get the warning. (#303)
