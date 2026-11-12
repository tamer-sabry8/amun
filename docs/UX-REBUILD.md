# UX rebuild (shell v3)

Started 12 November 2026 on branch `claude/amun-ux-rebuild-933536`, from `origin/main` at `e6be49b`.
Source of truth for behaviour: the three plans in the owner's priority folder
(`Amun_UX_Rebuild_Handoff.md`, `amun-ux-decisions.md`, `Roast_Room_Integration_Plan.md`) and the
reconciliation record. The requirement-to-code map, deferred issues and handback live in that folder.

## What is where

| Layer           | Files                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product rules   | `packages/domain/src/work/` — `model` (F1–F2), `permissions` (§8), `flows` (F3–F10), `home`, `shell`, `planning`, `council`                                                                                                          |
| Contract        | `packages/contracts/src/work.ts` — snapshot, commands, Council status                                                                                                                                                                |
| Storage         | `packages/data/src/work-store.ts`, migration 29 in `packages/data/src/migrations.ts`                                                                                                                                                 |
| Council runtime | `packages/council/src/` — `runtime` (compose, validate, update, rollback, install), `bridge` + `ask-server` (Chair questions), `room`, `service`, `git-fetcher`                                                                      |
| Service wiring  | `apps/desktop/src/service.ts` (`kind: "work"`, `kind: "council"`), `apps/desktop/src/main.ts` (Council paths, legacy switch)                                                                                                         |
| Interface       | `apps/renderer/src/rebuild/` — `app`, `chrome` (sidebar, Island, search), `rail`, `composer`, `wizard`, `home`, `work-session`, `screens`, `settings`, `rebuild.css`                                                                 |
| Pinned upstream | `runtime/roast-room/manifest.json`, `scripts/stage-roast-room.ts` (`pnpm council:stage`)                                                                                                                                             |
| Tests           | `packages/domain/tests/work-*.test.ts`, `packages/data/tests/work-store.test.ts`, `packages/data/tests/council-service.test.ts`, `packages/council/tests/`, `apps/renderer/tests/rebuild.test.ts`, `tests/e2e/rebuild-shell.spec.ts` |

## Data

Migration 29 is additive. It creates the group, work-area, record, objective, routing, permission,
plan, RFP, roadmap, sprint, Library, Decisions, Council, findings and memory-claim tables, and adopts
every existing product as a product work area with no group. No earlier table is altered and no
earlier migration is edited. The beta shipped at migration 24; main was at 28.

PR #10 (`fix/r1-beta-bugs`) adds its `diagnostic_events` migration at position 25, which main has
since used for another change. If that work is brought in, its migration must be re-appended after
29, never inserted at 25.

## Switched off, and how to restore

Nothing was deleted. Each item below is disabled at one activation point.

| Earlier surface                                                                                                                                                           | Why it is off                                                                         | Activation point                                                                      | To restore                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole earlier shell: sidebar with Browser, Terminal, Requests, Agents, Decisions, Priorities; product links; pinned tabs; five drawers; Write/Research/Review tabs; Focus | Superseded by shell v3 (handoff §2 rows 1–4)                                          | `apps/renderer/src/main.ts`: the default branch now starts `rebuild/app.tsx`          | Launch with `--amun-legacy-shell` or `AMUN_LEGACY_SHELL=1`; or swap the two branches in `main.ts` to make it the default again. Its end-to-end suites run with `AMUN_LEGACY_SHELL=1 pnpm test:e2e` |
| Requests list                                                                                                                                                             | Merged into Home "Needs your attention" and the Island                                | Not mounted in `rebuild/app.tsx`                                                      | Reachable in the earlier shell                                                                                                                                                                     |
| Terminal tile and pane                                                                                                                                                    | Sessions are watched from Agents › Watch                                              | Not mounted                                                                           | `TerminalPane` in `apps/renderer/src/terminal-pane.tsx`; mount it from a route in `rebuild/app.tsx`                                                                                                |
| Composer difficulty, model and context dropdowns (`FirstmateComposer`)                                                                                                    | Routing is automatic (Q9, Q27)                                                        | Not mounted                                                                           | `apps/renderer/src/firstmate-composer.tsx`                                                                                                                                                         |
| Six worker sign-in buttons and readiness checks                                                                                                                           | One sign-in, four-state status (Q7–Q12)                                               | `NativePiPanel subscriptionsOnly` is shown only behind "Review" in setup and Settings | Mount `NativePiPanel` directly                                                                                                                                                                     |
| Skills drawer in the rail                                                                                                                                                 | Skills live under `/` and in Settings (Q26)                                           | Not in `railItems` (`packages/domain/src/work/shell.ts`)                              | Add an entry to `railItems` and a panel in `rebuild/rail.tsx`                                                                                                                                      |
| Standalone Priorities (RICE table)                                                                                                                                        | Merged into Roadmap › Now / Next / Later with RICE badges (Q64)                       | Not mounted                                                                           | `apps/renderer/src/priorities.tsx`                                                                                                                                                                 |
| Engineer delivery: story implementation, pull-request review and merge                                                                                                    | Amun reads repos and PRs; it does not write production code or merge (Q41)            | `PullWorkspace`, `StoryImplementation` not mounted                                    | Mount from a work-session pane in `rebuild/work-session.tsx`                                                                                                                                       |
| Operations, control tower, trajectory, org and goals, widget dock views from PRs 11–15                                                                                    | Not needed by the new design yet; they were never mounted in the earlier shell either | Unchanged                                                                             | Mount the exported components; their data stores are untouched                                                                                                                                     |

Still in use from earlier work, embedded where the new design needs it: PRD workspace and Backlog
(document pane of a product), connection settings, backup controls, sign-in prompt, agent runtime
and sessions (Agents › Watch and Settings › Advanced), skills library, the isolated browser view,
the Firstmate conversation service, redaction, and every approval and outbox control.

## Controls that were not weakened

- Azure DevOps writes, backlog or committed-roadmap changes, and cross-group use always ask. A
  standing permission that would cover one of them is refused by the store.
- An approval is bound to a fingerprint of exactly what was on screen; a plan that changed after it
  was opened cannot be approved until it is reviewed again.
- Marking an attention item done never approves its plan.
- A confirmed write is never downgraded by a later retry report, and results that do not match the
  approved plan are rejected.
- Group separation is applied when records are linked, findings proposed, objectives and outputs
  filed, work areas related, and in every list the interface shows.

## Open decisions carried forward (handoff §13)

1. Electron vs Tauri wording: the repository is Electron 45.2.3; no code depends on the answer.
2. Memory retrieval architecture (vector, graph, Notion sync, backup): not chosen. Facts are stored
   locally with history and shown as "not yet in Notion".
3. Ranking weights, stale threshold, nudge severity, retry budget: placeholders in
   `packages/domain/src/work/home.ts` (`rankingDefaults`, `retryBudget`) and `permissions.ts`
   (`ruleThreshold`).
4. Light theme: built as `amun-light`; default follows macOS. Palette is a proposal.
5. Council Chair interaction: resolved by test. Claude Code 2.1.321 does not offer AskUserQuestion
   in headless mode, so the Chair asks through Amun's own tool and the question reaches the Island.
6. RFP stage names: held as data in `packages/domain/src/work/flows.ts` (`rfpStages`,
   `rfpStageLabels`); proposed names are in use.
