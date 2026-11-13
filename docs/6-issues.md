# Amun UX rebuild · the open issues explained

13 November 2026. Branch `claude/amun-ux-rebuild-933536`, commit `cff59e0`.

These are the items from the "Not working yet" list in the handback. There are seven of them, not six; all seven are here. Each one says what it is, where the code stands, why it was not done in the first pass, what I need from you, and whether I have a clear way to do it.

## Summary

| #   | Issue                                      | Blocked by                                                                                                                            | Needs from you                                                                  | Clear process?                                        |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Approved plans are not published           | A hard approval gate and no test destination                                                                                          | A test Azure DevOps project and Notion section, and a go-ahead to write to them | Mostly. One mapping question to settle in code        |
| 2   | No live model turn was verified            | No signed-in test profile                                                                                                             | One sign-in in a throwaway profile                                              | Yes                                                   |
| 3   | No real council session, no real room      | This session's safety check; token cost                                                                                               | Run one command yourself, and approve the spend                                 | Yes for the room. The verdict format is an assumption |
| 4   | Nothing reads Azure DevOps into Sprints    | Depends on 1; needs a live ADO sign-in                                                                                                | The project and team to read, and a sign-in in company Edge                     | Partly. The reader design is not done                 |
| 5   | Memory is local only                       | Your open decision on memory                                                                                                          | The decision                                                                    | No, not until you decide                              |
| 6   | The composer's `+` records file names only | Nothing external. I did not get to it                                                                                                 | Which file types and size limit you want                                        | Yes for files. Not for "from GitHub/ADO/Notion"       |
| 7   | The packaged build                         | Done 13 November. In-process graphics with a crash fallback is now built: Home measures 482 to 501 MiB against 500, usually about 485 | Review of the trade-offs below; nothing is committed                            | Yes                                                   |

Items 6 and 7 were my choice of order, not real blockers. Items 1 to 5 each wait on something only you can give.

---

## 1. Approved plans are not published anywhere

**What it is.** In the new design you approve a plan once ("approve plans, not clicks") and Amun then writes its items to the tracker: stories to Azure DevOps, pages to Notion. Today the approval is recorded and the plan shows "Publishing…", and then nothing happens. No story or page is created.

**Where the code stands.**

- Built and tested: proposing a plan, approving it against a fingerprint of exactly what was shown, and recording per-item results (created, failed, unknown), including partial and uncertain writes. This is `propose-plan`, `approve-plan` and `recordResults` in `packages/data/src/work-store.ts`.
- Already in the repository from earlier milestones, untouched: the Azure DevOps writer (`packages/data/src/ado-batch.ts`, `apps/desktop/src/ado-operations.ts`) and the Notion writer (`packages/data/src/notion-publication.ts`, `packages/connectors-notion/`).
- Missing: the piece in `apps/desktop/src/service.ts` that takes an approved plan, hands its items to the right writer, and feeds the results back into `recordResults`.

**Why I did not do it the first time.** Two reasons. Writing to Azure DevOps is one of the three hard gates, and your standing instructions say not to replay the earlier Azure DevOps, GitHub TEST or Notion publications. I had no destination I was allowed to write to, so I could have written the connection but not proved it. I chose not to ship an unproven write path.

**What I need from you.**

1. A test Azure DevOps project (or confirmation that the earlier TEST one may be used again for new items).
2. A Notion parent section for test pages.
3. A go-ahead to create real items there during the acceptance run.

**Do I have a clear process?** Mostly.

1. Map a plan item to the shape `AdoBatch` expects. I have not yet checked how far the two shapes differ; that is the one unknown.
2. Call the existing writer from the service after `approve-plan`, keeping its own exact-content review and uncertain-write reconciliation.
3. Feed results into `recordResults`.
4. Unit-test with a stand-in writer, then one real run against the test project.

---

## 2. No live model turn was verified

**What it is.** In a work session you type and Firstmate answers. Its answer can also carry proposals: a document, a plan, a question, a scope card. I have never seen a real model produce one inside the rebuilt app.

**Where the code stands.**

