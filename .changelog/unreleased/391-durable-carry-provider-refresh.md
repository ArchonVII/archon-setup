### Fixed

- Refreshed only the repo-template provider to reviewed PR #210 merge SHA
  `62cf1d01314d4ff555ac9fa878c4f9a7a2477b80` and self-applied its
  receipt-bound carry lifecycle. Changed or recreated task inputs are preserved
  with recovery details instead of being overwritten during worktree startup;
  other provider pins and consumers remain unchanged in this lane. (#391)
