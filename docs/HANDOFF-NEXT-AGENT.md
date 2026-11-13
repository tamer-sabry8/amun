# Amun · handoff for the next agent

13 November 2026, updated after pull request 22. Written for an agent that knows nothing about this project. Read this file, then `AGENTS.md` at the repository root, before changing anything. This is the only current handoff; the other `docs/*HANDOFF*.md` files are history, except the two memory documents named below.

## What Amun is

Amun is a Mac desktop app (Electron, TypeScript, React) for a product manager. The owner, Tamer, talks to one assistant called **Firstmate**. Firstmate keeps context, does the legwork through other agents and tools, and comes back with decisions and results. The owner approves plans; Amun then writes to the team's tools (Azure DevOps, Notion, GitHub).

Three outside projects are bundled and must stay on their own upstream update paths: **Pi** (the agent runtime and model sign-in, https://pi.dev), **Firstmate** (https://github.com/kunchenguid/firstmate) and **Roast Room** (the Council, https://github.com/nateherkai/roast-room). Amun-specific behaviour goes in Amun, never in those.

## Where things are

| What                    | Where                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| Repository              | https://github.com/tamer-sabry8/amun                                            |
| Branch to start from    | `main` (at `7cad71d` when this was written; CI green)                           |
| Open pull requests      | None                                                                            |
| Local checkout          | `/Users/tamersabry/Projects/amun`                                               |
| Worktree used so far    | `/Users/tamersabry/Projects/amun/.claude/worktrees/amun-workflow-wiring-e0ccc3` |
| Owner's rules           | `AGENTS.md` (read all of it)                                                    |
| Owner's original scope  | `/Users/tamersabry/Documents/ChatGPT/Amun/Amun-Claude-Code-workflow-handoff.md` |
| Earlier issue note      | `docs/6-issues.md`                                                              |
| Development app profile | `~/Library/Application Support/Amun-Workflow-Dev` (the owner is signed in here) |

Create a new branch from `main` and a new pull request for your work. Other agents may be working in other worktrees of this repository; do not touch their worktrees or branches.

## What landed on `main` on 13 November 2026

Every commit on `main` that day, grouped by the pull request that carried it. Use it to find where a behaviour came from; `git show <commit>` gives the detail.

| Pull request                         | What it delivered                                                                                                                                                                                                                                          | Commits                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 16 · UX rebuild                      | The rebuilt shell ("shell v3"), the product model (groups, work areas, plans, sprints, library), the Council integration, and in-process graphics with a crash fallback. See `docs/UX-REBUILD.md`.                                                         | `cff59e0`, `efec90c`, `e9874c0`                                             |
| 17 · Packaged memory margin          | Brought the packaged app under its 500 MiB budget and fixed an ambiguous button match in the app journey.                                                                                                                                                  | `1297fd1`, `b86e042`                                                        |
| 19 · Memory handoff and measurements | Documentation and evidence only: `docs/2026-11-13-PACKAGED-MEMORY-HANDOFF.md` and the combined-branch readings.                                                                                                                                            | `c46cf36`, `a2c6e35`                                                        |
| 18 · Workflow wiring                 | Approved plans publish to Azure DevOps and Notion; plan review with per-item destinations and partial approval; a message waits for a provider; attachments are read and filed.                                                                            | `99ce89d`, `5dc8518`, `9e3e34d`, `fab1dc7`, `d4fa9ea`, `f0dc5a4`, `549353a` |
| 20 · Setup sign-in fixes             | Fixed sign-in stuck on "Checking…", a lost check and the hidden device code; "Signed in" instead of "Connected"; "Employer" renamed "Work"; the simpler How you work step; the twenty agents with avatars.                                                 | `6b72b74`, `81e5d9f`, `8537aad`                                             |
| 21 · Tools, chat and sidebar         | Firstmate-only chat with the labelled layout; the model shown and selectable in the prompt box; Home fixes; tool detection and its screen; more Pi sign-ins; the downloads fly-out; the sidebar and Island redesign; the tool switch enforced at dispatch. | `101004b`, `231d35e`, `407d2e3`, `80e2b50`                                  |
| 22 · This handoff                    | Documentation only; also records that pull request 10 is closed.                                                                                                                                                                                           | `e179366`                                                                   |

Two migrations were added that day: 30 (`plan_writes`, in `99ce89d`) and 31 (`split_from`, in `fab1dc7`).

### Packaged memory: where it stands

The packaged app has a fixed budget of 500 MiB, summed across every process, at the first screen and on Home. Read `docs/2026-11-13-PACKAGED-MEMORY-HANDOFF.md` before touching `apps/desktop/src/main.ts` or `graphics-mode.ts`; it lists what must be preserved.

- **Last measurement:** Home 479 to 483 MiB, taken at `c46cf36`. That build had pull request 17 but **not** pull requests 18, 20 or 21.
- **Not measured since.** Pull requests 18, 20 and 21 added screens, twenty avatar images, a tool probe and a conversation that now opens shortly after launch to learn the model. Any of these could move the number. Nobody has packaged or measured current `main`.
- **Startup:** the first launch after signing took about 7.5 seconds against a 3-second gate. That gate is still open and is the owner's call.
- **How to measure:** `AMUN_BETA=1 pnpm package`, then `node scripts/rebuild-performance-proof.ts` and `node scripts/graphics-fallback-proof.ts`. Use disposable profiles only.

If your work adds to startup or memory, measure before and after and report the real numbers. Do not raise the budget or leave a process out of the sum.

## Your assignment

Build these four things, in this order:

1. **Fork** a conversation from a chosen message.
2. **The Sprints reader**: fill the existing Sprints screen from Azure DevOps.
3. **Agents acting on their scopes**: Firstmate delegates to the twenty agents using each one's brief.
4. **Animated icons** in the interface.

Details for each are below. Do not start anything else from the "Not built" list without asking.

## Rules the owner has set

These are the ones that have caused rework when missed. `AGENTS.md` has the full set.

1. **Show UI changes before building them when the look is not already decided.** Put the actual current screen beside the proposal, say which workflow it enables, and wait. The owner annotates in the browser. When the owner gives a direct instruction with a reference image, build it and show it in the running app instead.
2. **Run every UI change through the `/impeccable` skill.**
3. **Design preferences.** Keep existing screens as they are and add as little as possible. Reuse a pattern already on that screen before drawing anything new. Add nothing to the prompt box; the one exception is the model picker, which the owner asked for. Write messages and buttons in plain, friendly words, never technical ones. The owner rejected four designs in a row that added controls or technical wording.
4. **The owner talks only to Firstmate.** Never offer other agents as something to address directly. Firstmate decides who helps.
5. **Sign-ins are the owner's.** Never type credentials. Launch the development app and ask the owner to sign in.
6. **No Claude subscription sign-in through Pi.** A Claude subscription is used through the Claude Code tool on the Mac. A test enforces this.
7. **Live-test destinations.** Azure DevOps: project `TahalufCollection / POCs` only (https://devops.tahaluf.ae/TahalufCollection/POCs). Stories go to the `POCs Team` board, level `Backlog items`. Repository and wiki tests use the `tamer-test1` repository there. The read-only sprint check uses `POCs\2021-Q1\Sprint 5`. Notion: child pages under the page "test for Amun to use".
8. **Report honestly.** Say what you ran, what you did not, and what is unverified.
9. **Pull request 10 is closed by the owner's decision.** Do not reopen it, merge it, or bring it up.
10. **Merging.** The owner has been asking for merges to `main` once CI is green. Wait for CI on the final commit, resolve review comments from the automated Codex reviewer, then merge with a merge commit. Ask before the first merge of your session.

## How to run things

Use Node 24 (`~/.nvm/versions/node/v24.22.0/bin`).

```bash
pnpm check
```

```bash
pnpm build
```

```bash
pnpm exec playwright test tests/e2e/rebuild-shell.spec.ts tests/e2e/plan-review.spec.ts tests/e2e/attachments.spec.ts tests/e2e/m1-auth.spec.ts
```

A fresh worktree has no `apps/desktop/.runtime`, and the app stays on "Starting Amun…" until the runtimes are staged:

```bash
pnpm runtime:stage && pnpm firstmate:stage && pnpm council:stage && pnpm terminal:stage && pnpm database:stage && pnpm mcp:stage && pnpm auth:stage
```

Launch the development app on the owner's signed-in profile (run it in the background; build first):

```bash
AMUN_LEGACY_SHELL=0 pnpm --filter @amun/desktop exec electron . --user-data-dir="$HOME/Library/Application Support/Amun-Workflow-Dev"
```

To stop it before relaunching:

```bash
pkill -f "Electron . --user-data-dir=.*Amun-Workflow-Dev"
```

In a development run the menu bar says "Electron"; the packaged app says "Amun". That is expected.

App tests launch Electron with a temporary profile and `AMUN_LEGACY_SHELL=0`. To seed a profile without a model: create `<root>/workspace/workspace.sqlite`, run `migrate(db)`, drive `WorkStore.handle(...)`, close it and `chmod 600` the file. `tests/e2e/plan-review.spec.ts` is the pattern. Set `AMUN_REBUILD_SHOTS=<folder>` to save screenshots, and `AMUN_REBUILD_SCHEME=dark` for the dark theme the owner uses.

## Where the code lives

| Layer           | Files                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product rules   | `packages/domain/src/work/` (`model`, `flows`, `home`, `shell`, `planning`, `permissions`, `agents`)                                                                                        |
| Contract        | `packages/contracts/src/work.ts`, `auth.ts`, `native-pi.ts`                                                                                                                                 |
| Storage         | `packages/data/src/work-store.ts`, `migrations.ts` (31 migrations; append only, never edit one)                                                                                             |
| Service         | `apps/desktop/src/service.ts` plus `plan-targets.ts`, `tool-probe.ts`, `screenshot.ts`                                                                                                      |
| Interface       | `apps/renderer/src/rebuild/` (`app`, `chrome` = sidebar and Island, `composer`, `home`, `work-session`, `wizard`, `screens`, `settings`, `rail`, `firstmate`, `model-picker`, `tool-cards`) |
| Styles          | `apps/renderer/src/rebuild/rebuild.css`, tokens in `apps/renderer/src/tokens.css`                                                                                                           |
| Icons           | `apps/renderer/src/icons.tsx` (one path string per icon, drawn by `Icon`)                                                                                                                   |
| Azure DevOps    | `packages/connectors-ado/src/` (`board-discovery`, `governed-writes`, `transport`)                                                                                                          |
| Pi conversation | `apps/desktop/src/native-pi-worker.ts`, `packages/crew/src/native-pi.ts`                                                                                                                    |

Events from the service reach the interface only if they parse as a known schema in `apps/renderer/src/bridge.ts`; new result events go in the `workEvent` union in `packages/contracts/src/work.ts`.

## What works on `main` today

Verified in the development app unless noted.

- **Setup:** sign in to ChatGPT, GitHub Copilot or OpenRouter (the owner did all three); xAI, Kimi Code and Meta sign-ins and five more API keys are offered but unverified. Detected tools on the Mac are listed (Claude Code, Codex, Pi, GitHub Copilot CLI, tmux, Git were found). "How you work" has work types, groups (Work, Personal, Side business) and one line about tracking. Twenty agents with avatars, all selected.
- **Chat:** the owner's messages on the right, Firstmate labelled on the left. The model in use shows in the prompt box and opens a list to choose another (the owner verified this). `@` offers work areas only.
- **Home:** the sent message stays visible above the card asking about it; a message naming its group ("for work") is not asked again.
- **A message waits for a provider** when none is usable, and sends once after connection.
- **Approved plans publish** to Azure DevOps and Notion, with lookup before any resend. The review shows each item's destination and lets the owner approve only some items. Unit-tested with stand-ins; never run live.
- **Attachments:** PDF, Word, Excel, PowerPoint, CSV, Markdown, text and images are read and filed in the library; problems show as an amber card. Screenshot capture is wired but not exercised.
- **Sidebar and Island:** icon-tile navigation and Firstmate's card with state, steps and one action. The owner approved it.
- **Downloads panel** flies out for six seconds on a new download.

## The four things to build

### 1. Fork

**What the owner approved:** the conversation and its cards stay as they are. Each message gets a quiet icon row under it on hover or keyboard focus, with copy and "Fork from here". Tooltip: "Fork from here" / "Starts a new conversation from this point. This one stays as it is." There is no separate Resume button; the prompt box continues the chat at its end. Search keeps its current list and adds message rows; choosing one opens the chat at that message with the messages around it visible.

**Acceptance (from the owner's scope):** plan support for 10 Dubai testers. At "How many support staff?" answer "Two" and refine. Fork at the staffing question, answer "One" in the fork and develop it. Reopen each chat and continue each independently. The fork must not contain the "Two" answer or anything after it.

**What blocks it:**

- **An unanswered question for the owner:** where a forked chat lives so it can be reopened. Either as its own item under Your work (reuses existing screens), or as a second chat inside the same work (needs a chat switcher, which needs design approval). Ask before building.
- **A technical finding:** every work area shares one Firstmate conversation today. `apps/renderer/src/rebuild/firstmate.ts` keeps a single `session`. A fork that excludes later messages needs its own conversation. Pi already has session branching upstream: `apps/desktop/src/native-pi-worker.ts` routes `new`, `resume`, `fork`, `clone` and `tree` to `sessionActions`. Use that; do not build branching in Amun.

Messages are stored per work area in `work_messages` (`packages/data/src/work-store.ts`, command `message`). `packages/data/src/trajectory.ts` has an unused session store with `fork`; decide whether it helps or should be left alone.

### 2. Sprints reader

**What the owner approved:** the Sprints screen with **no visual change**. Two redesigns were rejected. Fill the existing rows, tabs and Stories view from the team's real sprint.

**Behaviour:**

- Per product, open the default team's current sprint. Show the same IDs and columns as Azure DevOps. Read-only.
- Team switch, set default and refresh go through the composer already on that screen as `/sprint team <name>`, `/sprint default` and `/sprint refresh`.
- Refresh on open, on team switch, every 15 minutes while visible, and on demand.
- A teammate's routine move to Done updates the board and Activity quietly. A required story moved out of its committed sprint raises the existing yellow flag line and an item under Needs your attention, names the affected commitment, and leaves the teammate's edit in place.
- Each completed story shows its latest verified deployment and a link to the record, or "Deployment unknown".

**Starting points:** `packages/connectors-ado/src/board-discovery.ts` (`teams`, `iterations`, `levels`, `columns`, `cards`), the board read in `apps/desktop/src/service.ts` (`backlog-read`), `apps/renderer/src/rebuild/screens.tsx` (Sprints, search for `planSprint`), and `save-sprint` / `external-change` / `work_sprints` in `packages/data/src/work-store.ts`.

**Live check:** `POCs\2021-Q1\Sprint 5`, team `POCs Team`. The owner must connect Azure DevOps in the development app first; it is not connected yet.

### 3. Agents acting on their scopes

**Where it stands:** `packages/domain/src/work/agents.ts` holds the twenty agents. Each has a name, a one-line summary, its scope, its outputs and its frameworks with links. Setup stores the chosen names. Nothing uses the scope, outputs or frameworks: Firstmate does not know what each agent is for.

**What to build:** when Firstmate delegates, it picks the agent whose scope fits, and that agent works from its brief (scope, outputs, frameworks). The result returns to the originating chat, and the Agents screen shows who is doing what. The owner never addresses an agent directly.

**Find out first:** how Firstmate and Pi define and dispatch sub-agents upstream (skills, agent definitions, the crew dispatch in `packages/crew/`). The briefs should be fed in through that mechanism, generated from the catalogue, so upstream stays untouched. Workers started by Amun are Claude Code and Codex (`dispatchFirstmate`, `sendDelivery` in `apps/desktop/src/service.ts`); a worker the owner turned off under "Tools already on this Mac" must never be started (`requireWorkerOn`).

**Acceptance idea:** ask Firstmate to "have QA check the booking flow". Firstmate assigns the QA agent without the owner naming it again, the Agents screen shows the assignment, and the findings arrive in the same chat.

### 4. Animated icons

**What the owner asked for:** use these as references for motion in the interface.

- https://github.com/shadcn-ui/ui/discussions/10590
- https://github.com/fridayowl/exode-animated-icons
- https://github.com/a2rp/framer-motion-demos
- https://lucide-animated.com/

**Where it stands:** not started. Icons are static paths in `apps/renderer/src/icons.tsx`. There is no animation library in the app.

**Constraints:** check each library's licence before using it. The packaged app has a 500 MiB memory budget that is already at its limit, so prefer CSS or small hand-written motion over a large dependency, and measure if you add one. Respect `prefers-reduced-motion`. Follow `/impeccable`: one purposeful moment rather than motion everywhere. Good candidates are the sidebar tiles on hover and when selected, the Island when something new arrives, and the send button. Show the owner before building, since this is a look-and-feel change with no agreed design.

**Other design references the owner supplied:**

- Sidebar and Island targets: `/Users/tamersabry/Downloads/Gemini_Generated_Image_9xmqyu9xmqyu9xmq.jpeg`, `/Users/tamersabry/Desktop/Screenshot 2026-11-04 at 10.29.23 AM.png`, and two files in `/Users/tamersabry/Downloads/screens for Amun/` (`Screenshot 2026-11-04 at 10.29.48 AM.png`, `Screenshot 2026-11-04 at 10.30.17 AM.png`). The current sidebar was built from these and approved.
- Agent avatars: https://github.com/smnandre/animoon (CC0). Seventeen pictures for twenty agents, so wolf, koala and giraffe are used twice, mirrored. They live in `apps/desktop/renderer/avatars/`.
- Tool detection inspiration: https://github.com/generalaction/emdash

## Not verified

- Nothing has been run live against Azure DevOps or Notion: no story created, no page created, no sprint read.
- A real conversation turn with Firstmate inside the rebuilt app ("Our pilot is in Dubai" then "Where is our pilot?").
- Sign-ins for xAI, Kimi Code and Meta.
- Screenshot capture, and an image actually reaching a model.
- The packaged app's 500 MiB memory check on current `main`. The last reading (479 to 483 MiB on Home) predates pull requests 18, 20 and 21.
- Development performance and memory measurements the owner's scope asks for.

## Not built (do not start without asking)

Council room and one Quick Council; product memory in Notion; composer sources from GitHub, Azure DevOps and Notion; Replay; task checkout; plugin suggestions; preview and element feedback; the operational dashboard; Creator mode; ports and worktrees; the Git canvas and pull-request flow. Each has data code under `packages/data/src/` with unit tests and nothing connecting it to the service or the interface.

## Things that will trip you up

- **Migrations are append-only and checksummed.** There are 31. Add yours as 32 and never edit an earlier one.
- **A plan's Azure DevOps project** comes from the product's mapped Azure source, falling back to the workspace setting `work.ado.project`. A work area with no product has no way to choose one yet.
- **A Notion search miss under a page parent is treated as uncertain,** not absent, so a Notion page is never resent on a miss.
- **Model sign-in status:** a stored sign-in that passes its check shows as "Signed in". "Connected" is reserved for a provider that has actually replied. An automated reviewer insisted on this; do not promote one to the other.
- **The automated Codex reviewer** comments on every pull request marked ready. Its findings have been right more often than not. Fix them or reply with the reason, then resolve the thread.
- **Browser sign-in pages are allow-listed** per provider in `packages/auth/src/pi-auth.ts`. A new provider needs its host added there or sign-in fails closed.
- **Tool detection cannot tell whether a tool is signed in.** It runs only each tool's version command, on purpose.
- **A waiting message is never dropped.** It stays saved until Firstmate has answered, and one attempt runs at a time per work area (`inFlight` in `apps/renderer/src/rebuild/firstmate.ts`). CI caught an earlier version losing it.
- **The app opens a Firstmate conversation about a second after launch** to learn the model for the prompt box (`prime` in `firstmate.ts`). Keep that in mind for startup and memory.
- **Hooks must sit above early returns** in `apps/renderer/src/rebuild/app.tsx`. A hook placed after the setup check blanks the app when setup finishes.
- **CI takes about 16 to 20 minutes** and runs the full app-test suite on macOS.

## First steps

1. Read `AGENTS.md`.
2. Create a branch from `main` and stage the runtimes if your worktree is fresh.
3. Run `pnpm check` and the four app journeys to confirm a green start.
4. Ask the owner the Fork question (where a forked chat lives).
5. Ask the owner to connect Azure DevOps in the development app, so the Sprints reader can be checked against Sprint 5.
6. Start with whichever of Fork or the Sprints reader is unblocked first.
