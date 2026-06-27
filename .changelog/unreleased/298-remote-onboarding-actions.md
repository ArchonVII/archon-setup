### Changed

- The onboarding planner and wizard Review screen now expose remote mutations
  as first-class actions (`repo.create`, `labels.apply`, and baseline branch
  protection). In new-repo mode, entering an owner/repo while leaving
  "Create GitHub repo" unselected now produces a blocking warning instead of
  silently treating the repo target as decided. (#298)
