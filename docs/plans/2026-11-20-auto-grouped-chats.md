# Auto-grouped chats: stress test of the research and the proposed plan

20 November 2026. The decisions below were made and the first version was built the same day; `docs/rebuild/HANDOFF.md` says what was built and what was not.

## The goal, in the owner's words

- The sidebar has a folder for each product, project, task and RFP (roadmaps and others later). Each folder holds many chats, with a "New chat" in each.
- General (the main chat) also holds many chats. It is never one endless chat.
- Amun groups chats itself. Most chats start in General and end up in the right folder.
- **Use case 1.** In General: "Create a new project for Gitex to be high priority and ready on Dec 6". Amun creates the Gitex project and files this message as the first chat inside the Gitex folder.
- **Use case 2.** Inside a Gitex chat: "Create a new product called Amun-SDK and help me build the vision and problem statement for it". Amun shows a card: this looks like a new product that is not part of Gitex; move this message to a new folder named "AMUN-SDK"? Yes does it.

## Answer to "the chats are already built in Paseo, I only need the front end"

Partly. The back end is mostly there, but it is Amun's own store, not Paseo's chats.

- **Paseo's chat is an agent.** In Paseo a chat is an agent session with its own process and its own memory, inside a workspace. Every research document builds on that: `client.workspaces.create({ agent })` and `agent.run(prompt)` start one agent per folder or chat.
- **That breaks the owner's rules.** There is one Firstmate per home with one memory, a chat never gets its own Pi session (`AGENTS.md`, "Chats inside a piece of work"), and `create_agent` and `create_workspace` are on the First Mate's blocked list (decision 19). A Paseo chat per folder would be a second agent the watcher never sees.
- **What already exists in `main`:**
  - Folders are work areas (`work_areas`: product, project, task, RFP, with a due date).
  - Chats are `work_chats`, and every message carries a `chat_id` (migration 43, built for forks).
  - The sidebar already draws folders with their chats (`folders.ts`).
  - "Create a new product named X …" already creates the work and opens it with the message (`newWorkNamed` in `packages/domain/src/work/model.ts`, used in `app.tsx`).
- **What Paseo keeps doing, unchanged:** hosting the First Mate (`pi --mode rpc`), carrying messages, the saved timeline behind search and "What happened", and the daemon that serves Amun's store.

So the new back-end code is small: a few work-store commands and one migration. Most of the work is the front end and the wording Firstmate is given.

## Stress test: what holds and what does not