- Built: the conversation path (`apps/renderer/src/rebuild/firstmate.ts`), reading the reply out of the transcript and parsing proposals (`replyFromTranscript`, `parseAmunActions` in `view-model.ts`), and the instructions given to the model (`amunProtocol`).
- Tested: parsing, with written examples. The failure path (no sign-in) is exercised in the real app and shows a plain message.
- Not tested: whether a real model follows the instructions and whether its real output parses.

**Why I did not do it the first time.** Every run used a throwaway profile so your personal Firstmate, Herdr and Pi homes stayed untouched. A throwaway profile has no signed-in model, and I am not allowed to enter credentials or use your personal profile.

**What I need from you.** One sign-in, done by you, in the throwaway profile (I start the app and open the sign-in card; you complete it in the browser). Any provider the bundled sign-in supports will do.

**Do I have a clear process?** Yes.

1. Start the development build with a fresh profile and wait for you to sign in.
2. Run three turns: a plain question, a request that should produce a document, a request that should produce a plan.
3. Fix whatever the real output breaks in the parser or the instructions.
4. Record the transcript as evidence.

This also unblocks the smarter intake (D20 in the deferred list), which today uses fixed rules.

---

## 3. No real council session, and the real room has not been opened

**What it is.** The Council screen runs the Roast Room: twelve simulated advisors debate a question and a Chair writes a verdict. There are two parts: the run itself, and the "room", a small local web page from upstream that shows the session.

**Where the code stands.**

- Built and verified for real: upstream is pinned and checksum-verified, it installs, the roster composes and validates (12 seats), and the Chair's question reaches Amun and the answer returns (one real Claude Code run).
- Built and tested against stand-ins only: starting the room (`packages/council/src/room.ts`), a whole run from start to filed verdict (`service.ts`), update and rollback.
- Assumed: that the verdict lands in `verdict.md` under a "Recommendation" heading.

**Why I did not do it the first time.**

- The room: this session's safety check refused to execute the downloaded upstream server. That is a deliberate guard, so I did not work around it. I read the server's source instead (loopback only, no shell use).
- The run: a full board costs about a million tokens on your account and executes upstream's prompts and sub-agents. That is your call, not mine.

**What I need from you.**

1. Either run the room once yourself (I give you the one command), or tell me explicitly that I may run it.
2. Approval for one "quick" council, which is far cheaper than a full board.

**Do I have a clear process?** Yes for the room. For the run, the steps are clear but I expect to adjust the verdict parsing once I see real output.

1. Start the real room, check it shows the same twelve seats as the roster, add that check to update validation.
2. Run one quick council on a harmless question.
3. Confirm questions reach the Island and the verdict is filed; fix parsing if upstream's format differs.

Two smaller items ride on this: the room's colours and saving a PDF both need a reviewed change to the hardened browser view (`apps/desktop/src/browser.ts`).

---

## 4. Nothing reads from Azure DevOps into Sprints

**What it is.** The Sprints screen should show the team's real sprint: stories in their columns, pull requests, deployments, and a "Changed in ADO" notice when someone edits a story outside Amun. Today it shows only drafts made inside Amun.

**Where the code stands.**

- Built and tested: the rules (`packages/domain/src/work/planning.ts`, `flows.ts` `externalChange`), the tables (migration 29), and the screen. Tests feed them with direct commands.
- Already in the repository: Azure DevOps operations and GitHub pull-request reading (`apps/desktop/src/ado-operations.ts`, `github-pulls.ts`).
- Missing: a reader that pulls the current sprint on a schedule and writes it into the new tables, and the comparison that raises "Changed in ADO".

**Why I did not do it the first time.** It needs a live Azure DevOps connection, which means your company sign-in in Edge, and it shares its connector work with issue 1. Without real data I could only have built it against invented responses.

**What I need from you.**

1. Which Azure DevOps project and team the Sprints screen should read.
2. A sign-in through the supported route in company Edge.
3. How often it should refresh (I would propose on open, plus every 15 minutes).

**Do I have a clear process?** Partly. I know where the data must land. I have not yet read how much the existing Azure DevOps code can already fetch (iterations, board columns), so the size of the reader is not known. I would start with a read-only spike against your project and report before building.

---

## 5. Memory is local only

**What it is.** Amun remembers facts about your products and decisions. The handoff wants that memory to live in Notion and leaves the retrieval design open (vector, graph, Notion sync, backup). Today facts are stored on the Mac only.

