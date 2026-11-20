# Amun rebuild: handoff

## Summary

- **What this is.** Amun was rebuilt on branch `claude/project-thread-3te02r` (PR #33).
  - The UI is the same as the old Amun.
  - Underneath it sit the Paseo daemon and Tamer's own Firstmate.
- **Who decides what.** Every product decision below came from Tamer, answered one question at a time on 18 November 2026. Each question had multiple choices and one recommended option.
- **Firstmate is never changed.** `vendor/firstmate` is a pristine copy of upstream, and CI checks this on every push. Amun only reads Firstmate's files, and only acts through the First Mate.
- **Where it stands now.** PR #33 (the rebuild), PR #35 and PR #36 are merged into `main`. Tamer tested `main` on his Mac on 18 November 2026; what that found, what was fixed and what to do next are in the next section.

This file was first written for the PR #33 merge. Later work adds to it; nothing in it is historical unless it says so.

## Where things stand and what to do next

Written at the end of 18 November 2026, after PR #36. Read this section before anything else, then "Read this first: Firstmate is the only path".

### Resume point (19 November 2026, end of session)

Pick up here. Branch `claude/amun-handoff-work-20261119`, PR #38: all checks green (1,039 tests); the one Codex review comment is fixed and resolved. Not merged; merging is Tamer's call.

1. **Approved by Tamer at 14:24 on 19 November 2026 ("all approved"): the search and replay preview, both proposals as shown.** Build it next, on a new branch from `main` after PR #38 merges (or on top of PR #38's branch if it has not merged). The design approved: `docs/preview/2026-11-19-search-and-replay/index.html` (open it with `lavish-axi docs/preview/2026-11-19-search-and-replay/index.html`; if Lavish shows a blank page, run `lavish-axi stop` first, as its server was stuck once today). Nothing is built yet. Build:
   - **Search:** answer the ⌘K palette's existing `content-search` request (`chrome.tsx`) from `WorkStore.search` (`packages/work-store/src/content-search.ts`, never connected), through a new RPC in `amun-rpc.ts` / `amun-rpc-handler.ts` and the adapter. Add the First Mate's own steps from Paseo's saved timeline (`agentManager.fetchTimeline` / `getTimelineRows` for the First Mate's agent id: user and assistant messages, tool calls with input, output and time). Results open the conversation with "What happened" at that step.
   - **Replay ("What happened"):** a read-only pane kind beside the conversation (`PaneTarget` in `work-session.tsx`, like `prd` and `backlog`), listing turns and steps from the same timeline, with Previous step / Next step, Search this conversation, Fold all, and a step panel (Summary, What it sent, What came back, Timing). Read only; nothing is re-run. Design reference: DeepSeek harness `packages/client/ui-trajectory` (its README and `.agents/notes/archived/feature/2026-07-27-trajectory-inspection-ledger.md`).
   - "What happened" opens from a link beside PRD / Backlog / Pull requests / Browser in the conversation header (as in the approved picture) and from search results. Resume and fork come later, each explained and asked about first.
   - Before calling it done: check it in the packaged app, run the impeccable detector on the changed screens, and show Tamer the built result.
2. **Tamer's instruction for the other features:** explain each one and ask before any work. **He does not want the agent org chart** (19 November 2026); do not build it. Atomic task checkout and chat-to-CLI continuity are still to be explained and asked about.
3. **Still to test on the Mac** with the DMG built from this branch (`packages/desktop/release/Amun-0.16.1-arm64.dmg`, not committed): a heartbeat reply in "Chat with Firstmate"; a restart continuing the same conversation; real work showing a secondmate or crewmate on the Agents screen; the Portfolio changes.
4. Then the open items below, one question at a time.

### Update, 19 November 2026, evening (branch `claude/amun-handoff-work-20261119b`)

- **Search and "What happened" are built** as approved (item 1 above). Not yet committed, not yet in the packaged app.
  - Daemon: `packages/server/src/server/amun/what-happened.ts` turns the First Mate's saved Paseo timeline into turns and plain-worded steps, and places each turn in its conversation by the captain's own words or the saved reply (no work area id travels with a message). Requests `work.search` and `happened.read` in `amun-rpc.ts`; both only read and never start or message the First Mate.
  - UI: `packages/amun-ui/src/rebuild/what-happened.tsx`, pane kind `happened` in `work-session.tsx`, grouped results in the palette (`chrome.tsx`).
  - Checked in an isolated preview with sample steps (no Pi there). Not checked against a real First Mate timeline: the plain words for each step depend on how Pi reports its shell calls, so look at this first on the Mac.
  - Steps are only readable for the First Mate loaded in this daemon run.
- **Tamer's answers the same evening:** atomic task checkout is not wanted (Firstmate already does it; do not show him Firstmate's own behaviour again). Chat-to-CLI continuity: skip for now. The test DMG comes after items 1, 2, 4 and 8.
- **Built after his answers (not yet on the Mac):** the trace bundle now holds `first-mate/steps.json`, the First Mate's turns and steps with secrets removed. `/calm` answers "Amun already shows the calm view." `/supervision-model <part of a name>` or `/supervision-model follow main` asks the First Mate to save or remove the pin in `config/supervision-branch-model`; Amun never writes it. Whether the First Mate does this when asked in chat is not tested with real Pi.
- **`/stow` is not wanted** (19 November 2026, recorded in `AGENTS.md`). Amun answers it itself and never sends it on.
- **Fork is built** (approved by Tamer on 19 November 2026 through the review page `docs/preview/2026-11-19-fork/index.html`; not yet in the packaged app or with real Pi):
  - Storage: migration 43 adds `work_chats` and `work_messages.chat_id`. The main chat has no row (`chat_id` NULL); the snapshot's `messages` is every main chat and `chats` holds each fork with its own messages. Commands `fork-chat` and `delete-chat`; `message` takes `chatId`.
  - Conversation (`work-session.tsx`): the copy and "Fork from here" icons under each message; a fork opens with "Forked from the main chat. Back to main chat"; messages written from a fork are saved in it, also when the reply arrives after the owner moved on.
  - Firstmate has one memory for every chat and is never rewound. Each message from a fork starts with a line saying which chat it is and what to set aside (`fork.ts`).
  - The stop card: activity for the work that started after the fork point and is still running. "Stop it" sends the owner's request to the First Mate in that chat; Amun stops nothing itself.
  - Sidebar folders (`folders.ts`, `chrome.tsx`): one folder per piece of work under its own name, most recently used first, its chats inside, General last. Tamer's rules: Firstmate's card always keeps its space (the list scrolls inside what is left); more than five chats shows "See more"; more than six folders shows "See all", which opens Portfolio.
  - Not built: deleting or renaming a fork from the screen (the command exists); search and "What happened" open a work's main chat, not the fork a hit is in.

