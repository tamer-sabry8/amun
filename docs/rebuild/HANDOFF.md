# Amun rebuild: handoff

## Summary

- **What this is.** Amun was rebuilt on branch `claude/project-thread-3te02r` (PR #33).
  - The UI is the same as the old Amun.
  - Underneath it sit the Paseo daemon and Tamer's own Firstmate.
- **Who decides what.** Every product decision below came from Tamer, answered one question at a time on 18 November 2026. Each question had multiple choices and one recommended option.
- **Firstmate is never changed.** `vendor/firstmate` is a pristine copy of upstream, and CI checks this on every push. Amun only reads Firstmate's files, and only acts through the First Mate.
- **Still open after the merge:**
  - A Mac test of Pi running headless, on `main`.
  - A test of Azure DevOps against Tamer's real server.
  - Showing First Mate turns Amun didn't ask for (heartbeats, wakes) in the chat.
  - The Paseo features Tamer asked for, and the remaining ports (see "Still to do").

This file is final as of the PR #33 merge on 18 November 2026. Later work gets its own PRs and adds its decisions here.

## Read this first: Firstmate is the only path

**For the next developer or LLM:** Amun is a window onto Tamer's Firstmate. It is not a second orchestrator. Every agent, every piece of crew work, every worktree and every decision goes through Firstmate. Paseo is plumbing: it hosts the First Mate process, carries messages between it and the UI, and stores Amun's data. If a change would start, steer or stop work any other way, it is the wrong direction. Ask Tamer before making it.

### Why

- **Firstmate already does this job, and does it well.** Its watcher, status files, supervision ladder, captain holds and treehouse worktrees only know about crew that Firstmate started. Work started anywhere else is invisible to it, so nothing supervises it, nothing reports on it, and its decisions never reach the captain.
- **Tamer wants to keep upgrading Firstmate from upstream.** So `vendor/firstmate` stays a pristine `git subtree` (decision 3, and `firstmate-layer/README.md`). CI fails if anything under it changes (`scripts/check-firstmate-pristine.sh`). Amun's additions live in `firstmate-layer/` and `packages/server/src/server/amun/`.
- **The First Mate decides where rules and agents go, not Amun.** Amun never writes into the Firstmate home. That covers `captain.md`, `secondmates.md`, `config/crew-dispatch.json`, memory and backlog files. Amun relays the captain's words, and the First Mate files them.

### How the pieces fit

```
Amun UI (renderer)
   │  MessagePort contract (packages/contracts)
   ▼
Contract adapter (packages/amun-ui/src/daemon/contract-adapter.ts)
   │  WebSocket JSON-RPC to ws://127.0.0.1:6767/amun (loopback, trusted origins only)
   ▼
Paseo daemon + Amun RPC (packages/server/src/server/amun/)
   │  hosts ONE process: the First Mate, run as `pi --mode rpc` in the Firstmate checkout
   ▼
Pi (the First Mate) ──runs──▶ Firstmate scripts in the home (fm-spawn, fm-send, fm-teardown, ...)
                                   │
                                   ▼
                       Crew and secondmates in tmux/herdr panes, each in its own treehouse worktree
```

- **Pi** is the First Mate's brain. Paseo's Pi provider starts it headless (`pi --mode rpc`), so Tamer never sees a terminal (decision 11). Its working folder is the Firstmate checkout, so Pi loads Firstmate's extensions, watcher and turn-end guard there. That this all works in RPC mode is still to be proven by the Pi test on Tamer's Mac.
- **Paseo** starts Pi, sends it the captain's messages (`primary.send` → `agentManager.runAgent`), and returns the reply. Paseo also gives the First Mate a short list of read-only tools plus heartbeats (decision 19). The 22 Paseo tools that start crew, worktrees, terminals or agent schedules are blocked for it (`first-mate-tools.ts`).
- **Firstmate** runs everything else. The First Mate spawns, steers, supervises and tears down crew with Firstmate's own scripts.

### How agents and work are created and monitored

| Captain does in Amun                        | What Amun sends                                                                                                                                                                       | Who acts                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Chats with the First Mate                   | `primary.send`, with the captain's words passed through verbatim                                                                                                                      | The First Mate                                |
| Answers a question card or hold             | `holds.answer` → a prompt asking the First Mate to record it with `fm-captain-hold.sh answer` or `fm-send.sh --resolve-key`                                                           | The First Mate                                |
| Adds, creates, edits or retires an agent    | A request to the First Mate, for example "brief it, seed its home and spawn it (fm-brief, fm-home-seed, fm-spawn --secondmate)", or "save its work into data/<id>/, then fm-teardown" | The First Mate                                |
| Watches agents (rail, Agents screen, Watch) | Reads only: `fleet.snapshot` (`fm-fleet-snapshot.sh --json`), `holds.list`, `crew.peek` (`fm-peek.sh`)                                                                                | Firstmate's own scripts, read-only            |
| Changes the backlog                         | `amun-tasks-axi`, which wraps `vendor/firstmate/bin/fm-tasks-axi.sh`                                                                                                                  | tasks-axi                                     |
| Wants something on a timer                  | Asks the First Mate to set a Paseo heartbeat (a timed prompt to itself)                                                                                                               | The First Mate, through Firstmate             |
| Needs diagnostics                           | `trace.export`; the history flags are requested from the First Mate once                                                                                                              | Amun reads; the First Mate turns the flags on |

Amun's own data, such as products, mapped sources, PRDs, conversations and avatar choices, lives in Amun's work store under `~/.amun`. Amun may write that freely.

### Do

- Route every change to crew, agents, rules or backlog through the First Mate (`primary.send`) or through Firstmate's own scripts.
- Read Firstmate state through its scripts (`fm-fleet-snapshot.sh --json`, `fm-peek.sh`), or read `state/` and `data/` without writing to them.
- Keep `vendor/firstmate` pristine. Update it only with `git subtree pull`.
- When a Paseo feature looks useful, check it against Firstmate first, and ask Tamer one question at a time with a recommended option. Decision 19 is the model: worktrees and profiles didn't conflict, but the agent tools did.
- When Paseo adds a built-in tool, put it on the kept or blocked list in `first-mate-tools.ts`. A test forces this choice.

### Don't

- Don't start, message, cancel or kill agents with Paseo's `create_agent`, `send_agent_prompt`, `kill_agent` or similar, from the UI or from the First Mate.
- Don't create worktrees with Paseo (`create_workspace`). Crew get treehouse worktrees from `fm-spawn`.
- Don't use Paseo schedules that start agents (`create_schedule`). Use a heartbeat to the First Mate instead.
- Don't use Paseo agent profiles to pick models for crew. Firstmate's `config/crew-dispatch.json` does that, and the First Mate owns it.
- Don't write into the Firstmate home, and don't edit anything under `vendor/firstmate`.
- Don't start a second First Mate for the same home. Firstmate allows one live primary per home, and `PrimarySessions` keeps exactly one.
- Don't bypass the First Mate to answer holds. `answerHoldDirect` exists, but it is off by default and needs Tamer's approval to turn on.

## What Amun manages: the objects and the flows

Amun is a product manager's workspace. The product source of truth is Tamer's R1 brief, `Amun_Product_and_R1_Build_Brief.md`, with journeys J1–J8 and capabilities F01–F23. It is not in the repo, so ask Tamer for it. The source of truth for the code is the work contract in `packages/contracts/src/work.ts` and the store in `packages/work-store/src/work-store.ts`. Everything below is Amun's own data, kept in `~/.amun`. Any work these objects lead to is done through the First Mate (see the section above).

### The objects

| Object                              | What it is                                                                                                                                                                                                                                                                        | Where it lives in code                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Group**                           | A top-level space, such as "Work" or "Personal". Each group keeps its own information. Linking across groups needs the captain's permission (`grant-cross-group`). A group can also route each kind of work to a tracker (`set-route`), for example product work to Azure DevOps. | `add-group`, `set-route`                                  |
| **Work area**                       | One piece of work inside a group. It has exactly one type: product, project, task or RFP. Its conversation, outputs, links and history attach to it.                                                                                                                              | `create-area`, `workType`                                 |
| ↳ **Product**                       | Something being built and managed over time. It has documents, objectives, decisions, memory, mapped sources (an Azure DevOps project or a repository), a PRD and a roadmap. The daemon's workspace service keeps the product context and source mappings.                        | `workspace-service.ts`, `product-*.ts`, `workspace.*` RPC |
| ↳ **Project**                       | Bounded work with a start and an end, and possibly sprints. A task can grow into a project (`convert-task`), keeping the same id and history.                                                                                                                                     | `convert-task`                                            |
| ↳ **Task**                          | A personal or work to-do. It is separate from delivery tickets (F15) and can carry reminders.                                                                                                                                                                                     | `reminder`, `finish-reminder`                             |
| ↳ **RFP**                           | A request for proposal from a client. It moves through the stages received → in response → submitted → won or lost or withdrawn → handed to delivery. Handing off needs a signed proposal and an approved BRD, and it then links to a delivery project (`handoff-rfp`).           | `rfpStage`, `rfp-boundary.ts`                             |
| **Relation**                        | A link between work areas: "implements" (a project implements a product) or "handoff" (an RFP hands off to delivery).                                                                                                                                                             | `relate-areas`                                            |
| **Record**                          | Raw input such as an idea, a problem, an interview or a document. The captain links it to work areas, or chooses "later" or "never".                                                                                                                                              | `save-record`, `link-record`, `intake`                    |
| **Objective**                       | A metric with a baseline, a target and a current value.                                                                                                                                                                                                                           | `save-objective`                                          |
| **Output**                          | Something Amun or the crew produced, such as a brief, PRD, update or prototype. It has versions, a status and an approval.                                                                                                                                                        | `save-output`, `approve-output`                           |
| **Plan**                            | A proposal of stories, a sprint plan, a roadmap or an edit, aimed at a destination such as Azure DevOps. The captain approves it or asks for changes, and only then is anything published.                                                                                        | `propose-plan`, `approve-plan`                            |
| **Roadmap item, sprint**            | Planning on the now / next / later horizons, with releases. A committed roadmap item needs approval before it can change.                                                                                                                                                         | `save-roadmap-item`, `save-sprint`                        |
| **Attention item**                  | Something that needs the captain: an approval, question, risk, failure, result, offer or link suggestion. First Mate holds appear here too, as question cards.                                                                                                                    | `attention`, `resolve-attention`                          |
| **Blocker**                         | Something stopping a work area, with an owner and an age.                                                                                                                                                                                                                         | `raise-blocker`                                           |
| **Agent**                           | The First Mate (the lead), always-on secondmates and temporary crew. Amun shows them, and the First Mate creates and retires them.                                                                                                                                                | `add-agent`, `toggle-agent`, `edit-agent`                 |
| **Council session, finding, claim** | Multi-agent review of a decision, review findings, and memory claims that can be corrected or forgotten.                                                                                                                                                                          | `council-session`, `save-finding`, `record-claim`         |

### The main flows (from the R1 brief)

1. **Connect and set up a product (J1).** Connect Azure DevOps. Create a product and map its sources. Upload or paste documents. The First Mate asks targeted questions, and the captain reviews and approves the product understanding.
2. **From objective to approved brief (J2).** The captain states an objective, and the First Mate and specialists find the gaps. The First Mate drafts a one- or two-page brief. The captain edits and approves a version.
3. **Explore with a prototype (J3).** The First Mate gives the crew a bounded prototype task. The captain previews it, gives feedback, and approves the revised brief.
4. **Publish the backlog and commit a sprint (J4).** The First Mate proposes stories as a plan. The captain approves publishing it. A separate approval covers sprint scope and assignments, which the captain picks by hand.
5. **Deliver (J5).** The First Mate spawns crew in their own worktrees. Amun shows status, blockers and links, read-only.
6. **Review, merge and accept (J6).** The captain reviews PRs, explicitly authorizes each merge, and records acceptance with a reason.
7. **Portfolio and updates (J7).** The captain sees progress and blockers across products, and drafts stakeholder updates from cited records.
8. **Memory, tasks and reminders (J8).** The captain syncs selected memory to Notion, keeps personal and work tasks, and gets reminders.

Every outward action needs the captain's approval: publishing, sprint commitments, merges and sending. Amun never invents an action a provider does not have.

## Connectors still to add

Every connector follows the Firstmate-only path:

- **Credentials** go in the Keychain through `ConnectionStore`, never in renderer state, logs or traces.
- **Reads** feed Amun's records.
- **Writes** need the captain's approval.
- **Work they trigger** goes through the First Mate.
- **Firstmate's home** is never written by a connector.

Azure DevOps Server is built: Keychain, connection check, backlog, board and approved writes (decision 13). It still needs a test against Tamer's real server.

| Connector                                                | Status today                                                                                                                                                                                                                                                                                         | What it is for                                              | What is missing                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jira**                                                 | An adapter exists: `JiraAdapter` in `packages/server/src/server/amun/delivery-sync.ts` (Jira Cloud REST: sprints, issues, create, move, comment). It is tested only against recorded responses (`pm.test.ts`). It is not wired to any RPC or screen, and `ConnectionStore` only accepts `ado` today. | A delivery tracker, like Azure DevOps                       | Accept the `jira` kind in `ConnectionStore`, with a Keychain token and a connection check. Add an RPC and a Settings form. Route the backlog and board through it. Decide whether Jira Server or Data Center also matters. Test against a real site. |
| **Linear**                                               | An adapter exists: `LinearAdapter` in the same file (GraphQL: cycles, issues, create, move, comment). Like Jira, it is tested only against recorded responses and not wired.                                                                                                                         | A delivery tracker                                          | The same steps as Jira, with a Linear API key.                                                                                                                                                                                                       |
| **Notion**                                               | Partly ported: memory sync, receipts and result types are in `packages/work-store`. The Notion progress test is held back. There is no live connection in the rebuilt app yet.                                                                                                                       | Memory sync, publishing approved documents, tasks (J8, F14) | Connection and Keychain token. Finish the port and the held-back test. Add conflict handling for keep, delete or unlink (R1 brief, section 7).                                                                                                       |
| **Office 365** (Outlook mail, calendar, OneDrive, Teams) | Not started                                                                                                                                                                                                                                                                                          | Mail and calendar context, documents                        | Microsoft Graph OAuth with a token in the Keychain. Decide on read-only scopes first. Sending mail is a later capability in the brief, and needs approval.                                                                                           |
| **ClickUp**                                              | Not started                                                                                                                                                                                                                                                                                          | A task and delivery tracker                                 | API token. A `DeliveryAdapter` like Jira and Linear, so it fits the same board.                                                                                                                                                                      |
| **Gmail**                                                | Not started                                                                                                                                                                                                                                                                                          | Reading mail as records; drafts                             | Google OAuth. Read and draft first. Sending needs approval and is a later capability.                                                                                                                                                                |
| **Google Calendar**                                      | Not started                                                                                                                                                                                                                                                                                          | Meetings and deadlines alongside reminders                  | Google OAuth, shared with Gmail and Drive. Start read-only.                                                                                                                                                                                          |
| **Google Drive**                                         | Not started                                                                                                                                                                                                                                                                                          | Documents as product sources (J1)                           | Google OAuth. Read selected files into records with source links.                                                                                                                                                                                    |

Ask Tamer which connector comes first before building, one question at a time.

## Work locally on your Mac

1. **Get `main`.** `git clone https://github.com/tamer-sabry8/amun && cd amun`, or `git checkout main && git pull` in an existing clone.
2. **Install.** Use Node 22.13 or later (`.node-version` pins the CI version; the work store uses `node:sqlite`). Run `npm ci`.
3. **Firstmate's tools.** `vendor/firstmate` needs `tmux` or `herdr`, `treehouse`, `tasks-axi`, `jq` and `git` on your PATH. Amun checks for them and shows the install command for any missing tool (`checkHostTools` in `packages/server/src/server/amun/primary-session.ts`).
4. **Your Firstmate home.** Amun uses `~/Projects/firstmate` by default. To use another folder, set `AMUN_FIRSTMATE_HOME`. Amun never writes rules into that folder.
5. **Pi.** Install Pi and sign in once. The First Mate runs as `pi --mode rpc`, so no terminal window opens.
6. **Build and run the daemon.** Run `npm run build:server`, then `npm start`. The daemon listens on `127.0.0.1:6767`, and Amun's RPC is at `ws://127.0.0.1:6767/amun`. Set `PASEO_LISTEN` to change the port.
7. **Run the UI.** Run `cd packages/amun-ui && npx vite build && npx vite preview --port 6768`, then open `http://127.0.0.1:6768/index.html?daemon=ws://127.0.0.1:6767/amun`. For the desktop app, run `cd packages/desktop && npm run dev`.
8. **Checks before a PR.** Run `npm run typecheck`, `npm run lint`, `npm run format:check` and `npx vitest run`. CI runs the same checks plus `scripts/check-firstmate-pristine.sh`.

### The Pi test (first thing to do on `main`)

Open Amun, send the First Mate a message, and confirm three things:

- The reply arrives.
- Firstmate's watcher and turn-end guard run in RPC mode.
- A question from the First Mate shows as a question card.

If anything fails, use the rail's lifebuoy button to download a trace bundle and share it.

### Heartbeats (decision 19)

- **What it is.** The First Mate keeps Paseo's `create_heartbeat` and `delete_heartbeat`. A heartbeat is a timed prompt that Paseo sends to the First Mate itself. Ask it in chat, for example: "Set a heartbeat every weekday at 9 AM Cairo time: prepare my standup." It then does the work through Firstmate.
- **Where the policy lives.** `packages/server/src/server/amun/first-mate-tools.ts` holds the policy. It applies only to the agent running in the Firstmate checkout. To check a heartbeat, ask the First Mate to "list my schedules".
- **The gap to build next.** The First Mate acts on a heartbeat, but its reply does not appear in Amun's chat. Amun only shows replies to messages it sent itself (`primary.send`). The plan:
  1. In `attach-amun.ts`, subscribe to the First Mate agent with `agentManager.subscribe(cb, { agentId })`.
  2. When a turn finishes that Amun did not start, broadcast the `primary.output` event. It is already defined in `packages/protocol/src/amun-rpc.ts`, but nothing sends it yet.
  3. In `packages/amun-ui/src/daemon/daemon-port.ts`, handle `primary.output` beside `fleet.updated`, and add the text to the First Mate chat in `contract-adapter.ts`.
  4. Add a test in `amun.test.ts` with a fake agent turn.

  This also covers Firstmate's own wakes and guard notices, which raise the same unprompted turns.

## How to read the decisions

Each decision lists:

- the question;
- the options offered (★ marks the recommended one);
- Tamer's answer;
- why that answer was chosen.

## Decisions

### 1. Brand palette

- **Question:** Apply the brand palette to Amun?
- **Options:**
  - Add as a new optional theme ★
  - Make it the default theme
  - Leave themes as they are
- **Answer:** Add as a new optional theme.
- **Why:** It uses the brand colors without touching the themes in use today, which fits "keep the UI as is".

### 2. Bringing back lost features

- **Question:** How should we bring back the features the rebuild lost?
- **Options:**
  - Port the old backend into the daemon ★
  - Go back to the old Amun app
  - Rebuild each feature fresh
- **Answer:** Port the old backend into the daemon.
- **Why:** It keeps the rebuild's direction and reuses code that already works, instead of rewriting it.

### 3. How Firstmate is included

- **Question:** How should Amun include Firstmate so upstream updates stay clean?
- **Options:**
  - Pristine git subtree plus an Amun layer ★
  - Git submodule
  - Use your own install
- **Answer:** Pristine git subtree plus an Amun layer.
- **Why:** Firstmate stays byte-for-byte identical to upstream and updates with one command. Amun's additions live outside it, in `firstmate-layer/` and `packages/server/src/server/amun/`.
- **Rule:** Tamer's rule is "never change Firstmate". `scripts/check-firstmate-pristine.sh` enforces it in CI.

### 4. Delivery tools

- **Question:** Which delivery tools should Amun sync stories and sprints with?
- **Options:**
  - Azure DevOps first, keep Linear and Jira ★
  - Azure DevOps only
  - Linear and Jira only
- **Answer:** Azure DevOps first, keep Linear and Jira.
- **Why:** The brief makes Azure DevOps Server the acceptance target. The Linear and Jira adapters were already built and tested.
- **Limit:** They make no live calls without credentials Tamer provides.

### 5. Desktop shell

- **Question:** Which desktop shell should Amun ship in?
- **Options:**
  - Keep Electron for now ★
  - Switch to Tauri now
  - Electron now, Tauri in R2
- **Answer:** Keep Electron for now. Tauri is recorded as a later move.
- **Why:** Both the old app and the rebuild already run on Electron. Switching now would delay the features.

### 6. Firstmate home

- **Question:** Which Firstmate home should each product use?
- **Options:**
  - Pick per product ★
  - Your existing home for everything
  - A new home per product
- **Answer:** Your existing home for everything (`~/Projects/firstmate`).
- **Why:** Tamer runs one Firstmate loop. Amun is a window onto it, not a second fleet.
- **How it works:**
  - Products are Amun records in `~/.amun/products/`.
  - There is one First Mate per home.
  - Amun's own data lives in `~/.amun`, never in the home.

### 7. Question cards: format

- **Question:** How should the First Mate's question cards offer multiple choices?
- **Options:**
  - 2–4 choices, one recommended ★
  - Wait for Options.png
  - Choices as chat buttons
- **Answer:** 2–4 choices, one recommended, plus an inline "Write my own response".
- **Why:** It is the same one-question, multiple-choice, recommended-option pattern used for these decisions.

### 8. Where Amun's PM rules live

- **Question:** Where should Amun's PM rules live in the shared home? This was asked twice, with options for a marked section in the captain files, rules given at session start, or no rules.
- **Answer:** Neither option as offered. Tamer explained that the First Mate decides where a rule goes (captain.md, captain-shared.md, secondmates.md, crew-dispatch.json, ai-memory) based on who it applies to.
- **Result:**
  - Amun never writes rules or config into the home.
  - It relays the captain's words exactly as written, and the First Mate classifies and files them.
  - Amun acts only through `fm-send`, `fm-captain-hold` and `tasks-axi`.

### 9. Agents screen

- **Question:** What should the Agents screen show?
- **Options:**
  - Your real Firstmate fleet ★
  - Keep the 20 specialists
  - Both
- **Answer (in Tamer's words):** A pool of the 20 agent templates, plus the live team. The screen must:
  - add agents from the pool;
  - edit agents;
  - create agents from scratch (these are also saved to the pool);
  - retire agents back to the pool.
- **Why:** The screen shows who is really working, and it keeps the existing catalog. The First Mate still does the provisioning (`fm-brief` → `fm-home-seed` → `fm-spawn --secondmate`).

### 10. Retiring an agent

- **Question:** When you retire an agent, what should happen to its work?
- **Options:**
  - Save its work, then retire ★
  - Retire clean
  - Ask each time
- **Answer:** Save its work, then retire. The work goes into `data/<id>/`, with the status archive, and then `fm-teardown` runs.
- **Why:** Retired agents go back to the pool. Saving first means a re-added agent doesn't start from zero.

### 11. How Pi runs

- **Question:** How should Amun run the First Mate's Pi session?
- **Options:**
  - Pi RPC, proven by a Mac test first ★
  - Attach to an interactive Pi pane
  - Pi SDK
- **Answer:** Pi RPC, proven by a Mac test first.
- **Why:** In Tamer's words: "I built Amun because I hate the terminal." Pi must run headless, with no terminal ever shown.
- **Open risk:** Upstream documents only interactive `pi`, so the watcher, turn-end guard and wakes in RPC mode must be tested on the Mac. If they fail, the fallback is the Pi SDK, and Tamer is told first.

### 12. Right-rail avatars

- **Question:** What should each agent's avatar in the right rail look like?
- **Options:**
  - Built-in icon set ★
  - Initials
  - Upload your own
- **Answer:** Use the existing 20-agent catalog: names, roles, and the Animoon CC0 images in `packages/amun-ui/public/avatars`. Avatars can be changed on Edit Agent and are stored in Amun.
- **Why:** That work already exists in the code.

### 13. Azure DevOps sign-in

- **Question:** How should "Connect to Azure now" sign you in to Azure DevOps Server?
- **Options:**
  - Personal access token in Keychain ★
  - Windows sign-in
  - Reuse Git credentials
- **Answer:** Personal access token in Keychain.
- **Why:** The old Amun already used a PAT in Keychain, and Server 2022 supports PATs for REST 7.0. It ports with the least risk.
- **How it works:**
  - The token is checked against the server before it is saved.
  - It is stored under service `ai.amun`.
  - It never appears in files, logs or the UI state.

### 14. Old app or new shell

- **Question:** Which way should the old Amun features come back?
- **Options:**
  - New shell, port features one by one ★ (this was re-asked)
  - Restore the old app plus the daemon
- **Answer:** New shell, port features one by one ("yes option 1 is the right way").
- **Why:** Tamer left the old app because its connections, plugins and model sign-ins were buggy. Only tested logic is ported, and the old sign-in worker and plugin loader stay deleted.
- **Note:** The first time this was asked, the recommendation was to restore the old app. Tamer pushed back, and the recommendation was corrected.

### 15. Question cards: build

- **Question:** Approve the new question cards as shown in the preview?
- **Options:**
  - Approve, build it ★
  - Approve, but no extra Pi tool
  - I want changes first
- **Answer:** Approve, but no extra Pi tool.
- **Why:** Nothing is added to the First Mate's tools. Choices are read from the First Mate's own wording. When it asks in plain text, the card shows only the "Write my own response" box.

### 16. Trace bundle history

- **Question:** Should the First Mate turn on Firstmate's activity ledger and status archive?
- **Options:**
  - Yes, ask the First Mate to ★
  - No, current state only
- **Answer:** Yes, ask the First Mate to.
- **Why:** Without them, the trace bundle can't show what a finished or retired agent did. Amun sends one request and never writes those files itself.

### 17. When to merge

- **Question:** When should PR #33 be merged into main?
- **Options:**
  - After your Mac test passes ★
  - When my cloud work is done
- **Answer:** When my cloud work is done. The Pi test runs later on main.
- **Why:** Tamer chose to land the cloud work without waiting for the Mac test. Until that test passes, the First Mate chat on main has not run against real Pi.

### 18. Where the trace download lives

- **Question:** Approve the trace download in Settings, Advanced, Diagnostics?
- **Options:**
  - Approve as previewed ★
  - Also add a rail button
  - I want changes first
- **Answer:** Also add a rail button.
- **Why:** One click from any screen makes it faster to grab a trace while a problem is happening. Settings keeps the review-before-save path.

### 19. Which Paseo tools the First Mate keeps

- **Question:** Which Paseo tools should the First Mate keep?
- **Context:** Paseo gives every agent it runs 41 tools of its own, including `create_agent`, `create_workspace` (a new worktree) and `create_schedule`. Crew started that way would bypass `fm-spawn`, so Firstmate's watcher, status files and treehouse worktrees would never see them. Worktrees and agent profiles themselves do not conflict: Paseo keeps its worktrees under `~/.paseo/worktrees` and refuses to delete ones it did not create, and its profiles live in its own config.
- **Options:**
  - Read-only plus heartbeats ★
  - Read-only Paseo tools
  - No Paseo tools
  - Keep all 41 tools
- **Answer:** Read-only plus heartbeats.
- **Why:** Firstmate has condition-based checks (watcher checks, `fm-procevent-when.sh`) but no clock-based schedule such as "every Monday at 9 AM". A heartbeat is a timed prompt to the First Mate itself, which then works through Firstmate, so it adds that without a second way to start crew. The 22 blocked tools are listed in `packages/server/src/server/amun/first-mate-tools.ts`. A test fails when Paseo adds a new built-in tool, so each new tool has to be put on one list or the other on purpose. Plugin tools, such as browser tools, are not affected.

### 20. When to merge PR #33

- **Question:** Merge PR #33 now, or finish more cloud work first?
- **Options:**
  - Merge now ★
  - Add heartbeat chat first
  - Finish the Paseo wishlist
- **Answer:** Merge now.
- **Why:** The Pi test needs `main` on Tamer's Mac. Smaller follow-up PRs are easier to review than a bigger PR #33.

## Standing rules from Tamer

- Ask one question at a time, with multiple choices and a recommended option, before any code or workflow change.
- Never modify Firstmate. It must stay updatable from upstream.
- Any UI or UX change uses the impeccable skill and needs approval of a before/after preview.
- The final UI must match his screenshots of the old Amun. Every red annotation is fixed and self-tested.
- Paseo features must not conflict with Firstmate, especially worktrees and agent profiles.

## Built so far

| Area                                                                                                                                                                                                                                                                                           | State                                                                                           | Where                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Firstmate as a pristine subtree, with a CI guard                                                                                                                                                                                                                                               | Done                                                                                            | `vendor/firstmate`, `scripts/check-firstmate-pristine.sh`                                        |
| One home, no writes into it                                                                                                                                                                                                                                                                    | Done                                                                                            | `packages/server/src/server/amun/amun-paths.ts`, `product-spaces.ts`                             |
| Azure DevOps token in Keychain, checked before saving                                                                                                                                                                                                                                          | Done                                                                                            | `packages/server/src/server/amun/connections/`                                                   |
| Old work store ported, product chat wired to the daemon                                                                                                                                                                                                                                        | Done                                                                                            | `packages/work-store`, `packages/amun-ui/src/daemon/contract-adapter.ts`                         |
| Question cards: choices, recommendation, "Write my own response", "Connect to Azure now"                                                                                                                                                                                                       | Done; self-tested in the cloud, not yet with real Pi                                            | `packages/amun-ui/src/rebuild/question-card.tsx`, `packages/domain/src/work/question-choices.ts` |
| Trace bundle back end: Amun trace log (chats, calls, failures; secrets redacted), zip export, one-time history request to the First Mate                                                                                                                                                       | Done; on screen in Settings, Advanced, Diagnostics and as a right-rail button (decision 18)     | `packages/server/src/server/amun/trace/`, RPC `trace.export`, `trace.history`                    |
| Product workspace (products, mapped sources, PRD, priorities) and Azure DevOps backlog, sprints, board and approved writes, ported from Beta 0.9 into the daemon                                                                                                                               | Done; tested end to end with a fake server. Needs a test against your real Azure DevOps Server. | `packages/work-store/src/workspace-service.ts`, `ado-*.ts`, RPC `workspace.*`, `ado.request`     |
| Agents screen: Create Agent, Edit Agent (picture and a brief change), Retire Agent (save work first), Working/Blocked badges; every team change is a request to the First Mate; pool secondmates show on their cards                                                                           | Done; self-tested. Requests fail here because Pi isn't installed.                               | `packages/amun-ui/src/rebuild/screens.tsx`, `avatar-choice.ts`, `daemon/contract-adapter.ts`     |
| Right-rail avatars of working (green ring) and blocked (red ring) agents; click opens that agent on the Agents screen                                                                                                                                                                          | Done; self-tested                                                                               | `packages/amun-ui/src/rebuild/rail.tsx`, `app.tsx`                                               |
| Island Send button: full width, label stays readable on hover (the plain button hover was hiding it on every primary button)                                                                                                                                                                   | Done; self-tested, answer reaches the work store                                                | `packages/amun-ui/src/rebuild/rebuild.css`                                                       |
| First Mate gets read-only Paseo tools plus heartbeats (decision 19); applies to the agent Amun runs in the Firstmate checkout                                                                                                                                                                  | Done; unit-tested. Not tested live here because Pi is not installed.                            | `packages/server/src/server/amun/first-mate-tools.ts`, `bootstrap.ts`, `agent/agent-manager.ts`  |
| Fixes from the Codex review: the chat reports a model so it can send; `/amun` refuses pages from other websites; Watch a crewmate works again (roster from the fleet snapshot, live text from `fm-peek.sh`, read-only); a request in flight when the connection drops fails instead of hanging | Done; tested, including a live check that a foreign origin gets 403                             | `contract-adapter.ts`, `attach-amun.ts`, `amun-client.ts`, RPC `crew.peek`                       |

## Still to do

- Trace bundle: add the Pi step-by-step timeline from the Paseo agent record.
- A test of Azure DevOps against your real server. Then Notion (memory sync, publishing, and the Notion progress test held back from the workspace port), PRs, Council, prototype, PRD authoring and backup.
- Show First Mate turns Amun did not ask for (heartbeats, wakes) in the chat. The `primary.output` event is defined but nothing sends it yet.
- The Pi RPC test on Tamer's Mac.
- Paseo features Tamer wants:
  - parallel development (Firstmate already gives each crewmate its own worktree);
  - MCPs;
  - every CLI running headless;
  - the browser and browser tools.

  Each one is checked against Firstmate first. Reference links are in project memory.
