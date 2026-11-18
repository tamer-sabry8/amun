# Amun rebuild: handoff

## Summary

- **What this is.** Amun was rebuilt on branch `claude/project-thread-3te02r` (PR #33).
  - The UI is the same as the old Amun.
  - Underneath it sit the Paseo daemon and Tamer's own Firstmate.
- **Who decides what.** Every product decision below came from Tamer, answered one question at a time on 18 November 2026. Each question had multiple choices and one recommended option.
- **Firstmate is never changed.** `vendor/firstmate` is a pristine copy of upstream, and CI checks this on every push. Amun only reads Firstmate's files, and only acts through the First Mate.
- **Still open:**
  - A Mac test of Pi running headless.
  - The trace bundle.
  - The rest of the Azure DevOps work.
  - The Agents screen.
  - The Paseo features Tamer asked for (see "Still to do").

This file is updated with each commit. It is final when PR #33 merges.

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
- **Answer:** pending.

## Standing rules from Tamer

- Ask one question at a time, with multiple choices and a recommended option, before any code or workflow change.
- Never modify Firstmate. It must stay updatable from upstream.
- Any UI or UX change uses the impeccable skill and needs approval of a before/after preview.
- The final UI must match his screenshots of the old Amun. Every red annotation is fixed and self-tested.
- Paseo features must not conflict with Firstmate, especially worktrees and agent profiles.

## Built so far

| Area | State | Where |
|---|---|---|
| Firstmate as a pristine subtree, with a CI guard | Done | `vendor/firstmate`, `scripts/check-firstmate-pristine.sh` |
| One home, no writes into it | Done | `packages/server/src/server/amun/amun-paths.ts`, `product-spaces.ts` |
| Azure DevOps token in Keychain, checked before saving | Done | `packages/server/src/server/amun/connections/` |
| Old work store ported, product chat wired to the daemon | Done | `packages/work-store`, `packages/amun-ui/src/daemon/contract-adapter.ts` |
| Question cards: choices, recommendation, "Write my own response", "Connect to Azure now" | Done; self-tested in the cloud, not yet with real Pi | `packages/amun-ui/src/rebuild/question-card.tsx`, `packages/domain/src/work/question-choices.ts` |

## Still to do

- Trace bundle (download for debugging). The location of the export button needs approval.
- The rest of Azure DevOps: backlog, sprints, and approved writes. Then Notion, PRs, Council, prototype, PRD and backup.
- Agents screen (pool and live team) and right-rail avatars. Also fix the island Send button.
- The Pi RPC test on Tamer's Mac.
- Paseo features Tamer wants:
  - parallel development;
  - MCPs;
  - every CLI running headless;
  - the browser and browser tools.

  Each one is checked against Firstmate first. Reference links are in project memory.