- **Chat rules decided by Tamer on 19 November 2026 (in `AGENTS.md`, "Chats inside a piece of work"); not built yet.** Today a work has one main chat plus forks. Still to build, each visible part after a before/after preview: "New chat" in a folder and `/new`; a sprint link on a chat with sprint groups inside the folder; rename and archive; General with several chats; Firstmate's "new chat or fork?" card on a change of subject; the new-chat brief; the silent recap after Firstmate's memory starts fresh. Open technical question: how Amun learns that Firstmate's memory started fresh or was shortened (Pi reports compaction as an event; a new First Mate is known from `first-mates.json`). The test DMG waits until Tamer says to build it.

- **Fixes from Tamer's Mac test, evening of 19 November 2026 (three trace bundles):**
  - Firstmate's fleet snapshot never finished inside the app. On his herdr home the first crew-status read started the herdr server as its own child, the server kept the read's output open, and `fm-fleet-snapshot.sh` waited forever, so no fresh questions, crew or answers reached Amun (the Product Manager's Question 1 sat unseen). Amun now starts the home's herdr server on its own, the way Firstmate does, before reading the fleet (`ensureBackendServer` in `firstmate-cli.ts`). Firstmate is unchanged.
  - The First Mate can read the captain's Notion through Amun's connection: `~/.amun/bin/amun-notion search|read`, a read-only helper over an owner-only socket (`notion-for-first-mate.ts`). Writing stays a reviewed plan.
  - The owner's message is answered with its own turn's reply; a wake handled in the same run no longer replaces it. Bare all-clear wake replies ("Captain, shipshape.") are not added to the chat.
  - "Create a new product named X …" creates the product and opens it with the message; "interview me" is no longer filed as interview notes.
  - The First Mate's briefing tells it to repair its own monitoring without asking, and to run interviews itself one question at a time.
  - Loading screen: the animated ram with "Loading Amun", approved by Tamer.

- **Second round from Tamer's Mac test, 19 November 2026 (late):** question choices stack and wrap inside the card and the Firstmate card; a question card can be dismissed; Firstmate's crew show under plain names with plain reasons, blocked ones first, with "Ask Firstmate to unblock it" (a message to the First Mate). Once per home after setup, Amun asks the First Mate to register all twenty catalog agents as its own second mates, matching existing ones and starting each on its first job (`primary.once`, key `register-agents-v1`; Tamer chose this over starting all twenty). Not run against real Firstmate yet. Known and not changed: a Codex second mate stops at Codex's "Hooks need review" prompt because Firstmate keeps hooks on for second mates; the choice is the captain's, given to Firstmate in chat. Tamer also asked whether Home should show his last chat; not decided.

- **State at the end of 19 November 2026 (pull requests 39 to 42 merged; DMG built from `main`):**
  - Added after the notes above: a three-dots menu on each sidebar folder (Open, Rename, Delete with one confirmation; General has none; forks have none until a reversible archive exists, because chats are kept). A message to the First Mate now waits, up to ten minutes, for a turn Firstmate started itself (a wake or heartbeat) and never cancels it; before, the captain's message cancelled Firstmate's own turn and was lost ("which has now been stopped. Send this one again.").
  - What Tamer saw on his Mac that is Firstmate's or his setup's, not Amun's: 10 of his 12 second mates run on Codex, whose weekly limit was at 4%; Codex second mates stop at Codex's own prompts (hook trust, rate limit) because Firstmate keeps hooks on for second mates and has no arrow keys; his no-overage rule held a Researcher scout because the quota check could not prove Copilot allowance. He asked Firstmate to move the crew to Claude Code on Sonnet 5.5.
  - Waiting on Tamer: how a model switch in chat should reach the crew (recommended: a card asking "Use this for the whole crew too?", since his crew models are per-job rules in `config/crew-dispatch.json` with a Copilot credit limit); whether Home should show his last chat; the screens for the seven chat rules; archive for chats.
  - Not verified with real Firstmate: the one-time registration of the twenty agents, the Notion helper, and whether Firstmate keeps forks apart.

### Update, 20 November 2026 (after pull request 44): Claude subscription and old holds

- **Claude Pro/Max through Pi.** Tamer withdrew the 6 November rule. Accounts and models now has a "Claude Pro/Max" row (`providers` in `packages/amun-ui/src/rebuild/wizard.tsx`, `anthropic` in `oauthProviders` and `modelLoginOptions` in `packages/contracts/src/auth.ts`). Its status comes from `pi auth check --provider anthropic`, the same path as the other providers; Pi was already signed in. He was told Anthropic's terms may limit a subscription to Claude Code and Anthropic's own apps, and chose this. The rule is in `AGENTS.md`, "Claude subscription".
- **Codex and Claude Code on the Tools list.** Tamer could not tell they were on and signed in: the card says "Installed" and "Turn off" only. Both were on and signed in on 20 November (`codex login status`, `claude auth status`). Showing that on the card is not built; it needs his approval.
- **Old Firstmate holds under Needs your attention** (14 on his Mac, from sessions before Amun). Snooze does nothing for them: `answerHold` in `contract-adapter.ts` refuses anything but an answer, and the screen does not show the refusal. Only Firstmate can close or defer a hold (`fm-captain-hold.sh answer --release`, `reconcile close`, `hold --until`). The proposed fix, asked and not yet answered: "No longer needed" and "Remind me later" in the item's menu, each a request to Firstmate.
- **"Data Access Blocked".** macOS blocked Amun from another app's data after the new test DMG. Ad-hoc signing gives each build a new identity, so permissions are asked again. Which file was blocked is not known: this session could not read the privacy log. He was given the Settings path and a `log show` command to find it.

### Update, 20 November 2026 (pull request 44): chats that group themselves

Read this section first if your work touches chats, folders, the sidebar or Firstmate's card. Branch `claude/amun-handoff-work`, pull request 44. The plan and the stress test of Tamer's research are in `docs/plans/2026-11-20-auto-grouped-chats.md`. The approved pictures are in `docs/preview/2026-11-20-auto-grouped-chats/index.html`.

#### What Tamer asked for

- A folder in the sidebar for each product, project, task and RFP (roadmaps and others later), each holding many chats, with a way to start a new chat in each.
- The main chat is many chats too, never one endless chat.
- Amun groups chats itself. Most start with no folder and end up in the right one.
- Use case 1, typed in the main chat: "Create a new project for Gitex to be high priority and ready on Dec 6" creates the Gitex project and files that message as the first chat in the Gitex folder.
- Use case 2, typed inside a Gitex chat: "Create a new product called Amun-SDK and help me build the vision and problem statement for it" makes Amun ask whether to move the message to a new folder named AMUN-SDK.
- Use as much of the Paseo back end as possible and write little code. Everything goes through Pi and Firstmate.

#### Decisions, in the order Tamer made them

Each was asked as one question with choices and a recommended option. The rules are also in `AGENTS.md`, "Chats inside a piece of work".

| #   | Question                                                                         | Tamer's answer                                                                  | What it means in the code                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Are chats already built in Paseo, so only a front end is needed?                 | Answered by the stress test, and accepted: no.                                  | A Paseo chat is an agent with its own process and memory. One per chat would be a second agent Firstmate never sees. Chats are rows in Amun's own store; Paseo keeps hosting the one First Mate. |
| 2   | Who decides where a message belongs when it is not an explicit "create a new …"? | Firstmate suggests.                                                             | No separate router model and no embedding model. Firstmate's briefing has a `move` action.                                                                                                       |
| 3   | Should an explicit request for new work create the folder at once or ask first?  | Create it straight away.                                                        | `routeNewWork` returns `create`; no card. A name a folder already has still asks.                                                                                                                |
| 4   | How does a chat that drifted end up in the right folder?                         | Firstmate suggests, Tamer confirms.                                             | Nothing is ever moved without his click. "Keep it here" is remembered per folder.                                                                                                                |
| 5   | Should "Main chat" and the single "Chat with Firstmate" become ordinary chats?   | Yes, all ordinary chats.                                                        | Every chat is named from the owner's first message and can be renamed and archived.                                                                                                              |
| 6   | First sidebar picture: a "New chat" line inside every folder.                    | Rejected: "that takes real estate". Use ChatGPT's layout.                       | Folders with their chats under them; a New chat button on each folder's row.                                                                                                                     |
| 7   | Where is the move question asked?                                                | On Firstmate's card in the sidebar, with real buttons, not in the conversation. | The question is an attention item; the conversation only shows the held message.                                                                                                                 |
| 8   | Third round of pictures.                                                         | "Approve all."                                                                  | Built as shown.                                                                                                                                                                                  |

Asked and not answered: whether Home should be replaced by ChatGPT's "New chat" at the top of the sidebar. Tamer asked instead what Amun shows when it opens (answer: the ram with "Loading Amun", then Home, every time; it does not reopen the last chat). Home was left as it is. Whether Amun should open on the last chat is still his open question from 19 November.

#### What was kept from his research and what was not

| Research idea                                                                             | Outcome    | Why                                                                                                    |
| ----------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| The model proposes, the app validates and executes, the owner confirms                    | Kept       | It is how plans and question cards already work.                                                       |
| A cheap rule check for "create a new …" before any model                                  | Kept       | It existed as `asksForNewWork` / `newWorkNamed`; it now also reads "for <name>", priority and the day. |
| A separate fast router model with a JSON schema                                           | Rejected   | An AI call that does not go through Firstmate; Amun holds no model sign-ins.                           |
| A local embedding model for drift                                                         | Rejected   | Memory: Home is already over the 500 MiB budget.                                                       |
| One agent per folder, prompts sent in parallel                                            | Rejected   | One Firstmate, one message at a time.                                                                  |
| A directory on disk per project, worktrees, sandbox options                               | Rejected   | A folder is a row. Crew worktrees come from `fm-spawn`.                                                |
| A new SQLite schema, outbox, event log, two-device locks                                  | Not needed | The work store is SQLite and each command is one transaction; Amun is one Mac.                         |
| Compaction, cache warming, token budgets                                                  | Not Amun's | Pi and Firstmate own the prompt.                                                                       |
| Duplicate-name check, editable folder name, "keep here" remembered, safe dates, fail open | Kept       | Cheap, and they protect trust.                                                                         |
| One message split across several folders                                                  | Later      | Splitting needs a model; Firstmate can suggest it.                                                     |

#### How a chat is stored

- **A folder** is a work area (`work_areas`: product, project, task, RFP). The chats with no folder live in the work area named "Chat with Firstmate" (`generalConversationName`), one per group. The sidebar never shows that name; it lists its chats under "Chats".
- **A work's first chat has no row.** Its messages have `chat_id` NULL. Its name and archive mark are on the work: `first_chat_title`, `first_chat_archived_at`. This kept every existing conversation, search hit and "What happened" link working without rewriting data.
- **Every other chat is a `work_chats` row.** `kind` is `chat` (the owner started it) or `fork`. `forked_from` is `''` for a chat the owner started. `archived_at` is set while archived.
- **Migration 44** adds those columns, plus `priority` and `kept_here_json` on `work_areas`, and names each existing first chat from the owner's first message in it. Migrations are append-only.
- **The snapshot** (`packages/contracts/src/work.ts`): `areas[].firstChat { title, archivedAt }`, `areas[].priority`, `areas[].keptHere`; `chats[].kind`, `chats[].archivedAt`, `chats[].forkedFrom` (null for a chat the owner started). `messages` is still every work's first chat.

Commands added to the work store (`packages/work-store/src/work-store.ts`):

| Command                                                                  | What it does                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `new-chat { workAreaId }`                                                | An empty chat. Named by the owner's first message in it.                                                                                                                                                                                                     |
| `rename-chat { workAreaId, chatId \| null, title }`                      | `chatId` null is the first chat.                                                                                                                                                                                                                             |
| `archive-chat { workAreaId, chatId \| null, archived }`                  | Archived chats are kept whole.                                                                                                                                                                                                                               |
| `move-chat { workAreaId, chatId \| null, fromMessageId?, toWorkAreaId }` | Re-files that message and everything after it (or the whole chat) into the other work: its unused first chat, or a new chat. Leaves a card message `{ kind: "moved", toWorkAreaId, toChatId, name }` in the chat they left. Search still finds the messages. |
| `keep-here { workAreaId, name }`                                         | Remembers a name the owner said belongs in this work.                                                                                                                                                                                                        |
| `settle-card { messageId, card }`                                        | Replaces what a card message holds.                                                                                                                                                                                                                          |
| `create-area`                                                            | Now also takes `priority`.                                                                                                                                                                                                                                   |
| `message`                                                                | Names the chat from the owner's first message when it has no name.                                                                                                                                                                                           |

#### How a message is routed

All of this happens in the interface before anything is sent. No model is asked.

1. **`routeNewWork`** (`packages/domain/src/work/model.ts`) reads the first line.
   - `newWorkNamed` finds the kind and the name: after "named", "called", "titled", or after "for" when a proper name follows ("a product for the pilot" names nothing).
   - `statedPriority` stores only a priority said in words. `statedDueDate` takes a day only when tied to deadline wording ("due", "ready on", "by", "before", "no later than"); a day with no year is the next one that has not passed; a start day is not a deadline.
   - `sameWorkName` compares names without capitals, spaces, dashes or dots.
   - It returns one of: `none`, `create`, `existing` (a folder has that name), `offer_move` (typed inside another folder).
2. **From Home or Portfolio** (`submit` in `packages/amun-ui/src/rebuild/app.tsx`): `create` makes the folder with the priority and day and opens it with the message. `existing` holds the message in the latest chat with no folder and asks. Anything else goes on as before; a message that creates no work goes to the latest open chat with no folder (`looseChat`).
3. **From inside a chat** (`send` in `work-session.tsx`): in a chat with no folder, `create` makes the folder and sends the message there. Inside a folder, `offer_move` holds the message and asks. A name the owner kept in this folder, or the folder's own name, is `none`.
4. **If the question cannot be saved**, the message is sent where it was typed. A message is never lost.

#### How the move question works

- **Held message.** `askWhereItGoes` (`move-ask.ts`) saves a card message in the chat the words were typed in. Its card is a `MoveOffer` (`move-offers.ts`): `{ kind: "move-offer", state, held, fromMessageId, request, existingAreaId, workAreaId, chatId, to? }`. The conversation draws it as the owner's bubble with "Not sent yet" (`MoveLine`). It survives closing Amun.
- **The question.** The same call raises an attention item of kind `question` with ref `move:<card message id>`. `islandItem` (`packages/domain/src/work/home.ts`) keeps such an item on Firstmate's card even while its own chat is open, and puts it before everything else. A conversation does not list it among its own question cards.
- **Firstmate's card.** `IslandCard` in `chrome.tsx` draws a move question from `moveQuestion(...)`: title, one line of detail, the folder name to change, and the choices as buttons. Wording lives in `move-offers.ts` only.
- **The owner's choice** (`resolveMove` in `app.tsx`):
  - **Move to a new folder / Open <folder> / Create another:** creates the folder if needed (the typed name; "Create another" adds a number), then opens it with the held message, as a new chat when the folder's first chat is in use.
  - **Keep it here:** `keep-here`, then the message is sent in the chat it was typed in.
  - **Order matters:** the card and the attention item are settled only after the owner's message is saved where it goes (`sendAsTyped(text, onSaved)` / `takeAsTyped`). If Amun closes in between, the question is still open with the words on its card.
  - A moved card then shows "Continued in <folder>. Open".
- **Firstmate's suggestion.** `amunProtocol` (`view-model.ts`) has `{"do":"move","name","type","messages"}`. `raise` in `work-session.tsx` turns it into a `MoveOffer` with `held: null` and `fromMessageId` set to the owner's Nth-latest message. It is ignored when a question is already open in that chat, when the name is the folder's own, or when the owner kept that name here. Move then runs `move-chat`.

#### What Firstmate is told

Firstmate has one memory for every chat and is never rewound. Each message carries its own context:

- The work area's record, as before (`areaTurnContext`).
- In a fork: `forkNote`, as approved on 19 November.
- In a chat the owner started: `chatNote` (`fork.ts`). The first message says it is a new chat on a fresh topic, names the folder's other chats and says not to bring anything in from them. Later messages only name the chat.
- In a folder's first chat: the chat's name, once the folder has other chats.
- When Firstmate's conversation is new (`needsBriefing`): `chatRecap`, the chat's last eight messages, each cut to 400 characters. It is not shown.
- A reply nobody asked for (heartbeat, wake) is saved in the latest chat with no folder that is not archived (`recordFirstMateReply` in `packages/work-store/src/first-mate-thread.ts`); with every chat archived a new one is started.

#### The sidebar

`folders.ts` builds the lists; `chrome.tsx` draws them.

- **Your work:** one folder per work area in the group being worked in, most recently used first, at most six before "See all" (Portfolio). An open folder lists its chats, most recently used first, at most five before "See more".
- **A folder's row:** the three dots (Open, Rename, Archived chats when there are any, Delete with one confirmation) and New chat. New chat opens an unused chat when the folder has one, so empty chats do not pile up.
- **A chat's row:** the three dots with Rename, Move to another folder (a list of the other folders) and Archive; an archived chat has Bring back. There is no Delete on a chat: chats are kept.
- **Chats:** the chats with no folder, newest first, with their own New chat button and, when any are archived, an Archived chats menu.
- Both headings fold their list. New icons: `folder`, `folderOpen`, `compose` (`icons.tsx`).

#### Error cases and what happens

| Case                                                                   | Result                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Send pressed twice on a create request                                 | The store returns the folder that already exists; one folder.                                  |
| "Gitex" exists and the owner types "gitex" or "Amun SDK" vs "AMUN-SDK" | The existing folder is offered first.                                                          |
| No name given                                                          | Nothing is created; the message goes to Firstmate.                                             |
| "Create a landing page for Gitex"                                      | Not new work; it stays where it was typed.                                                     |
| "Dec 6" with no year                                                   | The next 6 December that has not passed, on the Mac's own calendar.                            |
| A start date only                                                      | No deadline is stored.                                                                         |
| The owner ignores the card and types something else                    | That message is sent as usual; the held one waits.                                             |
| Amun closes while a card is open, or mid-move                          | The held message and its question are still there on reopening.                                |
| Firstmate sends a malformed `move` block                               | It is dropped; nothing moves.                                                                  |
| Firstmate suggests a move twice                                        | The second is ignored while the first is open, and for good once the owner kept the name here. |
| A move after crew work began                                           | The work is not stopped; only Firstmate stops crew, when asked.                                |

#### The review on pull request 44

The automated Codex reviewer found three things; all were right and are fixed in commit `a933c48`: the first chat was not named to Firstmate; a held message could be lost if Amun closed between settling the card and saving the message; any date in a request was taken as the deadline.

#### Checked

- 1,107 tests, `typecheck:amun`, `typecheck:paseo`, lint, format and the Firstmate pristine check pass.
- The screens were walked through in an isolated copy with a sample workspace and no Pi (new chat, hold, move, keep, archive, create from Home): no errors. That walk was before the review fixes and was not repeated after them.
- The impeccable detector found nothing on the changed files.

To repeat the isolated walk: build with `npm run build -w @amun/work-store && npm run build -w @getpaseo/server` and `npx vite build` in `packages/amun-ui`; start the daemon with `AMUN_HOME` and `AMUN_FIRSTMATE_HOME` set to short throwaway folders, `PASEO_LISTEN=127.0.0.1:6790` and a `PATH` without `pi`, so no real Firstmate is started; serve the interface with `npx vite preview` and open it with `?daemon=ws://127.0.0.1:6790/amun`.

#### Not checked or not built

- **Nothing ran with real Pi or real Firstmate.** Check first on the Mac: whether Firstmate uses `move` only when it should; whether it keeps a new chat apart from the others; whether the recap reads well; and that a message moved to a new folder is answered there.
- **The recap** is given only when Firstmate's conversation is new. A memory shortened inside the same conversation (compaction) is not detected.
- **Search and "What happened"** still open a work's first chat, not the chat a result is in.
- **One message that asks for several folders** is not split; Firstmate answers it where it was typed.
- **Not built:** a sprint link on a chat; Firstmate's "new chat or fork?" card for a change of subject inside the same folder; `/new` as a typed command (the New chat button does it).
- **Packaged memory and startup** were not measured with these changes.
- **A fault found on the way, not fixed:** the daemon stops at start when `AMUN_HOME` is a very long path, because the Notion helper's socket path is too long. Tamer's `~/.amun` is short.

#### Still waiting on Tamer

- How a model switch in chat should reach the crew (recommended: a card asking "Use this for the whole crew too?").
- Whether Amun should open on the last chat, and whether Home becomes "New chat".
- Whether to turn on the first-run wizard, and whether its picks go to Firstmate.
- Which connector comes first.

### The number one rule

**Everything starts with Firstmate and goes through Firstmate, no matter what.** Tamer restated this on 18 November 2026 for all the work below. If a feature would start, steer, stop, resume, fork or replay an agent any other way, stop and ask him first. The single exception he has approved is the Council's Chair (decision 21).

### What happened on 18 November 2026

| Pull request | What it did                                                                                                                                                                                                                                   | State  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| #33          | The rebuild on the Paseo daemon and Tamer's Firstmate                                                                                                                                                                                         | Merged |
| #35          | The app starts its daemon; launch no longer waits on the login shell or the fleet snapshot; chat goes straight to the First Mate; the Amun name, icon and smaller app; model picker, account status, tool detection, Council and Notion wired | Merged |
| #36          | Messages queue instead of failing; slash commands work; answered questions show under Done; the fleet list is kept for launch; Portfolio has the message box; Council review fixes                                                            | Merged |

The detail is under "Changes after the PR #33 merge".

What Tamer's own tests confirmed on his Mac:

- The First Mate answers through Pi with no terminal (first trace, 14:25 UTC). This is the reply part of the Pi test in decision 11.
- Notion signs in: his screen showed "Notion MCP connected to Tamer's Space".

Not yet confirmed on his Mac with a build that has every fix: that the watcher and turn-end guard run in RPC mode, that a question from the First Mate shows as a question card, that five minutes is enough for Pi to acknowledge a first message on his home, a real council, and a Notion destination check and memory sync.

### Do next, in this order

1. **Rebuild the test DMG from `main`.** The DMG Tamer last had was built before the last two fixes in PR #36: it still sent `/stow` to the First Mate and could show a task held again as already answered. Steps are under "Building a test DMG".
2. ~~Settle the Portfolio message box.~~ Settled on 19 November 2026: Tamer kept it and approved the before/after preview (`docs/preview/2026-11-19-portfolio-message-box/`) after an impeccable critique. See "Changes on 19 November 2026".
3. **The four features Tamer asked to wire** (next heading). Search and replay is in preview (see the resume point above); the org chart is not wanted.
4. **The open items** (the heading after that).

### The four features to wire next

Tamer's instruction, 18 November 2026: check whether each of these exists; if it does, wire it; use the impeccable skill to design any page, UX or UI; and make sure everything starts and goes through Firstmate.

All four exist in part. They were built on 11 to 12 November 2026 as "R2 foundations" (PRs #13 to #15 on the old app): rules, storage, views and tests, with nothing calling them. `docs/HANDOFF-R2-FOUNDATIONS.md` and ADR-012 to ADR-015 in `docs/decisions/` describe them. The rebuild carried over the rules and the database tables but not the storage classes, so each one needs its storage class restored from git history (commit `c0130a4`, under `packages/data/src/`) the same way tool detection, the Council and Notion were in PR #35.

| Feature                         | Reference Tamer gave                       | In `main` today                                                                                                                                                                  | Only in git history (`c0130a4`)                                                                                                          | Check against Firstmate before building                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resume, fork, search and replay | https://deepseek.com/harness/en/           | Rules in `packages/domain/src/trajectory.ts`; the table `trajectory_events`; the view `packages/amun-ui/src/trajectory-view.tsx`, reachable only from the test-only legacy shell | `packages/data/src/trajectory.ts` and its tests                                                                                          | Nothing records events yet. Pi already keeps its own session tree, and Firstmate allows one live primary per home. Resume and fork must be a request to the First Mate, never a second Pi session started by Amun. Search and replay that only read are safe to do first.                                                         |
| Bring your own agent org chart  | https://paperclip.ing/product/open-source/ | Rules in `packages/domain/src/agent-org.ts`; the tables `agent_assignments` and `goals`; the view `packages/amun-ui/src/org-goals-view.tsx`, legacy shell only                   | `packages/data/src/agent-org.ts`, `goals.ts` and their tests                                                                             | Firstmate owns the crew: `secondmates.md`, `config/crew-dispatch.json` and the briefs. The chart must show Firstmate's real fleet (from `fm-fleet-snapshot.sh`) and send every change as a request to the First Mate, as the Agents screen does (decision 9). Amun must not keep a second, competing list of who reports to whom. |
| Atomic task checkout            | (named by Tamer; see ADR-014)              | The table `task_claims`; no rules file was found for it in `packages/domain/src`                                                                                                 | `packages/data/src/task-checkout.ts` and its tests                                                                                       | Firstmate already decides which crewmate takes a task, through `fm-spawn` and tasks-axi. A checkout in Amun must not become a second way to assign work. ADR-014 says Firstmate dispatch should take the checkout; that is a change to how Firstmate dispatches, so ask Tamer how far it should go.                               |
| Chat-to-CLI continuity          | https://www.onorca.dev/docs/cli/overview   | Rules in `packages/domain/src/session-ref.ts` (an `amun://session/<id>` reference)                                                                                               | `packages/data/src/session-surface.ts` and its tests. Its table `session_surfaces` is not in the current migrations and has to be added. | Tamer built Amun because he does not want the terminal (decision 11), so ask what he wants this for before building. Opening the same work from a terminal must attach to the First Mate's session, never start another primary for the home.                                                                                     |

Tamer also pointed to the OpenChamber roadmap, https://openchamber.dev/roadmap/, as a source of ideas. Nothing from it has been assessed yet.

How to do each one:

1. Read the ADR and the old code, and confirm the table and rules above by looking, since this list was made by search.
2. Ask Tamer one question at a time, with choices and a recommended option, wherever the Firstmate column raises a doubt.
3. Restore the storage class and its tests into `packages/work-store`, add one request to `packages/protocol/src/amun-rpc.ts` and `amun-rpc-handler.ts`, and answer it from `contract-adapter.ts`.
4. For anything visible, show Tamer the current screen beside the proposed one, run it through the impeccable skill, and wait for his approval. The two old views were never approved for the rebuilt shell.
5. Test in the packaged app, in isolation, and say what was not tested.

### Open items

Decisions waiting on Tamer:

- **First-run wizard.** It exists (`packages/amun-ui/src/rebuild/wizard.tsx`) and is switched off. Its Agents step would mark all 20 suggested agents as on the team without asking the First Mate. Asked on 18 November 2026: turn it on without the Agents step, or send the picks to the First Mate. Not answered yet.
- **Signing in to a model provider from inside Amun.** The buttons only show a note. Pi offers sign-in only in its terminal screen, and the old in-app sign-in was removed on purpose (decision 14).
- **"Chat with Firstmate" is labelled a Task.** A separate conversation type is a visible change.
- **Two lines on the Tools list are no longer true:** "A tool you turn off is never handed work" and "Amun bundles its own Pi". Changing wording needs his approval.
- **Whether to use Vercel's UI SDK for prototypes.** Research only; nothing was built. The advice given was not to adopt it as the foundation yet, because it is a days-old beta and the one independent test found it several times slower and costlier with no clear gain, and to try it side by side on a separate branch first. Tamer asked that any work on it be its own branch and pull request.

Known problems:

- **A new First Mate is started each time the daemon starts.** Fixed on 19 November 2026 (see below); not yet confirmed on the Mac.
- **`/stow` is refused.** `AGENTS.md` requires it to run on the Mac only, with each change to a pinned entry reviewed. That local path is only in git history.
- **`/calm` and `/supervision-model`** say they are not available inside Amun.
- **Firstmate's fleet snapshot takes about two minutes on Tamer's home.** Amun copes with it but cannot make it faster; the script is Firstmate's.
- **Two restored Notion tests failed once** in one full run and passed in every run after, including under load. Not reproduced.
- ~~The desktop `build` script~~ and ~~`README.md`~~: fixed on 19 November 2026.

Not wired yet (the screens exist; nothing answers them): prototype and output preview, attachments and screenshots, publishing to Notion, pull requests and code changes, backup, GitHub and Obsidian connections, global search, skills from a Git link, publishing approved plans to trackers, reminders delivery, PRD and story authoring, Jira and Linear, and hosted connectors such as Gmail. Tamer chose Notion first of prototype preview, attachments and Notion; the other two are next when he says so.

### Changes on 19 November 2026

Branch `claude/amun-handoff-work-20261119` (PR #38). The only visible changes are the approved Portfolio ones below.

- **Delegated jobs now reach Firstmate.** The chat tells the First Mate to hand real work to an agent with a `delegate` action, and the UI sends `work-delegate`. In the old app that started a worker outside Firstmate; in the rebuild nothing handled it, so the chat said "X is on it" and nothing ran. The adapter now sends the First Mate a request to give the job to the matching secondmate (`fm-send`, or `fm-brief`, `fm-home-seed`, `fm-spawn --secondmate`) or to crew (`fm-spawn`), not to do it itself, to supervise it and report back. Its answer is kept in the same conversation (`delegationRequest` and `delegate` in `contract-adapter.ts`). The result arrives later as an unprompted turn, below.
- **Heartbeats, wakes and guard notices show in chat.** `UnpromptedTurns` (`packages/server/src/server/amun/unprompted-turns.ts`) watches the First Mate's turns. A turn Amun did not start (`PrimarySessions.isAmunTurn`) has its last reply saved in the standing "Chat with Firstmate" conversation (`recordFirstMateReply` in `packages/work-store/src/first-mate-thread.ts`), traced, and sent as `primary.output` plus `work.updated`.
- **The same First Mate after a daemon restart.** Amun keeps which agent is each home's First Mate in `~/.amun/first-mates.json`. On start it resumes that agent through Paseo (`ensureUnarchivedAgentLoaded`), only if it runs the same harness in the same Firstmate checkout, and starts a new one only when that fails.
- **The desktop `build` script works.** It calls the new root script `build:desktop-inputs` (Council stage, server build, UI build).
- **`README.md`** describes the current npm setup and the Firstmate-only design.
- **Portfolio message box, approved by Tamer.** The placeholder says where the answer goes ("Ask Firstmate. Its answer opens in the conversation."); statuses read "Active"; the empty line says "Work you start appears here."; the "/" list matches Home's; the Type, Status and Group filters are kept when he leaves and comes back. The message box on every screen gets the theme's accent ring while it has focus. Checked in an isolated preview in Chrome; not yet in the packaged app.

Not tested on a Mac with real Pi: all three behaviour changes above are unit-tested only. Check on the Mac: ask the First Mate for a heartbeat and see its reply in "Chat with Firstmate"; restart Amun and see the earlier conversation continue; ask for real work in a conversation and see a secondmate or crewmate appear on the Agents screen.

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

Every connector follows the Firstmate-only path and Tamer's sign-in policy (`AGENTS.md`, "Connector authentication"):

- **Sign in through the provider's official hosted MCP server first.** This means browser sign-in (OAuth) in an external browser: Microsoft Edge for company sign-ins, and Edge or Dia for Notion. Use an API key or token only after you have checked that hosted MCP sign-in is unavailable or incompatible, explained the supported alternative to Tamer, and got his OK. Never fall back silently. Azure DevOps is the exception: keep its PAT path.
- **Credentials** go in the Keychain through `ConnectionStore`, never in renderer state, logs or traces.
- **Reads** feed Amun's records.
- **Writes** need the captain's approval and exact-content review. Signing in does not authorize publishing.
- **Work they trigger** goes through the First Mate.
- **Firstmate's home** is never written by a connector.

Azure DevOps Server is built: Keychain, connection check, backlog, board and approved writes (decision 13). It still needs a test against Tamer's real server.

| Connector                                                | Status today                                                                                                                                                                                                                                                                                         | What it is for                                              | What is missing                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jira**                                                 | An adapter exists: `JiraAdapter` in `packages/server/src/server/amun/delivery-sync.ts` (Jira Cloud REST: sprints, issues, create, move, comment). It is tested only against recorded responses (`pm.test.ts`). It is not wired to any RPC or screen, and `ConnectionStore` only accepts `ado` today. | A delivery tracker, like Azure DevOps                       | Check Atlassian's hosted MCP browser sign-in first. Then accept the `jira` kind in `ConnectionStore`, storing the credential in the Keychain, with a connection check. The adapter's REST calls may need to move onto the MCP tools. Add an RPC and a Settings form. Route the backlog and board through it. Decide whether Jira Server or Data Center also matters. Test against a real site. |
| **Linear**                                               | An adapter exists: `LinearAdapter` in the same file (GraphQL: cycles, issues, create, move, comment). Like Jira, it is tested only against recorded responses and not wired.                                                                                                                         | A delivery tracker                                          | The same steps as Jira. Check Linear's hosted MCP browser sign-in first, and use an API key only if that route is shown not to work and Tamer agrees.                                                                                                                                                                                                                                          |
| **Notion**                                               | Partly ported: memory sync, receipts and result types are in `packages/work-store`. The Notion progress test is held back. There is no live connection in the rebuilt app yet.                                                                                                                       | Memory sync, publishing approved documents, tasks (J8, F14) | Hosted MCP OAuth in an external browser (Edge or Dia), with no manual-token onboarding. Finish the port and the held-back test. Add conflict handling for keep, delete or unlink (R1 brief, section 7).                                                                                                                                                                                        |
| **Office 365** (Outlook mail, calendar, OneDrive, Teams) | Not started                                                                                                                                                                                                                                                                                          | Mail and calendar context, documents                        | Check a hosted MCP sign-in first; otherwise Microsoft Graph OAuth in Edge, with the token in the Keychain. Decide on read-only scopes first. Sending mail is a later capability in the brief, and needs approval.                                                                                                                                                                              |
| **ClickUp**                                              | Not started                                                                                                                                                                                                                                                                                          | A task and delivery tracker                                 | Check hosted MCP sign-in first. Then a `DeliveryAdapter` like Jira and Linear, so it fits the same board.                                                                                                                                                                                                                                                                                      |
| **Gmail**                                                | Not started                                                                                                                                                                                                                                                                                          | Reading mail as records; drafts                             | Check hosted MCP sign-in first; otherwise Google OAuth. Read and draft first. Sending needs approval and is a later capability.                                                                                                                                                                                                                                                                |
| **Google Calendar**                                      | Not started                                                                                                                                                                                                                                                                                          | Meetings and deadlines alongside reminders                  | The same sign-in as Gmail and Drive. Start read-only.                                                                                                                                                                                                                                                                                                                                          |
| **Google Drive**                                         | Not started                                                                                                                                                                                                                                                                                          | Documents as product sources (J1)                           | The same sign-in as Gmail. Read selected files into records with source links.                                                                                                                                                                                                                                                                                                                 |

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
- **Replies in chat (done 19 November 2026).** A heartbeat's reply, and any other First Mate turn Amun did not start, is saved in "Chat with Firstmate" (see "Changes on 19 November 2026").

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

### 21. How the Council's Chair runs

- **Question:** The old Council started its Chair directly on Claude Code, outside Firstmate. How should the restored Council run its Chair?
- **Options:**
  - Directly, as before ★
  - Through the First Mate
  - Settings only for now
- **Answer:** Directly, as before (18 November 2026).
- **Why:** The Council follows upstream Roast Room, and `AGENTS.md` says not to change that flow. It is a review tool: it starts no crew and no worktrees.
- **How it works:** The daemon starts the Chair on this Mac's Claude Code from the pinned, checksum-verified Roast Room (`runtime/roast-room/manifest.json`, staged by `npm run council:stage`). The Chair's questions reach the captain as question cards. This is the one place Amun starts an agent without the First Mate.

## Changes after the PR #33 merge (18 November 2026)

Tamer tested `main` on his Mac the same day. These came out of that test.

### Fixed

- **The packaged app never started its daemon**, so the window stayed on "Opening Amun…". The Amun UI never sends `start_desktop_daemon` (Paseo's own UI did). The main process now starts it at launch (`startDesktopDaemonOnLaunch` in `packages/desktop/src/daemon/daemon-manager.ts`).
- **Slow launch, cause one: the login shell.** Reading the shell environment held the window back for 20 seconds or more when the shell profile is slow. A copy is now kept in the app's settings folder (`login-shell-env.json`, readable by the owner only), applied at once and refreshed in a separate process (`packages/desktop/src/amun-shell-env-cache.ts`).
- **Slow launch, cause two: the fleet snapshot.** `fm-fleet-snapshot.sh` takes about two minutes on Tamer's home. Every poll and screen refresh used to start its own copy, each timed out at 60 seconds, and the screen waited on them. Now one run happens at a time, callers share it and the last good result, it has five minutes to finish, it rests after a slow run, and the screen never waits for the first one (`shareFleetSnapshots` in `packages/server/src/server/amun/firstmate-cli.ts`). The script itself is Firstmate's and is not changed.
- **Chat asked "Where does this belong?" and never reached the First Mate.** A keyword filter on Home filed every message as a task, product, project or RFP before any model saw it. A question or request now goes straight to the First Mate, in one standing conversation per group named "Chat with Firstmate". The card only shows when the message itself asks for new work of a named kind (`asksForNewWork` in `packages/domain/src/work/model.ts`).
- **Names and size.** The app is called Amun everywhere it shows (it said "Quit Paseo"); the settings folder keeps the name `Paseo` so an install keeps its settings. The app icon is the ram logo. The packaging step that strips unused files looked for `Paseo.app` and never ran; the app is now about 530 MB installed, down from 906 MB.

### Wired

| Area                      | State                                                                                                                                                                                                                                                                                                  | Where                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Model picker              | Lists the models Pi offers and switches the First Mate; the choice is kept in `~/.amun/first-mate-model.json`. Tested in an isolated instance; no message was sent on a switched model.                                                                                                                | RPC `models.list`, `primary.setModel`; `first-mate-models.ts`                                        |
| Accounts and models       | Shows each provider's status as Pi reports it (`pi auth check --json`). Amun never sees a credential. The Sign in buttons only show a note: Pi offers sign-in only in its terminal screen, and the old in-app sign-in stays removed (decision 14) until Tamer decides.                                 | RPC `accounts.check`                                                                                 |
| Tools already on this Mac | The detection inspired by Emdash, restored from Beta 0.9 with its tests. The on/off switch is remembered but does not reach Firstmate's dispatch.                                                                                                                                                      | `packages/work-store/src/tool-probe.ts`, `tool-registry.ts`, `tools-service.ts`; RPC `tools.request` |
| Council                   | Restored from Beta 0.9 with its tests (decision 21). The page, seats and the live room work in the packaged app. A real council has not run: Claude Code on Tamer's Mac was signed out. A failed run now shows Claude Code's own reason.                                                               | `packages/council`; RPC `council.request`                                                            |
| In-app browser panel      | Restored from Beta 0.9 with its navigation rules. The Council's room is shown in it; other uses are untested.                                                                                                                                                                                          | `packages/desktop/src/features/amun-browser`                                                         |
| Notion                    | Sign-in through Notion's hosted MCP server in Edge or Dia, test, destination check, disconnect and linked memory fields, restored from Beta 0.9 with its tests. The grant is kept in the Keychain. Confirmed against Notion's live service up to the browser step only. Publishing pages is not wired. | `packages/notion`; RPC `notion.request`; event `renderer.event`                                      |

`packages/notion` pins its own `@modelcontextprotocol/sdk` (1.32.2); the rest of the app stays on 1.29.0. The daemon loads the Council and Notion through the `@amun/work-store` bundle (`packages/work-store/build.mjs`).

### Building a test DMG

The `build` script in `packages/desktop` calls a root script that does not exist. Until that is fixed, build by hand from the repository root:

```sh
npm ci
npm run council:stage
npm run build:server
(cd packages/amun-ui && npx vite build)
cd packages/desktop && npm run build:main
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder.yml \
  --mac dmg --arm64 --publish never \
  -c.mac.identity=- -c.mac.notarize=false -c.mac.hardenedRuntime=false
```

This is the ad-hoc-signed trusted-tester build (`AGENTS.md`). Hardened runtime must be off for it: macOS refuses to load Electron in an ad-hoc-signed app with hardened runtime on.

### Second round, same day (PR #36)

Found in Tamer's next test of the merged build.

- **One stuck message blocked every message after it.** A first message to a freshly started First Mate was not acknowledged by Pi within Paseo's one-minute limit. Paseo reported a failure but kept the turn open, so every later message failed with "Agent … already has an active run". Now messages for a home are answered one at a time in order (`PrimarySessions.send`), a failed turn is closed so the next one can run, Pi has five minutes to acknowledge, and failures are said in plain words with no agent id.
- **Slash commands did nothing.** `/model` and `/theme` were only suggestions; nothing carried them out, and Enter erased any words typed after a command. Amun now carries out `/model` and `/theme` itself in every message box (`packages/amun-ui/src/rebuild/app-commands.ts`). The work commands (`/prd`, `/stories`, `/research`, `/sprint plan`, `/prioritize`, `/update`) reach Firstmate in plain words. Firstmate's own skills (`/ahoy`, `/bearings`, `/afk`, `/quiet`) are sent to the First Mate as `/skill:name`, which Pi expands; this is from Pi's documentation and was not run against the real home. `/stow` is not sent: `AGENTS.md` requires it to run on the Mac only with pinned changes reviewed one by one, and that local path is not restored yet. `/updatefirstmate` is refused here (`AGENTS.md`: never run the update skill on an operational home). `/calm` and `/supervision-model` say they are not available inside Amun yet.
- **The owner's message was pushed out of sight.** Firstmate's standing holds (a dozen on Tamer's home) were listed in every conversation, below the messages. A conversation now shows only its own questions; standing holds are answered from Needs your attention and the Firstmate card.
- **Answering a hold gave no sign.** The answer is now shown at once under Done ("You answered: …. Firstmate is reading it."), and the hold comes back open, saying why, if the answer did not reach Firstmate.
- **Questions appeared minutes after launch.** The last fleet snapshot is kept in `~/.amun/fleet-snapshots/` and shown at launch until the home has been read again.
- **Chat on other screens.** Portfolio has the message box; a message sent from there goes the same way as from Home.
- **Who is working.** While Firstmate is busy, the conversation names the crew that are working, from the fleet snapshot.
- **Council review findings (Codex, PR #35).** Each question in a batched Chair request gets its own card and the Chair hears back only when all are answered, in order; and two run requests arriving together start one Chair.

Still open from this round: a new First Mate agent is created each time the daemon starts (the earlier ones stay in Paseo's registry and their conversation is not resumed).

Two more fixes went into PR #36 after its review: a task that Firstmate holds again after it was answered is shown as a new question, not as already answered (`settleHoldAnswers` in `packages/amun-ui/src/daemon/contract-adapter.ts`), and `/stow` is refused (see "Open items").

What is still open is listed once, under "Where things stand and what to do next".

## Standing rules from Tamer

- Everything starts with Firstmate and goes through Firstmate, no matter what. This is the number one rule (restated 18 November 2026).
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

This is the list from the PR #33 merge, brought up to date. The ordered list of what to do next is under "Where things stand and what to do next".

- Trace bundle: add the Pi step-by-step timeline from the Paseo agent record.
- A test of Azure DevOps against Tamer's real server.
- Notion: publishing approved documents, and the Notion progress test held back from the workspace port. Sign-in and memory sync are wired (PR #35).
- PRs, prototype, PRD authoring and backup. The Council is wired (PR #35).
- ~~Show First Mate turns Amun did not ask for (heartbeats, wakes) in the chat.~~ Done 19 November 2026; to confirm on the Mac.
- The rest of the Pi RPC test on Tamer's Mac: the reply arrives (confirmed 18 November 2026); the watcher, the turn-end guard and a question card are not confirmed.
- Paseo features Tamer wants:
  - parallel development (Firstmate already gives each crewmate its own worktree);
  - MCPs;
  - every CLI running headless;
  - the browser and browser tools (the in-app browser panel is restored, PR #35).

  Each one is checked against Firstmate first. Reference links are in project memory.