**Where the code stands.**

- Built and tested: facts with history, replacing an older fact, and a question to you when two sources disagree (`record-claim` in `work-store.ts`, `memoryUpdate` in `flows.ts`). Settings shows how many facts are "not yet in Notion".
- Missing: any write to Notion, and any retrieval beyond direct lookup.
- Earlier Notion memory links from previous milestones are unchanged.

**Why I did not do it the first time.** It is open decision 2 in your handoff. Picking an architecture for you would have been guessing, and it would have been expensive to undo.

**What I need from you.** The decision: where memory lives (Notion as the home, or the Mac with Notion as a copy), and how it is searched. If it helps, I can write a short comparison of the options with a recommendation first.

**Do I have a clear process?** No, and I should not have one until you decide. Once you do, the Notion write would go through the same governed, reviewed path as other Notion publication.

---

## 6. The composer's `+` records file names only

**What it is.** The `+` button in the message box should let you attach files, take a screenshot, or pull in a source from GitHub, Azure DevOps or Notion. Today choosing files records their names; the contents never reach Firstmate. Screenshot and the three sources have no action.

**Where the code stands.**

- Built: the menu and the file chips (`apps/renderer/src/rebuild/composer.tsx`); names travel with the message (`onSend(text, files)`).
- Already in the repository: the earlier per-product document import (`packages/data/src/workspace-service.ts`, `apps/renderer/src/product-context.tsx`), which does read contents and still works in a product's document pane.
- Missing: carrying file contents through intake, with secret removal and group separation applied.

**Why I did not do it the first time.** Nothing blocked it. I ranked it below the shell, the model and the Council, and did not get back to it. It should have been stated that plainly in the handback.

**What I need from you.**

1. Which file types matter first (I would propose PDF, Word, Markdown, plain text, images).
2. A size limit per file.
3. Whether "from GitHub / ADO / Notion" is wanted now or later.

**Do I have a clear process?** Yes for files and screenshots: reuse the existing import, attach the result as a record linked to the open work area, test it. Not yet for the three sources; each depends on its connector.

---

## 7. The packaged build (done 13 November; memory at the limit with in-process graphics)

**What it was.** Everything had been run as a development build. The app you install is a packaged build, and the trusted-tester beta has a 500 MiB memory budget that must be measured on the packaged app.

**Result.** `pnpm package` succeeded (Apple chip, ad-hoc signed, 783 MB on disk).

| Check on the packaged app                                                    | Result                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Rebuild journey with accessibility scans, light and dark                     | Passes                                                                             |
| Council screen                                                               | Shows the twelve advisors from the bundled pinned upstream                         |
| Council question server started from inside the package                      | Works: question reached the bridge, answer returned                                |
| Bundled runtimes self-contained (Pi, terminal, database, sign-in, Firstmate) | Pass                                                                               |
| Pi and Firstmate packaged proofs (synthetic homes)                           | Pass                                                                               |
| Startup                                                                      | 342 to 440 ms against a 3,000 ms budget: passes                                    |
| **Memory, new shell**                                                        | **534 to 551 MiB at first screen, 558 to 574 MiB on Home, against 500 MiB: fails** |
| Memory, earlier shell in the same package                                    | 525 to 538 MiB: also fails, as it did before the rebuild                           |

So the rebuild adds roughly 10 MiB at launch and 30 MiB on Home to a budget that was already missed by about 25 MiB. The increase is spread across the window (about +9), the service (about +8) and graphics (about +12). The budget is unchanged and no waiver is claimed.

Measured with `scripts/rebuild-performance-proof.ts` (new, same method as the existing proof: three launches, working set summed across the five processes, no sign-in and no agents running).

### Memory reduction, 13 November

Three safe changes were made and measured on a rebuilt package:

1. The new shell no longer loads the earlier shell at startup. Its sign-in prompt moved to its own small file; Settings, the agent session view, the sign-in details panel and Backlog load when first opened (`apps/renderer/src/rebuild/lazy.tsx`).
2. The Council is installed and read only when the Council screen or Settings is open, not at every launch.
3. The Council's 1.5-second check no longer builds a full snapshot when the Chair has asked nothing.

