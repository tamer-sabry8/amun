# Implement Amun’s Product, Project and Initiative workflow — Status & Next Agent Assignment (22 November 2026)

This handoff is written for an AI agent that has **no prior context about Amun**. Read this entire file and `AGENTS.md` at the repository root before running any commands or editing code.

---

## Update — 22 November 2026, evening (PRs 57–61, packaged-app tests)

**Read this section first.** It supersedes the status in sections 1–2 wherever they disagree. The full test report is `releases/AMUN-E2E-TEST-REPORT-2026-11-22.md`.

### What landed on `main`

| PR                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#57](https://github.com/tamer-sabry8/amun/pull/57) | **Ad-hoc beta DMG no longer crashes at launch.** The PR56 DMG was signed ad-hoc with hardened runtime on, so macOS refused to load Electron Framework ("different Team IDs"). Build betas with `npm ci && npm run dist:mac:beta` (identity `-`, notarize off, hardened runtime off). `after-sign.js` now fails any ad-hoc build with hardened runtime. Developer ID builds are unaffected.                                                                                                                                                                                                                                                                                                                                                                                           |
| [#58](https://github.com/tamer-sabry8/amun/pull/58) | **Firstmate's answers are no longer lost when the captain opens another product mid-turn.** `firstmate.ts` used to abandon every waiting turn on a product switch; all products share one Firstmate, so answers (and the renames, client changes and question cards inside them) vanished. Intake naming fixed too: "called X: description" names the work `X`, and "clients" is no longer read as a client. Adds the test report.                                                                                                                                                                                                                                                                                                                                                   |
| [#59](https://github.com/tamer-sabry8/amun/pull/59) | **Jira and Linear connections** through each provider's hosted MCP server with browser sign-in (Keychain storage), Settings › Tools cards, and governed epic/story/sprint publishing with read-back. Linear cycles can only be assigned, not created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [#60](https://github.com/tamer-sabry8/amun/pull/60) | **The crew's PRD reaches Amun.** A matched PRD report's Markdown files (inside PRD's own home only) are filed in the Library with the request, and a product's PRD becomes its next PRD version under an objective named after the product, plus a product source. The PRD panel lists objectives without an interview. Firstmate can raise `{"do":"draft-stories"}` to run "Generate stories" for the chat's product and approved PRD, inline in that chat ("Backlog comparison pending"). Also: report matching accepts `corr=` in either order and Markdown named by file name alone; the PRD panel no longer repeats "Product understanding" (duplicate React keys); a product with no allowed-model list may use Firstmate's model (**policy change for the owner to review**). |
| [#61](https://github.com/tamer-sabry8/amun/pull/61) | **Jira and Linear read-back into Amun's screens.** The product **Stories** tab lists Jira/Linear epics and their stories (key, link, live status, acceptance count). **Sprints** shows Jira sprints and Linear cycles beside Azure's, with stories grouped by the provider's status. Read only; Amun's own publication record is the base, and status, sprint state and dates are read live.                                                                                                                                                                                                                                                                                                                                                                                         |
| [#63](https://github.com/tamer-sabry8/amun/pull/63) | **Read-back fixes from Codex review of #61.** Links are scoped to their plan (ids repeat across plans); Linear cycles appear in Sprints from issue membership, since Linear never creates them through a plan; a story Jira removed from its sprint leaves it; each Jira item is read from the site it was published to.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The beta DMG with all of this is built with `npm run dist:mac:beta`. Copies of each test build are in `~/Documents/ChatGPT/Amun/releases/Amun-0.16.1-wiring-*-arm64.dmg`. Installed size is about 538.5 MB vs the 537.7 MB baseline. Memory measured 487 MiB at launch and 671 MiB after an hour of tests (over the 500 MiB budget).

### What was verified live in the packaged app (22 November)

- **Azure DevOps, spec scenarios (`TahalufCollection → POCs → POCs Team → Backlog items`):**
  - **Product → Backlog:** connect project, pick team and level, live team backlog (list/board, tag filter).
  - **Sprints:** overview with Completed collapsed and entries labelled product + team. Sprint 5 detail shows goal → blockers → stories by real status.
  - **Two-pane planner:** + Sprint stages locally ("Add 1 story to Sprint 5", "1 change saved on this device"), Undo restores it, zero sends while staging.
  - **Search:** typing filters locally; Search sends exactly one prompt.
  - **Navigation:** each click sends one read-only prompt.
  - **Discuss sprint:** the first message creates a "Sprint 5" chat in the product folder.
  - No write to Sprint 5 (read-only per AGENTS.md).
- **Jira (transfrmai.atlassian.net, project SCRUM, board 1):**
  - Firstmate read the live project (no Story type, so stories became Tasks), asked for sprint dates, and raised a 17-item plan.
  - After approval on Home, Amun created epics SCRUM-13–16, tasks SCRUM-17–28 and sprint 6 "Badge Desk Sprint 1" in **41 s**, with read-back confirmed.
- **Jira and Linear sign-in** from Settings › Tools in Edge (the captain pressed Accept/Continue).
- **Crew PRD → Amun:**
  - Badge Desk PRD filed automatically as PRD v1 (Library, objective, source).
  - Approved in the PRD panel.
  - A chat request made Firstmate raise `draft-stories`, and Amun drafted **11 stories and 34 tasks** in about 5 minutes (request delivered: "Story drafts are ready in the PRD review").
- **Earlier tests 1–4 (Sales Prospects, Invoiced, Mira, routing):** see the test report. All crew deliverables arrived (PRD in about 3 min, BRD about 1 min, research about 3 min, pricing, 7 wireframes, Mira launch simulation **no-go**).

### Still open (next agent)

1. **Check PR #61 in the packaged app:** Badge Desk's Stories tab should list the 4 Jira epics with 12 tasks, and Sprints should show "Badge Desk Sprint 1" (7–18 Dec) with its 5 tasks. Then publish Invoiced to **Linear** (PRD has written the Linear plan content for team TRA; Firstmate has not raised the plan yet) and check Linear read-back.
2. **Publication receipt:** after a Jira/Linear plan publishes, nothing tells the originating chat or Firstmate what was created; the request stays "waiting/working". The spec wants the receipt, with each item's ID, in the originating chat.
3. **Plan review card** lists item summaries only. The spec wants each item's parent, sprint and destination before approval.
4. **Local sprints holding stories ("Sprint kept in Amun", spec lines 146, 235, 280):** not built. Needs an owner-approved preview first (UI rule).
5. **Bugs found:**
   - Sprints overview counts stories only for the selected sprint (0/0 vs 0/2).
   - The backlog search prompt names the backlog "Microsoft.RequirementCategory".
   - Mira has 3 "Release: v1.0" records from launch-card edits.
   - A raw `amun` block (report with role "Amun") is shown as code in the chat.
   - Request statuses go stale ("needs-decision" after the question was answered).
   - Near-duplicate names ("Sales Prospect") aren't caught by intake.
   - Firstmate's unprompted check-in replies land in "Chat with Firstmate" (by design, per the 20 November rule).
6. **PRD panel:** a crew objective still shows the interview's empty "Product understanding" section. Hiding it is a UI change that needs approval.
7. **Memory** over budget (671 MiB after an hour). Navigation pings cost a Firstmate turn each (specified, but they queue behind captain messages).
8. **Environment trap:** `~/Applications/Amun Firstmate Latency Test/…app` has the same bundle ID, so launching Amun by ID can start that old copy. Open `/Applications/Amun.app` by path.

---

## 0. Quick Onboarding for a New Agent: What Amun Is & How It Works

### What Amun Is

Amun is a local-first macOS desktop application (Electron + TypeScript + React) built for a Product Manager (the captain, Tamer).

1. **Captain → Firstmate → Crew (Core Architecture):**
   - The captain talks **only** to one lead AI coordinator called **Firstmate** (running via the **Pi** runtime in the captain's Firstmate home, hosted over WebSocket RPC by the **Paseo** daemon in `packages/server`).
   - Firstmate orchestrates and delegates all real work to specialist crew members (**secondmates** managed by Firstmate/Herdr, such as `researcher` / **Research & Insights**, `prd` / **Product Manager**, `designer` / **UX**, `product-marketing` / **Product Marketing**, `solution-architect` / **Solution & AI Architecture**, etc.).
   - Never bypass Firstmate, never write directly into Firstmate's operational home directory from Amun code, and never remove delegation, supervision, or approval gates.
2. **Where the Code Lives (`main` branch at `https://github.com/tamer-sabry8/amun`):**
   - `packages/domain/src/work/`: Pure domain logic (work intake, routing, chats, request references `amun-r-…`, PRD discovery & 20-point coverage, decomposition, release & launch state machine, permissions).
   - `packages/contracts/src/`: Zod schemas between the UI and daemon (`work.ts`, `backlog.ts`, `auth.ts`, `native-pi.ts`).
   - `packages/work-store/src/`: SQLite work store (`work-store.ts`, `migrations.ts`) and tracker services (`ado-service.ts`, `ado-governed-writes.ts`, `ado-operations.ts`).
   - `packages/amun-ui/src/`: The React UI (`rebuild/app.tsx`, `rebuild/home.tsx`, `rebuild/work-session.tsx`, `rebuild/screens.tsx`, `rebuild/work-cards.tsx`, `rebuild/project-checklist-and-release.tsx`, `daemon/contract-adapter.ts`).
   - `packages/server/src/server/amun/`: Paseo daemon endpoints for Amun, Firstmate turns, connections, and delivery sync.
   - `packages/desktop/`: Electron shell and `electron-builder.yml` packaging config.

---

## 1. Status Checklist: What Is DONE vs. What Is NOT DONE

All 17 coding items from the 22 November 2026 workflow handoff were implemented and merged into `main` in **PR #56** (`f7694e3`):

| #      | Work Item                                                                                                                                                                                                                           | Status                                                        | Where It Lives / Notes                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | Explicit named intake (`Product`, `Project`, `Initiative`, `RFP`), group scope (`Work`, `Personal`), same-group duplicate prompt, ordinary questions staying in `General` / current chat                                            | **DONE**                                                      | `packages/domain/src/work/model.ts` (`newWorkNamed`, `routeNewWork`), `packages/amun-ui/src/rebuild/app.tsx`, `home.tsx`                                                                                                                                                                                          |
| **2**  | Chat moves & selective unfinished request reassignment (`amun-r-…`) preserving request identity, delivery receipts, and original chat links                                                                                         | **DONE**                                                      | `packages/domain/src/work/requests.ts`, `packages/work-store/src/work-store.ts`, `packages/amun-ui/src/rebuild/work-session.tsx`                                                                                                                                                                                  |
| **3**  | Rule 31: Standalone `task` user-facing label renamed to **Initiative** / **Initiatives** (keeping internal `type: "task"` and legacy `"task"` prompt compatibility)                                                                 | **DONE**                                                      | `view-model.ts`, `shell.ts`, `flows.ts`, `home.tsx`, `sidebar.tsx`, `screens.tsx`, `settings.tsx`, `move-offers.ts`                                                                                                                                                                                               |
| **4**  | In-place conversion from **Initiative** to **Project** (`convert-task`) preserving ID, chat, history, links, and group + linking a Project to a Product (`Implements product` / `relate-areas` / `link-product`)                    | **DONE**                                                      | `packages/amun-ui/src/rebuild/work-session.tsx`, `screens.tsx`, `view-model.ts`                                                                                                                                                                                                                                   |
| **5**  | Project intake parsing `"for client X"`, priority, and due date across both Home fast-path and fallback intake + scoped Project delivery interview in chat                                                                          | **DONE**                                                      | `packages/domain/src/work/model.ts`, `app.tsx`, `home.tsx`, `view-model.ts`                                                                                                                                                                                                                                       |
| **6**  | Small-project checklist & handover receipt UI inside the Project side panel (after before/after visual approval)                                                                                                                    | **DONE**                                                      | `packages/amun-ui/src/rebuild/project-checklist-and-release.tsx` (`ProjectChecklistPane`), `work-session.tsx`, preview in `docs/preview/2026-11-22-work-intake-and-delivery/index.html`                                                                                                                           |
| **7**  | Live Mac browser verification of intake, duplicate detection, chat identity, linking, and Initiative-to-Project conversion                                                                                                          | **DONE: packaged DMG run 22 Nov (see Update)**                | Verified in browser against built UI; needs full end-to-end packaged DMG run with live Firstmate & timing measurements (see Section 2 below).                                                                                                                                                                     |
| **8**  | Unify existing Herdr/Firstmate secondmates (`researcher` ↔ `"Research & Insights"`, `prd` ↔ `"Product Manager"`, `designer` ↔ `"UX"`, `product-marketing` ↔ `"Product Marketing"`) + relay `prd-discovery-charter-v1` via Firstmate | **DONE**                                                      | `packages/amun-ui/src/daemon/contract-adapter.ts` (`secondmateRoleAliases`, `toWorkSnapshot` deduplication, `registerPool`), `packages/domain/src/work/held-tasks.ts`                                                                                                                                             |
| **9**  | Single problem-statement format (_Evidence-led 5W+H_ default, _Jobs to Be Done_, _Outcome–Evidence–Scope_) + 20-point PRD coverage checklist                                                                                        | **DONE**                                                      | `packages/domain/src/work/held-tasks.ts`, `packages/domain/src/work/release-launch.ts` (`evaluatePrdDiscovery`)                                                                                                                                                                                                   |
| **10** | Controlled discovery & PRD verification (3+ why probes, 1 format, 20-point coverage, non-applicable reason check)                                                                                                                   | **DONE (Unit) / NEEDS LIVE FIRSTMATE E2E**                    | Unit tested in `packages/domain/tests/release-launch.test.ts`; live multi-product reverse-engineering tests assigned below.                                                                                                                                                                                       |
| **11** | PRD decomposition into epics, stories, acceptance criteria, and first-release slice                                                                                                                                                 | **DONE**                                                      | `packages/domain/src/work/release-launch.ts` (`validatePrdDecomposition`)                                                                                                                                                                                                                                         |
| **12** | Tracker & board resolution, local draft fallback, preview before publish, provider ID/parent/membership read-back, and partial/uncertain write reconciliation                                                                       | **DONE: ADO & Notion; Jira & Linear in #59/#61**              | **IMPORTANT GAP FOR NEXT AGENT:** Only Azure DevOps (`ado`) and Notion (`notion`) connectors exist today. **Jira** and **Linear** connectors (`connections.save`, `connections.check`, governed epic/story/sprint creation & read-back) are **NOT built yet** and must be implemented for the tests in Section 2! |
| **13** | Sprints filtered to Product & Project, Summary/Planning views, work-area sprint chat, and governed new Sprint creation (`create-sprint` / `createTeamIteration`)                                                                    | **DONE (ADO); Jira/Linear sprints shown via #61**             | `packages/contracts/src/backlog.ts`, `packages/work-store/src/ado-governed-writes.ts`, `ado-operations.ts`, `ado-service.ts`. Needs Jira & Linear sprint creation support added.                                                                                                                                  |
| **14** | Live tracker verification of PRD → Epics → Stories → Sprints                                                                                                                                                                        | **DONE for Jira (live 22 Nov); Linear pending**               | Assigned to next agent in Section 2 below.                                                                                                                                                                                                                                                                        |
| **15** | Delivery tracking across Sprints, Chat, Activity, and Portfolio (`workProgress` from sprints, story counts, blockers, stale indicators)                                                                                             | **DONE**                                                      | `packages/amun-ui/src/rebuild/work-cards.tsx`, `screens.tsx`                                                                                                                                                                                                                                                      |
| **16** | Production release & launch tracking card (`Readiness`, `Scheduled`, `Deploying`, `Verified live`, `Failed`, `Rolled back`) with Repo version/SHA binding and Release-Owner Receipt for air-gapped/client sites                     | **DONE**                                                      | `packages/amun-ui/src/rebuild/project-checklist-and-release.tsx` (`ProductionReleaseCard`), `screens.tsx` (Roadmap › By release), `work-cards.tsx` (Portfolio › Summary)                                                                                                                                          |
| **17** | Verification of production release/launch tracking (stale artifact, failed smoke check, partial evidence, cancellation, rollback, manual receipt)                                                                                   | **DONE (Unit & Preview) / NEEDS LIVE MIRA LAUNCH SIMULATION** | Unit tested in `packages/domain/tests/release-launch.test.ts`; live simulation assigned in Test 3 below.                                                                                                                                                                                                          |

---

## 2. Assignment for the Next Agent (Computer Use + DMG Build + 4 End-to-End Stress Tests)

### Primary Goal of This Assignment

The captain wants you to:

1. **Build the latest macOS DMG (`Amun-<version>-arm64.dmg`), install `Amun.app`, and launch the real packaged desktop app on this Mac using your Computer Use capabilities.**
   - Check and report the installed `Amun.app` size in Finder (per `AGENTS.md`, compare against the ~537.7 MB baseline).
2. **Build any missing connector code required by the tests below (specifically Jira and Linear connections, epic/story/sprint creation, and sprint start)** if they are not already wired in Settings › Tools and the governed plan/backlog pipeline.
3. **Run the 4 real-world stress tests below through the Amun UI using Computer Use.**
4. **Measure Firstmate & Crew timing on every turn** (how many seconds Firstmate takes to acknowledge, how long each secondmate takes to finish research/PRD/BRD/wireframes/stories, and where timeouts, stalls, or slow turns happen).
5. **Document every UX gap, missing button, confusing flow, or routing bug you encounter** while using the interface as a real user.

### How to Build the Latest DMG and Install `Amun.app`

From `/Users/tamersabry/Documents/Antigravity/Amun_App` (on a new branch created from `main`):

```bash
# Builds all desktop inputs, the Electron main process and the ad-hoc-signed macOS arm64 DMG
npm ci
npm run dist:mac:beta
```

- Ad-hoc beta builds must have hardened runtime off (`dist:mac:beta` passes `-c.mac.hardenedRuntime=false`). With it on, macOS refuses to load Electron Framework and Amun crashes at launch ("different Team IDs"); this is what happened to `Amun-PR56-65fd8f8-arm64.dmg`. The after-sign check now fails such a build instead of producing a DMG that cannot open.

- The built DMG and `Amun.app` will be in `packages/desktop/release/` (e.g. `packages/desktop/release/mac-arm64/Amun.app` and `packages/desktop/release/Amun-0.16.1-arm64.dmg`).
- Mount/install `Amun.app` (or copy to `/Applications/Amun.app`), measure its byte size, launch it, and drive it via **Computer Use**.

---

### The 4 End-to-End Tests to Execute & Measure

#### Test 1: Product `"Sales Prospects"` (Reverse-Engineer from `ethanplusai/sellbird` → PRD → Jira Epics, Stories & Sprints)

- **What to do in Amun:**
  1. Create a new **Product** named **`Sales Prospects`**.
  2. Vision: A SaaS product that finds prospects for our users (clients), building the interface on top of `https://github.com/ethanplusai/sellbird`.
  3. Instruct Firstmate to **autonomously reverse-engineer** from `https://github.com/ethanplusai/sellbird`:
     - The **Vision**
     - The **Problem Statement** (using the new single problem-statement format rule)
     - The **Features** and full **PRD** (all on its own from the repository without requiring you to hand-write them).
  4. **Connect to Jira:**
     - Check if Amun has a working Jira connection in Settings › Tools (`packages/work-store` / `packages/server` / `packages/amun-ui`).
     - **If there is no Jira connection or Jira backlog/sprint write path, write the code to add Jira support** (connection setup, authentication, project/board resolution, and governed creation of Epics, Stories, and Sprints).
  5. From the reverse-engineered `Sales Prospects` PRD, have Amun create **Epics**, **Stories**, and **Sprints** in Jira, including **creating new sprints** for the captain.
  6. **Record:** Total time taken for repo analysis, PRD generation, Jira connection, and epic/story/sprint creation, plus any missing UI buttons or friction.

#### Test 2: Project `"Invoiced"` (Reverse-Engineer from `ethanplusai/billr` → Simple BRD → Linear Epics, Stories & Sprints)

- **What to do in Amun:**
  1. Create a new **Project** named **`Invoiced`** — a SaaS product to _"bill your clients from it"_, reverse-engineered from `https://github.com/ethanplusai/billr`.
  2. Have Firstmate/crew reverse-engineer the repo and build a **simple BRD (Business Requirements Document)**.
  3. **Connect to Linear:**
     - Check if Amun has a working Linear connection in Settings › Tools (`packages/work-store` / `packages/server` / `packages/amun-ui`).
     - **If Linear is not connected or lacks code for governed writes, write the code to add Linear support** (connection setup, team/project/cycle resolution, and governed creation of Epics/Projects, Issues/Stories, and Cycles/Sprints).
  4. Create the **Epics**, **Stories**, and **Sprints (Cycles)** for `Invoiced` and publish them to **Linear**.
  5. **Record:** Timing for each step, how Project vs. Product flows felt in the UI, and any missing buttons or broken flows.

#### Test 3: Product `"Mira"` (Reverse-Engineer from `chatwoot/chatwoot` → PRD + Competitive Analysis + Pricing + Wireframes + Linear Sprints → Simulate Code Done & Launch)

- **What to do in Amun:**
  1. Create a new **Product** named **`Mira`** — a customer service chat product reverse-engineered from `https://github.com/chatwoot/chatwoot`.
  2. Have Firstmate coordinate its crew (`Product Manager`, `Research & Insights`, `Product Marketing`, `UX`) to produce:
     - **PRD**
     - **Competitive Analysis**
     - **Pricing analysis & Pricing Recommendation**
     - **Wireframes**
     - **Epics, Stories, and Sprints**
  3. Add the sprints and stories to **Linear** and **start the sprint**.
  4. **Simulate that code is done & run Launch Activities:**
     - Look at how the interface lets the captain (or Firstmate) know/simulate that code and stories are done so launch activities can begin.
     - _Note from the captain:_ "then ask me to simulate that code is done (not sure how u tell me) so we can do the launch activities."
     - Test moving stories to Done, opening the **Production Launch** card (on Portfolio / Roadmap) and running the launch activities (readiness check, repo tag/SHA approval, release-owner receipt / smoke verification, and post-launch updates/collateral).
     - Document clearly if there is a missing button or unclear handoff between _"Sprint stories are done"_ and _"Start launch activities"_.

#### Test 4: Chat Switching & "Trick Amun" Routing Stress Test

- **What to do in Amun:**
  1. Rapidly switch between chats across `Sales Prospects`, `Invoiced`, `Mira`, and `General`.
  2. Start a chat inside one folder (e.g., inside `Sales Prospects`), then type a prompt that is actually about `Invoiced` or `Mira`, or ask to create another product/project from inside an existing project folder, or ask a completely unrelated general question in the middle of a product thread.
  3. Try to trick Amun several times with ambiguous names, spelling variants, cross-folder follow-ups, and out-of-order replies.
  4. Observe and record:
     - Which chats appear under which folder in the sidebar (`Recent`, `Folders`, `General`).
     - What Amun understands automatically vs. when it holds the message with a move/keep card vs. when it misfiles or loses context.
     - Whether unread indicators, drafts, and `[Amun request amun-r-…]` delivery links land on the exact right message when switching tabs while Firstmate is still working.

---

## 3. What to Deliver in Your Report Back to the Captain

Create a clear, structured report (and update this handoff) covering:

1. **DMG Build & Installation Receipt:** Exact DMG path, installed `Amun.app` byte size vs. 537.7 MB baseline, startup time, and memory reading.
2. **Jira & Linear Integration Status:** What code you added to connect and publish Epics, Stories, and Sprints/Cycles to Jira and Linear, and what credentials/tokens are needed from the captain if not already in Keychain/env.
3. **Timing & Latency Table for Firstmate & Secondmates:**
   - Wall-clock duration for every prompt across Tests 1–4 (time to Firstmate initial reply, time to crew delegation, time to final document/artifact delivery, and any stalls or missed wakeups).
4. **UI/UX Gap & Friction Audit:**
   - Every missing button, awkward transition, or broken flow discovered during Tests 1–4 (especially around: reverse-engineering a GitHub repo URL, connecting Jira/Linear, starting a sprint, knowing when code is done to trigger launch activities, and tricking chat routing).

---

## 4. Reference: Original 22 November 2026 Specification (Completed in PR #56)

_(Kept below for specification reference)_

### Section 1: Intake and Chat Reuse

- Explicit named creation (`Product`, `Project`, `Initiative`, `RFP`) uses the active or sole eligible group, asks once when ambiguous, asks on same-group duplicates (`Open <name>`, `Create another`, `Keep it here`), preserves ordinary chats/drafts, and keeps request identity (`amun-r-…`) across moves, retries, and restarts.
- Standalone tasks use the user-facing label **Initiative** (Rule 31) while keeping internal `task` type and legacy `"task"` input compatibility, and support in-place conversion to **Project** (`convert-task`). Bounded Projects can link to a Product via `Implements product` (`relate-areas` / `link-product`).

### Section 2: Product Manager Discovery Charter & 20-Point Coverage

- Product Manager (`prd`) runs 3+ distinct why probes, collaborates with `researcher` (**Research & Insights**), `product-marketing` (**Product Marketing**), and `designer` (**UX**), selects one problem-statement format (_Evidence-led 5W+H_ default, _Jobs to Be Done_, or _Outcome–Evidence–Scope_), and tracks the 20-topic PRD coverage checklist (`evidenced`, `captain-confirmed`, `assumption`, `open`, `not_applicable` with reason).

### Section 3: Backlog Decomposition & Governed Sprint Planning

- Traces PRD requirements to Epics, Stories, acceptance criteria, and a first-release slice while excluding non-goals.
- Governed `create-sprint` creates the iteration node, subscribes the team, and independently reads back team iteration visibility, separate from committing story membership.

### Section 4: Delivery & Production Launch Tracking

- Tracks delivery across Sprints, Chat, Activity, and Portfolio (`workProgress`) and tracks production launches across `Readiness`, `Scheduled`, `Deploying`, `Verified live`, `Failed`, and `Rolled back` with exact repo version/SHA approval binding and Release-Owner Receipts for connected or air-gapped client environments.
