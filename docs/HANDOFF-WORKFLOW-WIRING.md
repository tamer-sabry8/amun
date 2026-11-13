# Amun workflow wiring · handoff

13 November 2026. Written for the next agent picking this work up. Read this file first, then the owner's handoff and `AGENTS.md`.

## Where things are

| What                    | Where                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Repository              | `https://github.com/tamer-sabry8/amun`                                                          |
| Branch                  | `claude/amun-workflow-wiring-e0ccc3` (from `main`, last merged with `main` at `36f4756`)        |
| Head when written       | `b8f283a`                                                                                       |
| Pull request            | Draft PR 18: `https://github.com/tamer-sabry8/amun/pull/18`                                     |
| Worktree                | `/Users/tamersabry/Projects/amun/.claude/worktrees/amun-workflow-wiring-e0ccc3`                 |
| Owner's handoff (scope) | `/Users/tamersabry/Documents/ChatGPT/Amun/Amun-Claude-Code-workflow-handoff.md`                 |
| The six issues          | `docs/6-issues.md`                                                                              |
| Standing owner rules    | `AGENTS.md`, sections "Workflow wiring (13 November 2026 handoff)" and those above it           |
| UI review page, batch 1 | `docs/preview/workflow-wiring/batch-1.html` in the worktree (local only, not committed)         |
| Review page generator   | Was in a session scratch folder and is gone. Rebuild the page by hand for batch 2 (notes below) |

Other agents are working in this repository on other branches and worktrees, including a crash investigation. Stay on this branch and this worktree. Do not touch the others.

## The assignment in one paragraph

Wiring, not a rebuild. Resolve the six issues in `docs/6-issues.md` (the seventh, packaged verification and the 500 MiB budget, is a separate follow-up) and connect the session, agent, task-checkout and plugin capabilities to the existing Amun interface. Keep Firstmate, Pi and Roast Room on their upstream update paths; Amun-specific behaviour goes in Amun. The removed built-in terminal stays out. Verify each journey through its normal entry point in the development app.

## Rules the owner has set (do not skip)

1. **No UI change without approval.** Show the actual current screen beside the proposal in an annotatable page, say which workflow it enables, and wait. Approval of a workflow is not approval of its design.
2. **Run every UI change through the `/impeccable` skill.**
3. **Design preferences from the first review round.** Keep existing screens as they are and add as little as possible. Reuse a pattern already on that screen (for example the amber conversation card) before drawing anything new. Add nothing to the prompt box. Use plain, friendly wording for messages and buttons, never technical wording. The owner rejected four composer proposals before accepting the one that changed nothing in the prompt box.
4. **Live-test destinations.** Azure DevOps: project `TahalufCollection / POCs` only; stories to the `POCs Team` board, level `Backlog items`; repo and wiki tests use the `tamer-test1` repository; the read-only sprint check uses `POCs\2021-Q1\Sprint 5`. Notion: child pages under "test for Amun to use" (publishing test only, not a memory parent).
5. **Sign-ins are the owner's.** Never enter credentials. Launch a development profile and ask the owner to sign in. Azure DevOps uses its supported API route and company Edge; Notion uses hosted MCP OAuth in Edge or Dia.
6. **Report honestly.** Say what was run, what was not, and what is still waiting for approval.

## How the review loop worked

The page was served with `lavish-axi docs/preview/workflow-wiring/batch-1.html`, which gives a `http://127.0.0.1:4387/session/…` link the owner opens and annotates. `lavish-axi poll <file> --agent-reply "<short message>"` posts a reply and waits for the next notes; run it as a tracked background job. The page shows "Working…" until a reply is posted. The owner ended the batch 1 session with Send & End, so start a new page and session for batch 2.

The page is one self-contained HTML file: it inlines `apps/renderer/src/tokens.css` and `apps/renderer/src/rebuild/rebuild.css`, sets `data-theme="amun-light"`, embeds the Inter fonts from `apps/desktop/renderer/fonts/`, and draws each proposal as real markup using the app's own classes inside a `.rb` wrapper. Current screens are real screenshots from the development app.

## How to run things

Use Node 24 if available (`~/.nvm/versions/node/v24.22.0/bin`); Node 22 also worked for tests.

```bash
pnpm check
```

```bash
pnpm build
```

```bash
AMUN_REBUILD_SHOTS=/some/folder pnpm exec playwright test tests/e2e/rebuild-shell.spec.ts tests/e2e/plan-review.spec.ts tests/e2e/attachments.spec.ts
```

A fresh worktree has no `apps/desktop/.runtime`, and the app stays on "Starting Amun…" until the runtimes are staged. This worktree is already staged. To stage another:

```bash
pnpm runtime:stage && pnpm firstmate:stage && pnpm council:stage && pnpm terminal:stage && pnpm database:stage && pnpm mcp:stage && pnpm auth:stage
```