| Measurement (three launches each)                                                      | First screen       | Home           |
| -------------------------------------------------------------------------------------- | ------------------ | -------------- |
| Earlier shell, same package                                                            | 525 to 538 MiB     | not measured   |
| New shell before the changes                                                           | 534 to 551 MiB     | 558 to 574 MiB |
| **New shell after the changes**                                                        | **525 to 528 MiB** | **549 MiB**    |
| After the changes, with graphics run inside the main process (experiment, not applied) | 458 to 467 MiB     | 484 to 486 MiB |

The new shell now starts at the same figure as the earlier one, and Home is about 15 MiB lower than before. It still fails 500 MiB.

**The one lever that passes.** Launching with Chromium's `--in-process-gpu` switch removes the separate graphics process and measures 484 to 486 MiB on Home. It is not applied. The trade-offs: a graphics crash would take the whole app down instead of being restarted quietly, Chromium does not treat this mode as its normal desktop configuration, and part of the saving is shared memory that the budget's method counts once per process. Terminal and editor smoothness were not measured in this mode.

Switches tried and rejected: low-end device mode (no change), turning off GPU rasterisation (worse, 575 to 588 MiB), no spare renderer (no change), scale factor 1 (no change). Earlier work had already ruled out software rendering and V8's size mode.

Checks after the changes: 929 unit tests, lint, types and formatting pass; the rebuild journey passes on the package in light and dark. In the earlier shell, the accessibility suite's checks pass but its temporary-folder cleanup now fails intermittently; this also happens with the memory changes backed out, so it comes from the fresh runtime staging, not from this work.

### In-process graphics: smoothness and stability test, 13 November

Tested on the packaged app by launching it with `--in-process-gpu`; no code was changed. "Separate" is today's behaviour.

| Check                                                                             | Separate graphics process                                        | In-process graphics                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Memory at launch / on Home                                                        | 525 to 528 / 549 MiB                                             | 458 to 467 / 482 to 486 MiB                                                          |
| Frame time while changing screens, resizing and opening search (about 700 frames) | median 8.3 ms, worst 9.8 ms                                      | median 8.3 ms, worst 9.4 to 10.4 ms in three runs; one run had a single 182 ms hitch |
| Frame time over 280 screen changes (about 5,000 frames)                           | worst 9.5 ms, none over 33 ms                                    | worst 10.5 ms, none over 33 ms                                                       |
| Terminal echo (earlier shell)                                                     | 25 to 26 ms                                                      | 25 to 27 ms                                                                          |
| Editor typing with preview and terminal open                                      | median 8.3, p95 9.2 to 9.7 ms                                    | median 8.3, p95 9.1 to 9.4 ms                                                        |
| Graphics features                                                                 | compositing, rasterisation, WebGL on                             | the same                                                                             |
| Rebuild journey, light and dark; four earlier-shell suites                        | pass                                                             | pass                                                                                 |
| **Simulated graphics crash**                                                      | **App carries on; a new graphics process starts within seconds** | **The whole app closes**                                                             |

So smoothness is the same and stability under normal use is the same. The difference is the failure case: today a graphics crash is invisible, and in this mode it closes Amun. How often graphics crashes happen on tester Macs is not something I can measure here.

Two more facts that bear on the decision:

- With in-process graphics there are four processes instead of five. The earlier memory record stresses that all five processes stay counted. This mode does not hide a process, but some of its saving is shared memory no longer being counted twice.
- The budget is measured at launch. After 280 screen changes the app measured 646 MiB (separate) and 578 to 585 MiB (in-process). This is not a leak: after garbage collection the page's own memory stays at about 6 MiB with a constant number of elements, and the window's working set levels off near 180 MiB.

### Looking for a fix with the separate graphics process, 13 November

You asked for a real fix first, and in-process graphics only if that failed. It failed, for a structural reason.

**Root cause.** The method adds up every process's working set, and each process counts Electron's own shared code again. An empty Electron app with the same five processes (one blank window, one idle helper) measures 437 to 457 MiB this way. Amun's own share is about 70 MiB at launch and 95 MiB on Home, so passing with five processes would mean cutting more than half of everything Amun itself uses. In macOS's own "memory" figure (which counts shared pages once) the empty app is about 100 MiB and Amun about 163 MiB.

