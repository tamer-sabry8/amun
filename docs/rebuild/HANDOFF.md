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

| Area                                                                                                                                                                                                                 | State                                                                                           | Where                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Firstmate as a pristine subtree, with a CI guard                                                                                                                                                                     | Done                                                                                            | `vendor/firstmate`, `scripts/check-firstmate-pristine.sh`                                        |
| One home, no writes into it                                                                                                                                                                                          | Done                                                                                            | `packages/server/src/server/amun/amun-paths.ts`, `product-spaces.ts`                             |
| Azure DevOps token in Keychain, checked before saving                                                                                                                                                                | Done                                                                                            | `packages/server/src/server/amun/connections/`                                                   |
| Old work store ported, product chat wired to the daemon                                                                                                                                                              | Done                                                                                            | `packages/work-store`, `packages/amun-ui/src/daemon/contract-adapter.ts`                         |
| Question cards: choices, recommendation, "Write my own response", "Connect to Azure now"                                                                                                                             | Done; self-tested in the cloud, not yet with real Pi                                            | `packages/amun-ui/src/rebuild/question-card.tsx`, `packages/domain/src/work/question-choices.ts` |
| Trace bundle back end: Amun trace log (chats, calls, failures; secrets redacted), zip export, one-time history request to the First Mate                                                                             | Done; on screen in Settings, Advanced, Diagnostics and as a right-rail button (decision 18)     | `packages/server/src/server/amun/trace/`, RPC `trace.export`, `trace.history`                    |
| Product workspace (products, mapped sources, PRD, priorities) and Azure DevOps backlog, sprints, board and approved writes, ported from Beta 0.9 into the daemon                                                     | Done; tested end to end with a fake server. Needs a test against your real Azure DevOps Server. | `packages/work-store/src/workspace-service.ts`, `ado-*.ts`, RPC `workspace.*`, `ado.request`     |
| Agents screen: Create Agent, Edit Agent (picture and a brief change), Retire Agent (save work first), Working/Blocked badges; every team change is a request to the First Mate; pool secondmates show on their cards | Done; self-tested. Requests fail here because Pi isn't installed.                               | `packages/amun-ui/src/rebuild/screens.tsx`, `avatar-choice.ts`, `daemon/contract-adapter.ts`     |
| Right-rail avatars of working (green ring) and blocked (red ring) agents; click opens that agent on the Agents screen                                                                                                | Done; self-tested                                                                               | `packages/amun-ui/src/rebuild/rail.tsx`, `app.tsx`                                               |
| Island Send button: full width, label stays readable on hover (the plain button hover was hiding it on every primary button)                                                                                         | Done; self-tested, answer reaches the work store                                                | `packages/amun-ui/src/rebuild/rebuild.css`                                                       |
| First Mate gets read-only Paseo tools plus heartbeats (decision 19); applies to the agent Amun runs in the Firstmate checkout                                                                                        | Done; unit-tested. Not tested live here because Pi is not installed.                            | `packages/server/src/server/amun/first-mate-tools.ts`, `bootstrap.ts`, `agent/agent-manager.ts`  |

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