| Research proposal                                                                                                                               | Verdict for Amun                | Why                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The model proposes, the app validates and executes, the owner confirms                                                                          | Keep                            | It is already how plans and question cards work.                                                                                                                                                                                      |
| Never move a chat silently; show a card with Move / Keep here                                                                                   | Keep                            | Matches use case 2 and the rule that the owner decides.                                                                                                                                                                               |
| Stage 1: cheap deterministic check for "create a new …"                                                                                         | Keep                            | Already exists as `asksForNewWork` / `newWorkNamed`. Needs to learn "project for Gitex", priority and dates.                                                                                                                          |
| Stage 2: a separate fast router model (Haiku, Flash) with a JSON schema                                                                         | Reject                          | It is an AI call that does not go through Firstmate. Amun also holds no model credentials; Pi does.                                                                                                                                   |
| Local embedding model for drift                                                                                                                 | Reject                          | A new model in the daemon costs memory, and Home is already over the 500 MiB budget.                                                                                                                                                  |
| Firstmate as the judge of subtler drift                                                                                                         | Use instead                     | `AGENTS.md` already says Firstmate asks "new chat or fork?" on a change of subject. It answers in its own words and Amun turns that into a card (decision 15: no extra Pi tool).                                                      |
| "0 tokens reach the agent before confirmation"                                                                                                  | Keep only for explicit requests | Amun can hold a message its own rules catch (both use cases). For subtle drift Firstmate has already read it. That is acceptable here: Firstmate has one memory for every chat by design, so there is no per-chat context to pollute. |
| One agent per folder; slices sent in parallel with `Promise.allSettled`                                                                         | Reject                          | One Firstmate, answering one message at a time (`PrimarySessions.send`).                                                                                                                                                              |
| A folder on disk per project (`~/.paseo/folders/<slug>`, `PROJECT.md`), worktrees, sandbox options                                              | Reject                          | A folder is a row in Amun's store. Crew get worktrees from `fm-spawn`. This also removes the path-traversal and zombie-folder cases.                                                                                                  |
| New SQLite schema, WAL, outbox, event log                                                                                                       | Not needed                      | The work store is already SQLite and each command runs in one transaction.                                                                                                                                                            |
| Optimistic locks and 409 for two devices approving at once                                                                                      | Not needed now                  | Amun is one Mac. Double-click protection is enough.                                                                                                                                                                                   |
| Compaction, cache warming, context budgets, token meters                                                                                        | Not Amun's                      | Pi and Firstmate own the prompt. Amun only needs to know when Firstmate's memory started fresh, for the silent recap.                                                                                                                 |
| Duplicate and near-duplicate names; relative dates; editable name on the card; "Keep here" remembered as an alias; fail open when routing fails | Keep                            | All cheap and all protect trust.                                                                                                                                                                                                      |
| Multi-project prompts split into slices                                                                                                         | Later                           | Splitting one message into several needs a model. Firstmate can propose it; build after the single-target flow is proven.                                                                                                             |
| Undo for 30 days, confidence scores on the card                                                                                                 | Drop                            | Moving a chat back is the undo. Plain words, no scores (owner's wording rule).                                                                                                                                                        |

## Decisions

- **20 November 2026, owner:** Firstmate suggests where a message belongs when it is not an explicit "create a new …" request. No separate router model.
- **20 November 2026, owner:** an explicit request for new work creates the folder straight away and files the message as its first chat. A name that matches an existing folder still asks.
- **20 November 2026, owner:** when a chat drifts to another subject, Firstmate suggests the move and the owner confirms. Nothing moves without the owner's yes.
- **20 November 2026, owner:** General and every folder hold ordinary chats. There is no fixed "Main chat" or single "Chat with Firstmate"; existing conversations are kept as the first chat in each.
- **20 November 2026, owner:** the sidebar follows ChatGPT's layout: folders with their chats under them and a New chat button on each folder's row. The first proposal, a "New chat" line inside every folder, was rejected.
- **20 November 2026, owner:** the move question is asked on Firstmate's card in the sidebar, with real buttons, not in the conversation. The conversation only shows the held message, marked "Not sent yet".

## Where this changes rules already in `AGENTS.md`

These need the owner's decision before any build.

1. **"Nothing starts a chat automatically."** Use case 1 starts one automatically. Proposed new rule: an explicit request for new work creates the folder and files the message there without asking; anything less explicit shows a card; nothing is ever moved without the owner's yes.
2. **"After a few turns they end up in the right grouping."** Proposed: Firstmate suggests the move with a card after the subject has clearly changed; it never moves on its own.
3. **One standing "Chat with Firstmate" per group.** General becomes a folder with many chats, and the work's main chat becomes an ordinary chat that can be renamed and archived.

## How it would work

### Deciding where a message goes

1. **Amun's own rules, before sending** (no model):
   - An explicit request for new work, with a name ("Create a new project for Gitex …").
   - The name is compared with every folder, archived ones included, ignoring case, spaces and dashes.
   - From General or Home: create the folder, file the message as its first chat, open it, send to Firstmate.
   - From inside another folder: hold the message and show the move card.
2. **Firstmate, in its reply** (everything Amun's rules miss):
   - Its briefing tells it the folder it is in and the names of the other folders.
   - When the message belongs elsewhere, it says so in a fixed short form. Amun shows the same move card.
   - If it says nothing, the message stays where it was typed.

### The move card

- Says what Amun noticed and why, in plain words.
- The folder name can be edited on the card.
- Choices: "Move to a new folder", "Keep it here". When the name matches an existing folder: "Move to <folder>", "Create another", "Keep it here".
- Reuses the existing question card pattern. Its look needs the owner's approval through a before/after preview and `/impeccable`.

### What "move" means

- **Message not sent yet** (caught by Amun's rules): it is filed straight into the new folder. Nothing appears in the old chat except one line, "Continued in AMUN-SDK".
- **Message already answered** (Firstmate's suggestion): the message and its reply are re-filed into the new chat, and the old chat keeps the same one line.
- **What Firstmate is told:** each message already starts with a line naming its chat (as forks do). A moved chat's next message says which folder it now belongs to.
- **Crew work already started** is not undone by a move. Firstmate stops it only if the owner asks.

### Many chats per folder

- "New chat" in each folder and in General, and `/new`.
- Named from the first message; rename; archive by hand; archived chats stay searchable.
- A message from Home or Portfolio that creates no work goes to General's most recent chat.

## Requirements

| #   | Requirement                                                                                       |
| --- | ------------------------------------------------------------------------------------------------- |
| R1  | Every folder, General included, holds many chats and offers "New chat".                           |
| R2  | An explicit new-work request from General or Home creates the folder and files the message there. |
| R3  | Priority and due date in the request are stored on the work. Only what the owner said is stored.  |
| R4  | A new-work request typed inside another folder shows the move card before anything is sent.       |
| R5  | Firstmate can suggest a move for a message already sent; the owner decides.                       |
| R6  | "Keep it here" is remembered for that name in that folder and not asked again.                    |
| R7  | A name that matches an existing or archived folder never creates a twin without asking.           |
| R8  | A held message is never lost: it stays saved until the owner chooses.                             |
| R9  | Creating the folder, the chat and filing the message happen together or not at all.               |
| R10 | If anything in routing fails, the message goes where it was typed.                                |
| R11 | Every AI request goes to Firstmate through Pi. Amun starts no other agent or model call.          |
| R12 | No file under Paseo's own code or `vendor/firstmate` changes.                                     |

## Error scenarios

| Scenario                                                             | What Amun does                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The owner clicks Send twice                                          | One folder, one chat, one message (the command carries one id).                                                      |
| "Gitex" exists, or "Amun SDK" vs "AMUN-SDK"                          | Card offers the existing folder first.                                                                               |
| The matching folder is archived                                      | Card offers "Bring it back" or "Create another".                                                                     |
| "Dec 6" with no year                                                 | Next future 6 December in the Mac's time zone; the year is shown. Unclear dates are left empty for Firstmate to ask. |
| No name given ("create a new project")                               | No folder is made; the message goes to Firstmate, which asks.                                                        |
| "Create a landing page for Gitex"                                    | Not new work: stays in Gitex.                                                                                        |
| Amun-SDK really is part of Gitex                                     | Owner picks "Keep it here"; remembered (R6).                                                                         |
| The owner ignores the card and types something else                  | The new message is sent normally. The held one stays on its card until answered.                                     |
| The app closes while a card is open                                  | The held message and card are still there on reopening.                                                              |
| The folder is created but Firstmate is busy or down                  | Folder and chat stay; the message waits its turn as messages do today.                                               |
| Firstmate's suggestion is malformed                                  | Shown as ordinary text; nothing moves.                                                                               |
| Firstmate suggests a move while the owner has already left that chat | The card waits in that chat and under Needs your attention.                                                          |
| A message moved after crew work began                                | The work continues; the old chat's line links to the new one.                                                        |
| Text inside a message tries to instruct the routing                  | Amun's rules only read the first line for a fixed pattern, and a move always needs the owner's click.                |
| One message asks for two folders                                     | First version: Firstmate handles it in place and may suggest moves one at a time.                                    |

## Build order (smallest first)

1. Migration 44 and commands: General and main chats become ordinary chats; `new-chat`, `rename-chat`, `archive-chat`, `move-chat`; "kept here" names on a work area.
2. Extend `newWorkNamed`: "for <name>", priority, due date, existing-name check. Unit tests for every row above that needs no model.
3. Front end, each after its own approved preview: "New chat", rename and archive; the move card; the "Continued in …" line.
4. Firstmate's briefing: the folder list and the short form for suggesting a move; the card for it.
5. The silent recap after Firstmate's memory starts fresh.
6. Check with real Firstmate on the Mac (list B in the session notes).

## Not verified

- Whether Pi reports a memory reset in a form Amun can read (Paseo's Codex and OpenCode providers mention compaction; Pi's was not checked).
- Whether work areas store a priority today (a due date exists).
- How reliably Firstmate will use the short form for a move; needs a run with real Pi.