The app tests launch Electron with `--user-data-dir=<temp folder>` and `AMUN_LEGACY_SHELL=0`. To seed a profile without a model, create `<root>/workspace/workspace.sqlite`, run `migrate(db)`, drive `WorkStore.handle(...)`, close it and `chmod 600` the file (the service refuses a readable workspace). `tests/e2e/plan-review.spec.ts` is the pattern.

## Done, verified in the development app, pushed

All in a disposable profile with no connections. Lint, types, 963 unit tests and formatting pass.

| Change                                   | What the owner can now do                                                                                                                                                                                                             | Key files                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approved plans publish (issue 1)         | Approve a plan and have each item written to Azure DevOps or Notion, with the ID and link recorded. An item may name its own destination in `fields.destination`.                                                                     | `packages/data/src/plan-publication.ts`, `apps/desktop/src/plan-targets.ts`, `apps/desktop/src/service.ts`, migration 30 (`plan_writes`)                                                             |
| Uncertain writes                         | A sent-but-unconfirmed write is looked up by its marker first. Found is linked; confirmed missing is retried once under the same approval; still uncertain is reported. After a restart, uncertain writes are looked up, never resent | same                                                                                                                                                                                                 |
| Plan review (approved, section 1)        | See each item's destination and place; untick items to approve only some ("Approve and publish 1 of 2"); the rest wait as "Not approved yet"; Created links; Check now / Retry                                                        | `apps/renderer/src/rebuild/work-session.tsx` (`PlanReview`, `PlanItem`), `packages/data/src/work-store.ts` (`approvePlan`, `itemIds`), migration 31 (`split_from`), `packages/contracts/src/work.ts` |
| Message waits for a provider (section 3) | A message sent with no usable provider is kept, shown as "Waiting to send", and sent once after connection                                                                                                                            | `apps/renderer/src/rebuild/firstmate.ts`, `work-session.tsx`                                                                                                                                         |
| Attachments (section 2, issue 6)         | Attach PDF, Word, Excel, PowerPoint, CSV, Markdown, text and images. Each is read on the Mac, filed in the work area's library and sent with the message. Problems appear as the amber card above the prompt box                      | `packages/data/src/attachment-reader.ts`, `apps/renderer/src/rebuild/attachments.ts`, `composer.tsx`, `work-session.tsx`, `service.ts` (`work-attachment`)                                           |
| Screenshot                               | "+ → Screenshot" starts the Mac's area selection and adds the capture to the draft                                                                                                                                                    | `apps/desktop/src/screenshot.ts`, `preload.ts`, `main.ts`                                                                                                                                            |

App tests added: `tests/e2e/plan-review.spec.ts`, `tests/e2e/attachments.spec.ts`; `tests/e2e/rebuild-shell.spec.ts` was extended for the waiting message.

## Not verified (say so in any report)

- **Nothing live.** No story created in POCs, no Notion page, no real Firstmate reply, no image sent to a model, no "Open in Azure DevOps" link clicked. Unit tests use stand-in destinations.
- **Screenshot capture.** Wired but not exercised: interactive area selection cannot be driven in a test, and macOS will ask for screen-recording permission.
- **A waiting message actually sending** after a real provider is connected.
- **Performance and memory.** No measurements taken (handoff decision 44 and the "Performance and memory acceptance" section).
- **CI on head `b8f283a`** was still running when this was written. Two earlier failures were fixed: a real bug where a waiting message was dropped on a failed retry, and an ambiguous button match already fixed on `main`.

## Approved by the owner, not built yet

**Sprints from Azure DevOps (section 4, issue 4).** The owner approved the current Sprints screen with no visual change. Fill the existing rows, tabs and Stories view from the team's real sprint. Team switch, set default and refresh go through the screen's existing composer as `/sprint team <name>`, `/sprint default`, `/sprint refresh`. Refresh also on open, on team switch and every 15 minutes while visible. A routine move to Done updates quietly; a committed story leaving its sprint raises the existing yellow flag line and an item under Needs your attention, leaving the teammate's edit in place. Starting points: `packages/connectors-ado/src/board-discovery.ts` (`iterations`, `teams`, `levels`, `columns`, `cards`), `apps/renderer/src/rebuild/screens.tsx` (Sprints, around line 840), `packages/data/src/work-store.ts` (`save-sprint`, `external-change`, `work_sprints`).

**Fork icon and message search (section 5).** Approved design: the conversation and its cards unchanged; a quiet icon row under a message with copy and "Fork from here", tooltip "Starts a new conversation from this point. This one stays as it is."; Search keeps today's list and adds message rows; choosing one opens the chat at that message. No separate Resume button.

Two things block the build:

