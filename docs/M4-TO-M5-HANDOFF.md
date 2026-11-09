# M4 closeout and M5 kickoff

## Starting point

Use the existing `tamer-sabry8/amun` repository. The canonical Mac checkout is `$HOME/Projects/amun`, on `main`. M4 merged in [PR #6](https://github.com/tamer-sabry8/amun/pull/6) at `45c9271966abe8e0c3cd172e3c36e2786d460813`. Its tree matched the reviewed head, and [the hosted macOS workflow](https://github.com/tamer-sabry8/amun/actions/runs/42592202303) passed. The latest local check passed 495 tests. The earlier public milestone PRs are merged. The original M2 and M3 worktrees retain private evidence locally.

Read [AGENTS.md](../AGENTS.md), [the current tracker](TASKS.md), [the product and R1 plan](plans/product-and-r1-plan.md) and [M4 delivery evidence](evidence/M4/delivery-verification.md). The tracker records the owner's 9 November 2026 decision to close T041 and T045 with a waiver. Live reviewer merges and changed-head refusals passed on GitHub and Azure. Restricted-worker publication and server denials of worker merges and force-pushes were waived. Carry this limitation into the eventual R1 acceptance report. Azure TEST refs were removed. GitHub TEST refs were retained by owner request.

## Next worktree

Fetch origin in the canonical checkout, verify the remote, clean status and merge ancestry, then branch from the fetched main. The following commands assume the proposed M5 branch and worktree are new. On resume, inspect `git worktree list` and reuse the matching worktree.

```sh
cd "$HOME/Projects/amun"
git remote get-url origin
git status --short --branch
git fetch origin
git merge-base --is-ancestor 45c9271966abe8e0c3cd172e3c36e2786d460813 origin/main
git worktree list
git worktree add -b feat/m5-memory-portfolio "$HOME/Documents/ChatGPT/Amun/m5" origin/main
```

## M5 acceptance

| Task                     | Evidence to collect                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T047 Portfolio           | Show progress, blockers and decisions across two products in the Mac app. Show an inferred dependency and its transition to confirmed. Preserve product context isolation.                                |
| T048 Notion publish      | Review the exact content and destination, publish to a designated test page, and reconcile a simulated 503 after commit without creating a duplicate. Reuse the existing connection and publication flow. |
| T049 Two-way sync        | Exercise simultaneous edits, deletion and unlink choices, revoked access and offline edits. Verify the chosen resolution survives restart.                                                                |
| T050 Tasks and reminders | Show a missed reminder after sleep and verify consequential work waits for approval.                                                                                                                      |
| T051 Skills library      | Verify source preview, pinned hash, approved install and update, and refusal to execute a rejected install.                                                                                               |
| T052 Stakeholder updates | Show citations and explicit unknowns in a draft. Verify exact-content approval before publish or export.                                                                                                  |

Use TDD, run real Mac acceptance, and update the tracker with sanitized evidence as each task passes. Reuse one Firstmate and crew and one shared operational memory for working preferences and general lessons. Keep sources, conversations, product facts, models and pinned product decisions scoped to their product. Follow the existing Notion OAuth, destination and review decisions. Keep the M1 redesign paused. Google and Obsidian live acceptance belongs to R3.

After M5 passes, the next milestone is M6, T053–T058, covering chaos, accessibility, visual baselines, performance, release packaging and the R1 acceptance report. Verify the M5 integration point before starting a separate M6 worktree. T057 requires real signing, notarization and clean-account installation evidence. T058 requires owner sign-off.

## Prompt for the next chat

> Start M5 for Amun at T047. Use the existing repository tamer-sabry8/amun. The real Mac checkout is $HOME/Projects/amun on main. First read docs/M4-TO-M5-HANDOFF.md, then AGENTS.md, docs/TASKS.md and docs/plans/product-and-r1-plan.md there. Verify origin, working tree and that origin/main contains M4 PR #6. Create or resume feat/m5-memory-portfolio in the separate worktree $HOME/Documents/ChatGPT/Amun/m5. Start by proving that the portfolio shows progress, blockers and decisions across two products and labels inferred dependencies until confirmed. Continue through T048–T052 using TDD and real Mac acceptance. Record sanitized evidence and update the tracker after each pass. Preserve shared operational memory, product isolation and the existing publication approvals. M4 is closed with its recorded worker-check waiver. Keep the M1 redesign paused and live Google and Obsidian checks in R3. When M5 passes, prepare the verified M6 handoff beginning at T053. Stop only for a genuine blocker or a new owner decision.
