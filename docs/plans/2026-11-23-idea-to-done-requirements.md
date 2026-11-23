# Idea to Done: one delivery flow for Products and Projects

Status: **draft for the owner's approval** (23 November 2026). Nothing here is built yet.
Visual companion: `docs/preview/2026-11-23-idea-to-done-requirements/index.html`, which shows the flow and one screen per step.

This document adds the missing end of the delivery journey: release, stories Done, epics closed, requirements Delivered, Roadmap Done. It also folds in the fixes found on 23 November (`docs/preview/2026-11-23-end-to-end-workflow/requirements-gap.html` and `docs/preview/2026-11-23-ux-fixes/index.html`). It extends `releases/AMUN-STORIES-BACKLOG-SPRINTS-CLAUDE-PROMPT.md` and replaces nothing in it. Where they disagree, the existing approved rules in `AGENTS.md` and `Amun_rules.md` win.

---

## 1. Principles

1. **One flow for Products and Projects.** A Project follows exactly the same steps and screens as a Product. The differences are only these:
   - its requirements document is called a **BRD** (a Product's is a **PRD**);
   - it may stay in **checklist mode** (see §3.2).

   Initiatives keep their simple chat and checklist. An Initiative that grows is converted to a Project in place, as today.

2. **One chain.** Every piece of work is linked to the piece above it:

   ```
   Idea → Requirements (PRD/BRD, approved version) → Epics → Stories → Sprint → Release → Roadmap item
   ```

   Amun stores these links in its own store. Every screen reads progress from the chain. Nothing on a screen is typed in twice.

3. **Progress flows up, never sideways.** A story's status sets its epic's progress. Epics set the requirements' progress and the release's readiness. The release and the epics together set the Roadmap item. Amun never changes a status lower in the chain because of something higher up, except through the close-out action in §4.9, which needs the captain's approval.
4. **Stories always exist in Amun.** Each product or project chooses once where its stories are worked: **Amun only**, **Jira**, **Linear** or **Azure DevOps**. When a tool is chosen, the tool is the source of truth for status, and Amun keeps a linked copy with the tool's ID. When the choice is Amun only, Amun is the source of truth. The screens are the same either way.
5. **Captain → Firstmate → crew is unchanged.**
   - Every substantive action goes to Firstmate with its request reference and the affected records.
   - Typing, dragging and ticking in a draft stay local until Apply, as approved for the planner.
   - Writes to Jira, Linear or Azure DevOps happen only after an explicit approval, and each produces a receipt in the chat that asked.
6. **Plain words, existing patterns.**
   - Statuses use the words in §2 and nothing else.
   - New UI reuses the cards, tabs, chips and planner that already exist.
   - Nothing is added to the prompt box.
   - Every screen change below still needs its own before/after approval, per the UI rule.

## 2. Status words (the only ones used)

| Thing                  | Statuses                                                                                                               | Who changes it                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements (PRD/BRD) | Draft → Approved (vN) → In delivery → Delivered. "Changed since approval" if edited after approval.                    | Approve: captain. In delivery: automatic when the first story of that version enters a sprint. Delivered: captain confirms Amun's proposal (§4.10). |
| Epic                   | Not started → In progress (n of m stories done) → Done                                                                 | Automatic from its stories. Closing it in a tool needs the close-out approval (§4.9).                                                               |
| Story                  | To do → In progress → In review → Done (plus "Removed")                                                                | In the tool, or in Amun for Amun-only work. Tool status names are shown as they are, grouped under these four.                                      |
| Sprint                 | Planned → Active → Completed                                                                                           | Captain (Amun-only) or tool.                                                                                                                        |
| Release                | Readiness → Scheduled → Deploying → Verified live → After launch → Closed. Failed / Rolled back branch from Deploying. | Captain on the release card.                                                                                                                        |
| Roadmap item           | Now / Next / Later, plus a progress bar, then **Done**                                                                 | Horizon: captain. Progress and Done: automatic from the chain.                                                                                      |
| Other documents        | Draft → Approved → Done                                                                                                | Captain, from the status chip on the card (fix F1).                                                                                                 |

## 3. Setup for a Product or Project

### 3.1 Folder header (same for both)

Products and Projects get the same header tabs:

**Requirements · Stories · Sprints · Release · Pull requests · Browser · What happened**

- _Requirements_ opens the PRD (Product) or BRD (Project).
- _Pull requests_ appears only when a repository is linked.
- Today's separate _Backlog_ tab becomes _Stories_. Its Azure DevOps connection, team and level picker moves into the Stories tab's "Where stories are worked" setting.
- _Project checklist_ stays for projects in checklist mode (§3.2).

### 3.2 Checklist mode or delivery mode (Projects only)

A new Project starts in **checklist mode**: the PR #56 checklist pane and handover receipt, unchanged. The Requirements tab is always there. When the captain asks Firstmate to "draft stories", "plan a sprint" or "write a BRD", or presses _Use sprints for this project_ in the checklist pane, Firstmate asks once:

> "Run Gitex Demo with stories and sprints instead of a checklist? Your 3 checklist tasks become stories."

On yes, checklist tasks become stories (To do / Done kept) and the Stories and Sprints tabs appear. Checklist mode never comes back automatically. A Product is always in delivery mode.

### 3.3 Where stories are worked

Chosen on the Stories tab the first time it opens, and changeable later through Firstmate:

- **Amun only:** nothing to connect.
- **Jira / Linear / Azure DevOps:** connected through the existing tools sign-in and picker (site/team/project, board or backlog level).

The choice is stored per product or project and shown under the tab title, for example "Worked in Jira · SCRUM · board 1".

## 4. The flow, step by step

Each step names its screen (S1–S12; drawn in the visual companion), what the captain does, what Firstmate does, and what Amun records.

### 4.1 Idea → folder (S1, exists)

The captain types new work anywhere. Amun files a Product, Project or Initiative and opens its first chat, as today.
Fixes included:

- stop the name at a colon;
- add a word boundary for "client";
- catch near-duplicates ("Sales Prospect" beside "Sales Prospects");
- "Open Sales Prospects" opens the existing chat instead of creating one.

### 4.2 Discovery (exists)

Firstmate delegates to Product Manager and other specialists. Question cards go to the Island and "Needs your attention" (fix: they don't today), and the answers are stored in the original chat.

### 4.3 Requirements arrive in Amun (S2)

When the crew reports a PRD or BRD with the request reference, Amun files it as version N in the Library and on the Requirements tab.

- **Fix:** BRDs and crew documents in any format the crew writes (Markdown in the crew's home) are filed the same way, for Projects as for Products.
- **Fix:** if Firstmate says a document exists but Amun can't find it, the chat shows "Firstmate mentioned BRD v0.2 but Amun hasn't received it. Ask Firstmate to send it", and that sends the request through Firstmate.

### 4.4 Approve the requirements (S2)

The _Approve this version_ button on the Requirements tab is the existing PRD approval, extended to BRDs. It binds to that exact version. A "No" goes back as comments through Firstmate and produces a new version. Approval is the gate for drafting stories.

### 4.5 Epics and stories drafted (S3)

On an approved version, Firstmate raises `draft-stories`, which works for **Projects and Products** (fix: projects are refused today).

- Amun first compares the version with the existing stories (§ "Draft or compare from PRD" in the stories spec).
- It then drafts epics, stories, acceptance criteria and the first-release slice.
- Drafts appear on the **Stories tab**: epics as groups, each with a progress line "0 of 6 done", and stories as rows with status, sprint, estimate and source requirement.
- Every story records its epic and the requirements version it came from.

### 4.6 Groom the backlog (S3, uses the existing planner)

On the Stories tab the captain can:

- reorder, split, merge, estimate, label, edit criteria;
- move a story between epics;
- remove a story ("Removed", kept for history).

All of this is local staging with one _Apply N changes_, as approved for the planner. With a tool connected, Apply is a governed write with a receipt (§4.8). With Amun only, Apply saves in Amun and Firstmate is told.

### 4.7 Plan the sprint (S4, existing two-pane planner)

Stories on the left, sprint on the right, drag or _+ Sprint_, one Apply, date suggestion, capacity, all as already built.

- **New: Keep this sprint in Amun.** For Amun-only work, or a tool that can't hold sprints, the sprint is stored in Amun with its stories and labelled "Sprint kept in Amun" (spec line 235, now built).
- **Fix:** the overview counts every sprint, not only the selected one.

### 4.8 Approve the plan and publish to the tool (S5, S6)

For Jira, Linear or Azure DevOps, the plan card (S5) lists every item with its **epic (parent), sprint and destination** (fix: titles only today), grouped by epic, with "Review N stories". The captain approves once.

- **Fix (PR #66):** a plan Firstmate writes is never dropped. Plan blocks in unprompted replies are raised in the chat of the request whose reference they carry, through the same checks.
- **New: receipt card (S6)** in the chat that asked. Example: "Created in Jira: 4 epics, 12 stories, sprint 'Badge Desk Sprint 1' · SCRUM-13–28". It has one row per item with its key and link, and partial results are shown as partial. The request turns Ready. Every story row on the Stories tab links back to this receipt.

### 4.9 The sprint runs (S7)

The sprint page shows the goal, blockers, then stories grouped by status, as today.

- **New: change status.** Each story row has a status chip. Choosing a status (including Done) is staged locally and sent with one Apply. With a tool, this is a governed write with a receipt in the sprint chat. With Amun only, it saves in Amun. Done is allowed with an open blocker and shows "1 open blocker" (spec line 154).
- **New: epic progress.** Each epic shows "n of m done" on the Stories tab and on the sprint page. When all its stories are Done or Removed, the epic shows **Done** in Amun.
- Tool status is read when the sprint page opens and hourly, as for blockers, with the last check time shown.
- **Unblock rule (fix F4, option A):** "Ask Firstmate to unblock it" on the Agents screen goes to the chat of the request the agent is blocked on. If no request is known, it goes to General's latest chat, never to whatever chat is open. The button names the destination, and afterwards offers _Open that chat_.
- **Sprint end (exists, extended):** "Review N unfinished stories" moves them to the next sprint or back to the backlog. The sprint becomes Completed with its recap.

### 4.10 Release (S8)

The release card (PR #56) is linked to the chain:

- **Contents:** a release lists the epics and stories it ships. By default these are the first-release stories of the approved version; the captain can add or remove them.
- **Readiness gate:** _Schedule_ is enabled only when every included story is Done or moved out of the release. Otherwise the card says "3 stories not done", with _Move them to the next release_ or _Release anyway_. Release anyway needs a typed reason, which is recorded on the receipt.
- **Locked steps:** after Verified live, earlier steps can no longer be clicked.
- **New step, After launch:** a short checklist (release notes sent, collateral, first-30-days metrics watch) filled by the captain or by Firstmate's crew. _Close release_ ends it.
- **One card per release:** saving a release adds a version to the same card, never a new card (fix F5).

### 4.11 Close-out (S9)

When a release reaches Verified live, Amun raises **one close-out card** in the release's chat:

> "v1.0 is live. Close out: mark 12 released stories Done and close 3 epics in Jira. 2 stories are already Done."

It lists each record and its destination. One approval applies them through Firstmate as a governed write, with a receipt. With Amun only, it saves in Amun. Nothing closes without this approval.

### 4.12 Requirements Delivered (S10)

When every epic in the approved version is Done (or explicitly deferred to a later version) and its release is Verified live, Amun proposes in the chat:

> "PRD v2 is delivered: 3 epics done, release v1.0 live. Mark it Delivered?"

On yes:

- the Requirements tab shows **Delivered**, with the date and release;
- the requirements card's chip turns Delivered;
- deferred epics are listed as "Moved to v3".

### 4.13 Roadmap (S11)

Each roadmap item is linked to a product or project, and optionally to a requirements version and a release.

- Tiles show a progress bar from the chain ("8 of 12 stories · 2 of 3 epics"), the target release and the contributing sprints (spec line 148: Firstmate suggests the link, one click confirms).
- When the linked requirements are Delivered, the tile moves to a **Done** column with the delivery date.
- Dragging between horizons and committing stay as built.

### 4.14 Portfolio and Sprints overview (S12)

- Portfolio cards show the same progress line and status word as the Roadmap tile.
- The Sprints overview lists Amun-kept and tool sprints together, labelled by product or project and team.

## 5. Chat cards (fixes F1, F3, F5)

- **Status chip (F1):** clicking a document card's chip offers Draft / Approved / Done, and Firstmate is told. Requirements cards use the §2 statuses instead.
- **Checklist card (F3):** it opens the PR #56 checklist pane, never the text editor.
- **Card lifecycle (F5):**
  - a card appears under the reply that made or changed it;
  - there is one card per document, with versions;
  - an empty "Untitled" shows no card;
  - Done and Delivered cards fold into "Done (n)" after a day;
  - everything stays in the Library.
- **Receipt and close-out cards** use the existing amber card pattern.

## 6. Acceptance cases

1. **Product, Jira, end to end:** Badge Desk PRD v1 approved → stories drafted → sprint planned → published with receipt → stories moved to Done → release v1.0 readiness passes → Verified live → close-out approved → epics Done in Jira → PRD Delivered → Roadmap tile in Done. Record each screen.
2. **Project, Amun only:** Gitex Demo switches from checklist to delivery mode (its tasks become stories) → BRD v1 approved → stories drafted → "Sprint kept in Amun" → stories ticked Done in Amun → release → BRD Delivered → Roadmap Done. Zero tool writes.
3. **Project, Linear:** the Invoiced BRD plan, raised in an unprompted reply, appears as a plan card with 10 epics and 31 stories, each with parent and cycle-less destination. Approve → receipt with 41 keys.
4. **Readiness gate:** a release with 3 stories not Done cannot be scheduled. _Move them to the next release_ enables Schedule. _Release anyway_ requires a reason and records it.
5. **No silent close:** Verified live alone changes no tool record. Only the close-out approval does, once, with a receipt. A retry never repeats confirmed writes.
6. **Partial epic:** 5 of 6 stories Done shows "5 of 6"; removing the sixth shows the epic Done.
7. **Deferred epic:** the PRD is Delivered with one epic moved to v3; the Roadmap shows Done and lists the deferred epic.
8. **Unblock routing:** a blocked agent working for the Mira request sends the unblock to Mira's chat. With no request, it goes to General's latest chat. The open chat is never used by default.
9. **Card lifecycle:** saving the release three times shows one card, version 3. The empty Untitled shows no card.

## 7. Out of scope here

- Teams, Slack and email sending (spec item 11).
- Jira sprint closure and Linear rollover detail (spec items 9–10, unchanged).
- Developer ID signing.
- Any change to Firstmate's code.

## 8. Build order (after approval)

1. Chain links in Amun's store (data only).
2. The PR #66 fix and the receipt card.
3. Stories tab for Projects and Products, BRD support, checklist → delivery mode.
4. Sprint kept in Amun and status change on the sprint page.
5. Epic progress, the release readiness gate, After launch, close-out.
6. Delivered, Roadmap progress and Done, Portfolio line.
7. Chat card fixes F1, F3, F5 and unblock routing F4.
8. Acceptance cases 1–3 on the Mac, with screens recorded.

Each item with a visible change gets its before/after preview through `/impeccable` and the owner's approval before it is built.