| Attempt                                                                                                                             | Result                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Launch switches on the empty app: graphics backend (two variants), raster threads, allocator hardening off, background services off | 434 to 459 MiB: none lowers the floor                                                                                                                                                      |
| Service process, traced step by step                                                                                                | 93 MiB against 73 MiB for an empty helper with the database open. The 20 MiB is the core shared code (validation schemas) plus 4 MiB opening the workspace. Nothing optional left to defer |
| Window process, bundle by bundle                                                                                                    | Stylesheet and fonts 5 MiB, icons and React 5 MiB, app code 3 MiB, first screen 11 MiB, **validation library and contract schemas 14 MiB**                                                 |
| Cap on the script engine's short-lived memory (four settings)                                                                       | No change                                                                                                                                                                                  |
| Styles that create extra graphics layers                                                                                            | None in the new shell                                                                                                                                                                      |

The one sizeable item is the validation library (zod), about 14 MiB in the window and a similar share of the service. It is what checks every message between the service and the window, so I did not remove or thin it to pass a memory test. Replacing it with a lighter validator that performs the same checks is possible but touches every contract; it would bring five-process Home to roughly 520 to 535 MiB, still over.

### In-process graphics with a crash fallback (built, not committed)

Since no fix was reachable, graphics now run inside the main process by default, with a safeguard.

- `apps/desktop/src/graphics-mode.ts` keeps a small record in the profile (`graphics-mode.json`): which mode this launch uses and whether it exited cleanly.
- After an unclean exit of an in-process launch, the next launch uses the separate graphics process.
- If that safe launch is fine, the following launch tries in-process again. A clean in-process exit clears the doubt.
- After a second unclean in-process exit the app stays on the separate process for that version. A new version starts fresh.
- `--amun-separate-graphics` or `AMUN_SEPARATE_GRAPHICS=1` forces the separate process.

An unclean exit can also be a force-quit or a power cut. Those cost one launch in the separate process (about 549 MiB on Home) and nothing else.

| Check on the packaged app                                                                              | Result                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory proof, 18 launches of the final build (six runs of three)                                       | First screen 459 to 482 MiB. Home 482 to 501 MiB: five of the first nine launches read 499 to 501 (two of them 501, over budget), the last nine read 484 to 488. Four of the six runs passed; the two that failed were the first two, straight after packaging |
| Startup                                                                                                | 319 to 445 ms; the first launch after packaging took 4,395 ms (over the 3,000 ms budget, as recorded before for a freshly built package)                                                                                                                       |
| Fallback proof (`scripts/graphics-fallback-proof.ts`): six launches of one profile, two of them killed | Mode and process count are as designed at every step, ending on the separate process after the second kill                                                                                                                                                     |
| Soak: 280 screen changes with resizes and minimise/restore                                             | App stays up, no window crash, median frame 8.3 ms, 99th percentile 9.4 ms, no frame over 50 ms                                                                                                                                                                |
| Rebuild journey with accessibility scans, and four earlier-shell suites (six tests)                    | Pass                                                                                                                                                                                                                                                           |
| Unit tests                                                                                             | 938 pass, including 9 for the fallback rules                                                                                                                                                                                                                   |

**What this does not do.** A graphics failure in this mode still closes the app once; the fallback only protects the launches after it. I could not trigger a real graphics failure in-process other than by killing the app, so how often it happens on tester Macs is unknown. Memory still rises with use (592 MiB after the soak at a larger window size), as in either mode. And the margin on Home is thin: the higher readings are one extra window-sized graphics buffer (about 15 MiB) that is sometimes kept after the setup screens.

**Not done.** The full earlier packaged suite (`pnpm test:packaged`) was not run end to end, because most of its journeys drive the earlier shell.

**What I need from you.** Whether this result is acceptable for the beta gate as measured (it is at the limit, not comfortably under it), and whether you want the lighter-validator work for real margin.

---

## Suggested order

1. **7, packaged build.** Done; memory budget fails (see above).
2. **6, file contents.** Needs three small answers.
3. **2, live model turn.** Needs one sign-in; unblocks smarter intake.
4. **3, room and one quick council.** Needs your run or permission, and the spend.
5. **1, then 4.** Publishing first, then the Azure DevOps reader, since they share the connection.
6. **5, memory.** After your decision.
