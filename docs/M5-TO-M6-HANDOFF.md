# M5 to M6 handoff

## Start at T053

Read [AGENTS.md](../AGENTS.md), [the tracker](TASKS.md), [section 12 of the R1 plan](plans/product-and-r1-plan.md#12-testing-strategy) and the evidence linked below. M5 implementation is on `feat/m5-memory-portfolio` in [PR #7](https://github.com/tamer-sabry8/amun/pull/7). The worktree is `$HOME/Documents/ChatGPT/Amun/m5`. The canonical checkout is `$HOME/Projects/amun`. M5 started from M4 PR #6 and handoff `aa46a9e`.

Before creating a separate M6 worktree, fetch origin, check the canonical working tree and verify the M5 integration point. For a merge commit, check ancestry. For a squash, inspect the merged PR and compare the accepted changes against its integration commit. If the PR is still open, use its branch for M5 review and await integration before branching from main.

## Verification

Implementation commits `c6e8064` and `d9376a3` passed the local workspace checks on Apple silicon with Node 24.22.1, pnpm 11.25.0 and Electron 45.2.3. Vitest passed 505 tests with 97.59% line coverage for the domain package. To repeat the artifact check on a Mac, run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm package` and `pnpm test:packaged`. The draft PR records the hosted macOS workflow for each submitted head.

## M5 evidence

- [Portfolio](evidence/T047/README.md) covers two products, inferred dependencies, confirmation, restart and scope changes.
- [Notion publication](evidence/T048/README.md) covers a live approved page and a simulated 503 after commit. Recovery verified the parent and marker with one create.
- [Memory sync](evidence/T049/README.md) covers an approved live field edit and independent read-back. Conflict, offline, deletion, loss of access and restart have separate evidence. Conditional writes target named Markdown lines with following text.
- [Reminders](evidence/T050/README.md) covers overdue delivery and approval of consequential work. The Mac test emitted the production resume event twice while the machine was awake. Include physical sleep/wake in M6 chaos testing.
- [Skills](evidence/T051/README.md) covers review of source and hash, rejected installation, approved update and expansion into a Firstmate draft.
- [Stakeholder updates](evidence/T052/README.md) covers cited records, explicit unknowns, edited approvals, PDF output and an independently fetched, approved live stakeholder publication.

## M6 sequence

1. **T053** Exercise every section 12 chaos scenario, including service death mid-publication, network loss, sleep/wake, expired tokens, revoked access, restart during a run and payload mutation after approval. Check the external result, local ledger and visible recovery state. Use disposable workspaces and reviewed test destinations.
2. **T054** Exercise the keyboard golden path and run axe on primary screens in all three themes. Resolve serious and critical findings.
3. **T055** Obtain visual approval for Island item types and sizes, drawers, status pill and key screens.
4. **T056** Repeat the T012 performance measurements against their recorded budgets.
5. **T057** Verify the signed and notarized DMG, clean-account install, pinned Pi and Firstmate, and prerequisites for the verified backend, Claude Code and Codex.
6. **T058** Link F01–F23 to evidence, name residual limitations and obtain product-owner sign-off.

Use one Firstmate and crew with shared operational preferences and lessons. Keep product sources, conversations, facts, models and pinned decisions isolated. The M4 restricted-worker publication and server-denial checks carry the recorded owner waiver into T058. Keep the M1 redesign paused and live Google and Obsidian checks in R3. Reuse existing Notion OAuth, verified destination and exact-content approval. The M5 live fixture has already been published and edited.