1. **Open question for the owner:** where a forked chat lives so it can be reopened. Either as its own item under Your work (reuses existing screens) or as a second chat inside the same work (needs a chat switcher, which needs approval). Not answered yet.
2. **Technical finding:** every work area shares one Firstmate conversation today (`apps/renderer/src/rebuild/firstmate.ts` keeps a single `session`). A fork that excludes later messages needs its own. Pi has session branching upstream (`runtime.session.sessionManager.getBranch()` appears in `apps/desktop/src/native-pi-worker.ts`); use that rather than building branching in Amun.

## Not started

Each of these has data code and unit tests but nothing reaches it from the service or the interface. Each needs service wiring, a contract, and a screen change the owner must approve first (batch 2).

| Journey                                             | Existing code                                                                           | Notes                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Talk to Firstmate, live (issue 2)                   | `firstmate.ts`, `view-model.ts` (`parseAmunActions`, `amunProtocol`)                    | Needs the owner's sign-in. Test: "Our pilot is in Dubai" then "Where is our pilot?"                                          |
| Council room and one Quick Council (issue 3)        | `packages/council/src/`                                                                 | Costs tokens; needs the owner's go-ahead. Verdict format is assumed                                                          |
| Product memory in Notion (issue 5, decisions 48–51) | `record-claim` / `resolve-claim` in `work-store.ts`, `packages/data/src/memory-sync.ts` | One Notion parent per group, one child page per product; conflict Question card; deletion and freshness rules in the handoff |
| Composer sources from GitHub, Azure DevOps, Notion  | `plusMenu` in `packages/domain/src/work/shell.ts`                                       | Exact links and search/pick; "Connect and continue" when disconnected                                                        |
| Replay                                              | `packages/data/src/trajectory.ts`, `apps/renderer/src/trajectory-view.tsx`              | Viewing makes no model call or write; Run again is separate                                                                  |
| Bring your own agent                                | `packages/data/src/agent-org.ts`                                                        | Enrol once, then Firstmate assigns matching work                                                                             |
| Atomic task checkout                                | `packages/data/src/task-checkout.ts`                                                    | Exactly one claim; recovery rules in the handoff                                                                             |
| Plugin suggestion                                   | `packages/data/src/plugins.ts`                                                          | Suggested in the originating chat, then the request continues                                                                |
| Preview and element feedback                        | `packages/data/src/element-feedback.ts`                                                 |                                                                                                                              |
| Operational dashboard                               | `packages/data/src/operations.ts`, `apps/renderer/src/operations-view.tsx`              | Leads with work waiting on the owner                                                                                         |
| Chat-to-CLI and CLI detection                       | `packages/data/src/tool-registry.ts`, `fleet.ts`                                        |                                                                                                                              |
| Creator mode                                        | `packages/data/src/creator.ts`                                                          |                                                                                                                              |
| Ports, worktrees, Git canvas, PR flow, cleanup      | `packages/data/src/port-leases.ts`, `git-checkpoints.ts`, `pr-delivery.ts`              | ADR-015 lists the canvas and conflict reconciliation as missing                                                              |

## Things that will trip you up

- **Migrations 30 and 31 are new on this branch.** Any other branch adding a migration must append after them. Checksums are verified at startup.
- **A plan's Azure DevOps project** comes from the product's mapped Azure source (`sources` with `kind='ado'`), falling back to the workspace setting `work.ado.project`. A work area with no product has no way to choose a project yet; that picker is a UI change for batch 2. Until then such items show "No Azure DevOps project is chosen for this work yet."
- **The Notion place name** shown in the review comes from the setting `notion.destination.title`, saved when the destination is verified. A profile that chose its destination before this branch will show no name until it is verified again.
- **A Notion search miss under a page parent is treated as uncertain,** not as absent, because Notion's search can lag a new page. So a Notion page is never resent on a miss; the owner is asked instead. Database parents with the marker property are queried exactly.
- **Created links** open only for items in `plan_writes` with state `created`; Azure DevOps links open in Microsoft Edge, others in the default browser.
- **Small plans open in Home's tray**, not the review pane. The full review with ticks opens from the Island's "Review changes" or from the conversation card.
- **Events from the service reach the renderer only if they parse** as a known schema in `apps/renderer/src/bridge.ts`. New result events were added to the `workEvent` union in `packages/contracts/src/work.ts`.
- `docs/preview/workflow-wiring/` is in `.prettierignore` and in the local git exclude file, so the review page is never committed.

## What the next agent should do first

1. Check CI on PR 18 and fix anything red.
2. Ask the owner the fork-location question, and ask them to sign in to a model, Azure DevOps and Notion in a development profile you launch.
3. Build the Sprints reader behind the existing screen (no approval needed, since nothing visible changes beyond data).
4. With sign-ins: run the live journeys in order: Firstmate "Dubai", publish one story and one page, read Sprint 5.
5. Prepare batch 2 of UI proposals with `/impeccable`, following the design preferences above, and wait for approval before implementing.
6. Measure development performance and memory before and after, as the handoff requires.
