# R1 beta bug fixes

The owner instructed on 10 November 2026: merge the existing code to main, open a new bug-fix branch/PR, and do not start R2.

## Baseline

- Repository: `tamer-sabry8/amun`.
- Merged PR: [#8](https://github.com/tamer-sabry8/amun/pull/8).
- Main merge commit: `b03b7016ad33c514a7d1bd28c020385c3c22a6cd`, containing M6 head `a21a156d3c6b0aedcb5818e73af362705c5becf0`. Its application tree matches the checked M6 tree.
- Source checkout: `/Users/tamersabry/Projects/amun`, clean on main after fast-forward.
- Branch: `fix/r1-beta-bugs`.
- Managed worktree: `/Users/tamersabry/.codex/worktrees/amun-beta-bugfixes/amun`.
- Delivered beta remains source `7eea589313988756ffe32c378699f413c6c208fd`; merging and branch setup do not replace the installed DMG or claim a new runtime fix.

## Current defect queue

**BF001 / T056: memory exceeds the retained budget.** The corrected beta measured 525–530 MiB against 500 MiB. See [performance proof](evidence/T056/README.md). Keep the measurement scope and limitations explicit. This is still open.

Record other owner-reported or reproduced beta defects as they arrive. Preserve the distinction between a reproduced defect, a proposed repair and a verified repair. T058 and final owner acceptance remain open; merging code is not an acceptance waiver.

## Validation and boundaries

Use a meaningful failing regression before a runtime fix, then run appropriate source checks and real Mac acceptance. Exercise invalid/stale input and recovery when relevant. Retest the affected packaged behavior before reporting it fixed. Use disposable profiles; do not reset, clean or adopt the owner's newly installed beta data.

R2 T059–T062 are on hold. Keep the M1 redesign paused and live Google/Obsidian checks in R3. Developer ID signing/notarization remains the final R2 step when R2 is explicitly resumed. Reuse settled Firstmate/secondmate approvals for the same scope; changed content, destination or source head retains its exact review. Do not replay the completed Azure, GitHub TEST or Notion publications. Preserve personal sessions and the M4 worker-check waiver.

This initial PR records the branch scope and owner hold. It does not claim to fix BF001 or introduce R2 functionality.
