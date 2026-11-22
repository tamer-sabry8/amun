# Implement Amun’s Product, Project and Initiative workflow — Status & Next Agent Assignment (22 November 2026)

This handoff is written for an AI agent that has **no prior context about Amun**. Read this entire file and `AGENTS.md` at the repository root before running any commands or editing code.

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
| **7**  | Live Mac browser verification of intake, duplicate detection, chat identity, linking, and Initiative-to-Project conversion                                                                                                          | **DONE (Preview daemon) / NEEDS FULL DMG RUN**                | Verified in browser against built UI; needs full end-to-end packaged DMG run with live Firstmate & timing measurements (see Section 2 below).                                                                                                                                                                     |
| **8**  | Unify existing Herdr/Firstmate secondmates (`researcher` ↔ `"Research & Insights"`, `prd` ↔ `"Product Manager"`, `designer` ↔ `"UX"`, `product-marketing` ↔ `"Product Marketing"`) + relay `prd-discovery-charter-v1` via Firstmate | **DONE**                                                      | `packages/amun-ui/src/daemon/contract-adapter.ts` (`secondmateRoleAliases`, `toWorkSnapshot` deduplication, `registerPool`), `packages/domain/src/work/held-tasks.ts`                                                                                                                                             |
| **9**  | Single problem-statement format (_Evidence-led 5W+H_ default, _Jobs to Be Done_, _Outcome–Evidence–Scope_) + 20-point PRD coverage checklist                                                                                        | **DONE**                                                      | `packages/domain/src/work/held-tasks.ts`, `packages/domain/src/work/release-launch.ts` (`evaluatePrdDiscovery`)                                                                                                                                                                                                   |
| **10** | Controlled discovery & PRD verification (3+ why probes, 1 format, 20-point coverage, non-applicable reason check)                                                                                                                   | **DONE (Unit) / NEEDS LIVE FIRSTMATE E2E**                    | Unit tested in `packages/domain/tests/release-launch.test.ts`; live multi-product reverse-engineering tests assigned below.                                                                                                                                                                                       |
| **11** | PRD decomposition into epics, stories, acceptance criteria, and first-release slice                                                                                                                                                 | **DONE**                                                      | `packages/domain/src/work/release-launch.ts` (`validatePrdDecomposition`)                                                                                                                                                                                                                                         |
| **12** | Tracker & board resolution, local draft fallback, preview before publish, provider ID/parent/membership read-back, and partial/uncertain write reconciliation                                                                       | **DONE for ADO & Notion / NOT DONE for Jira & Linear**        | **IMPORTANT GAP FOR NEXT AGENT:** Only Azure DevOps (`ado`) and Notion (`notion`) connectors exist today. **Jira** and **Linear** connectors (`connections.save`, `connections.check`, governed epic/story/sprint creation & read-back) are **NOT built yet** and must be implemented for the tests in Section 2! |
| **13** | Sprints filtered to Product & Project, Summary/Planning views, work-area sprint chat, and governed new Sprint creation (`create-sprint` / `createTeamIteration`)                                                                    | **DONE (ADO)**                                                | `packages/contracts/src/backlog.ts`, `packages/work-store/src/ado-governed-writes.ts`, `ado-operations.ts`, `ado-service.ts`. Needs Jira & Linear sprint creation support added.                                                                                                                                  |
| **14** | Live tracker verification of PRD → Epics → Stories → Sprints                                                                                                                                                                        | **NOT DONE for Jira & Linear**                                | Assigned to next agent in Section 2 below.                                                                                                                                                                                                                                                                        |
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
