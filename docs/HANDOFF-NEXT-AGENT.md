# Amun · handoff for the next agent

13 November 2026, updated after pull request 24. Written for an agent that knows nothing about this project. Read this file, then `AGENTS.md` at the repository root, before changing anything. This is the only current handoff; the other `docs/*HANDOFF*.md` files are history, except the two memory documents named below.

## What Amun is

Amun is a Mac desktop app (Electron, TypeScript, React) for a product manager. The owner, Tamer, talks to one assistant called **Firstmate**. Firstmate keeps context, does the legwork through other agents and tools, and comes back with decisions and results. The owner approves plans; Amun then writes to the team's tools (Azure DevOps, Notion, GitHub).

Three outside projects are bundled and must stay on their own upstream update paths: **Pi** (the agent runtime and model sign-in, https://pi.dev), **Firstmate** (https://github.com/kunchenguid/firstmate) and **Roast Room** (the Council, https://github.com/nateherkai/roast-room). Amun-specific behaviour goes in Amun, never in those.

## Where things are

| What                    | Where                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Repository              | https://github.com/tamer-sabry8/amun                                                                               |
| Branch to start from    | `main` (at `52c7a38` when this was written)                                                                        |
| Open pull requests      | None                                                                                                               |
| Local checkout          | `/Users/tamersabry/Projects/amun`                                                                                  |
| Worktrees used so far   | `amun-workflow-wiring-e0ccc3` and `amun-mac-app-3e38e7` under `/Users/tamersabry/Projects/amun/.claude/worktrees/` |
| Owner's rules           | `AGENTS.md` (read all of it)                                                                                       |
| Owner's original scope  | `/Users/tamersabry/Documents/ChatGPT/Amun/Amun-Claude-Code-workflow-handoff.md`                                    |
| Earlier issue note      | `docs/6-issues.md`                                                                                                 |
| Development app profile | `~/Library/Application Support/Amun-Workflow-Dev` (the owner is signed in here)                                    |

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
| 23 · Handoff history                 | Documentation only: this table and the packaged memory status.                                                                                                                                                                                             | `d7065f4`                                                                   |
| 24 · Logo, motion, Agents, Council   | The ram logo and Dock icon; the motion the owner approved item by item; the Agents screen as "Working now" and "Ready"; the Council room scaled to fit, and the embedded browser view kept inside its panel.                                               | `1124133`, `e34a76b`                                                        |

Two migrations were added that day: 30 (`plan_writes`, in `99ce89d`) and 31 (`split_from`, in `fab1dc7`).

### Packaged memory: where it stands

The packaged app has a fixed budget of 500 MiB, summed across every process, at the first screen and on Home. **`main` is over that budget on Home today.** Read `docs/2026-11-13-PACKAGED-MEMORY-HANDOFF.md` before touching `apps/desktop/src/main.ts` or `graphics-mode.ts`; it lists what must be preserved.

Measured on 13 November 2026 on one Apple-chip Mac, disposable profiles, three launches per run:

| Build                                                                  | Launches                 | First screen (MiB) | Home (MiB) |
| ---------------------------------------------------------------------- | ------------------------ | ------------------ | ---------- |
| `c46cf36` (pull request 17 only; as recorded earlier, not re-measured) | see `docs/evidence/T056` | not recorded here  | 479 to 483 |
| `7cad71d` (after pull requests 18, 20, 21)                             | 9                        | 454 to 470         | 496 to 508 |
| `1124133` (pull request 24)                                            | 9                        | 463 to 469         | 509 to 517 |
| `1124133` with every animation off                                     | 3                        | 462 to 468         | 500 to 501 |
| `1124133` with entrance animations off                                 | 6                        | 453 to 462         | 484 to 497 |

- **Pull requests 18, 20 and 21 added about 20 MiB on Home.** Nobody has found which parts.
- **Pull request 24 adds about 10 MiB on Home.** The cost is the entrance animations together (the screen easing in, staggered lists, Firstmate's card settling, ticks drawing, the reply reveal). No single one accounts for more than about 2 MiB. Loops, the pulse and the static styles cost nothing measurable.
- **The owner saw these numbers and chose to keep the entrance animations.** Do not remove them to recover memory without asking.
- **Repeat packagings vary by a few MiB.** Treat a difference under 5 MiB as noise unless it repeats.
- **Startup:** the first launch after packaging took 6.0 to 6.6 seconds against a 3-second gate; later launches 0.4 to 0.5 seconds. That gate is still open and is the owner's call.
- **How to measure:** `AMUN_BETA=1 pnpm package`, then `node scripts/rebuild-performance-proof.ts` and `node scripts/graphics-fallback-proof.ts`. Use disposable profiles only. Stop the development app first: packaging rewrites the files it runs from. To compare variants quickly once the runtimes are staged, `pnpm tokens:build && AMUN_BETA=1 pnpm --filter @amun/desktop package` is enough.

If your work adds to startup or memory, measure before and after and report the real numbers. Do not raise the budget or leave a process out of the sum. Bringing Home back under 500 MiB is open work that the owner has not yet asked for.

## Your assignment

Three things remain, in this order:

1. **Fork** a conversation from a chosen message.
2. **The Sprints reader**: fill the existing Sprints screen from Azure DevOps. Parked until the owner connects Azure DevOps.
3. **Agents acting on their scopes**: Firstmate delegates to the twenty agents using each one's brief.

Animated icons, the fourth item, landed in pull request 24. Details are below. Do not start anything else from the "Not built" list without asking.

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
- **Downloads panel** flies out for six seconds on a new download, with a line that counts the time down.
- **Logo:** the ram in the sidebar, coloured by the theme. A Dock icon is wired into packaging; nobody has looked at it in a packaged build.
- **Firstmate's face:** two eyes on its amber tile, with four moods (`apps/renderer/src/rebuild/firstmate-mark.tsx`).
- **Motion:** everything in `apps/renderer/src/rebuild/motion.css`, each block named after the review item the owner approved. Checked from still captures and for errors; nobody has watched each one play.
- **Agents screen:** Firstmate on top, "Working now" cards, then a compact "Ready" list of everyone else at any depth. "Working now" has never been seen with a real busy agent.
- **Council screen:** the Roast Room exactly as upstream built it, scaled to fit, with no address bar. Its position was verified by the bounds Amun sends, not by eye.

## The three things to build, and the one that landed

### 1. Fork

**What the owner approved:** the conversation and its cards stay as they are. Each message gets a quiet icon row under it on hover or keyboard focus, with copy and "Fork from here". Tooltip: "Fork from here" / "Starts a new conversation from this point. This one stays as it is." There is no separate Resume button; the prompt box continues the chat at its end. Search keeps its current list and adds message rows; choosing one opens the chat at that message with the messages around it visible.

**Acceptance (from the owner's scope):** plan support for 10 Dubai testers. At "How many support staff?" answer "Two" and refine. Fork at the staffing question, answer "One" in the fork and develop it. Reopen each chat and continue each independently. The fork must not contain the "Two" answer or anything after it.

**What blocks it:**

- **The owner's answer (13 November 2026):** a fork is a second chat inside the same work, not a new item under Your work.
- **There is no such level today.** The hierarchy is Group, then Work, then one conversation. The owner asked for it to be built: a work holds one or more chats; the first is the main chat and each fork remembers the message it came from; each chat has its own Firstmate conversation; Search finds messages across chats and opens the right one.
- **The chat switcher needs the owner's approval before it is built.** Show options for it first.
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

**Live check:** `POCs\2021-Q1\Sprint 5`, team `POCs Team`. The owner must connect Azure DevOps in the development app first; it is not connected, and on 13 November 2026 the owner said to do this later.

### 3. Agents acting on their scopes

**Where it stands:** `packages/domain/src/work/agents.ts` holds the twenty agents. Each has a name, a one-line summary, its scope, its outputs and its frameworks with links. Setup stores the chosen names. Nothing uses the scope, outputs or frameworks: Firstmate does not know what each agent is for.

**What to build:** when Firstmate delegates, it picks the agent whose scope fits, and that agent works from its brief (scope, outputs, frameworks). The result returns to the originating chat, and the Agents screen shows who is doing what. The owner never addresses an agent directly.

**Find out first:** how Firstmate and Pi define and dispatch sub-agents upstream (skills, agent definitions, the crew dispatch in `packages/crew/`). The briefs should be fed in through that mechanism, generated from the catalogue, so upstream stays untouched. Workers started by Amun are Claude Code and Codex (`dispatchFirstmate`, `sendDelivery` in `apps/desktop/src/service.ts`); a worker the owner turned off under "Tools already on this Mac" must never be started (`requireWorkerOn`).

**Acceptance idea:** ask Firstmate to "have QA check the booking flow". Firstmate assigns the QA agent without the owner naming it again, the Agents screen shows the assignment, and the findings arrive in the same chat.

### 4. Animated icons and motion (landed in pull request 24)

The owner reviewed sixteen items side by side and approved them one at a time. All of it is hand-written CSS on existing elements; no library was added, so no licence was taken on.

**Decisions the owner made that are easy to undo by accident:**

- The ram sits on its own in the sidebar, without a tile. The Dock icon is the black one.
- Cards lift at 1.06 times. Sprint story tiles are deliberately left out so the Sprints screen has no visual change.
- The pulse plays three beats and stops.
- The entrance animations stay, although they cost about 10 MiB on Home.
- The Agents screen is "Working now" first, then everyone else.
- The Council room keeps the original's look, portraits included. The owner rejected three options that changed it and asked only that it fit the screen.

**Not built from that review:**

- Item 12, agent cards that flip. The agent's brief is shown in its panel instead; the owner has not said whether a flip is still wanted.
- Item 15 reveals the whole newest reply top to bottom, not word by word.
- The WebGL shader zoom, the gooey filter and new parts in the prompt box were left out on purpose, for memory and because the owner wants nothing added to the prompt box.

**Offered and not answered:** the `@` button does nothing on the Council screen because no work areas are passed to that prompt box. Hiding it where it has nothing to offer was suggested; the owner has not replied.

**Design references the owner supplied:**

- Sidebar and Island targets: `/Users/tamersabry/Downloads/Gemini_Generated_Image_9xmqyu9xmqyu9xmq.jpeg`, `/Users/tamersabry/Desktop/Screenshot 2026-11-04 at 10.29.23 AM.png`, and two files in `/Users/tamersabry/Downloads/screens for Amun/` (`Screenshot 2026-11-04 at 10.29.48 AM.png`, `Screenshot 2026-11-04 at 10.30.17 AM.png`).
- Logo sources: `/Users/tamersabry/Downloads/Gemini_Generated_Image_ysyxnxysyxnxysyx.jpeg` (black) and `Gemini_Generated_Image_tzkux8tzkux8tzku.jpeg` (white). The cut-outs are `apps/desktop/renderer/brand/ram.png` and `apps/desktop/assets/icon.icns`.
- Agent avatars: https://github.com/smnandre/animoon (CC0). Seventeen pictures for twenty agents, so wolf, koala and giraffe are used twice, mirrored. They live in `apps/desktop/renderer/avatars/`.
- Motion references: https://lucide-animated.com/, https://smoothui.dev/ (the owner likes the orb face and the fluid notch), https://github.com/codse/animata.
- Tool detection inspiration: https://github.com/generalaction/emdash

## Not verified

- Nothing has been run live against Azure DevOps or Notion: no story created, no page created, no sprint read.
- A real conversation turn with Firstmate inside the rebuilt app ("Our pilot is in Dubai" then "Where is our pilot?").
- Sign-ins for xAI, Kimi Code and Meta.
- Screenshot capture, and an image actually reaching a model.
- CI on `main` after pull requests 23 and 24 were both merged. Each passed on its own; 23 is documentation only.
- The Dock icon in a packaged build, and each animation actually playing.
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
- **CI takes about 16 to 20 minutes** and runs the full app-test suite on macOS. The app's pull request watcher reports failures and review comments but not a pass.
- **Auto-merge is not allowed on this repository.** Merge by hand with a merge commit once CI is green.
- **The embedded browser view is a native layer above the whole interface.** It must be told where to sit (`apps/renderer/src/rebuild/browser-bounds.ts`). A position that leaves the window is refused by the app, which then draws the view across the full window; that was the Council bug. Anything Amun draws over the panel has to be listed in `coverSelector` or the view will cover it.
- **The owner's development app is set to the "Amun dark" theme.** It was on "Match macOS", which showed the light theme on a Mac in light mode and confused a review. Test screenshots use the dark theme with `AMUN_REBUILD_SCHEME=dark`.
- **The accessibility scan waits for entrance animations** under one second before judging contrast (`tests/e2e/rebuild-shell.spec.ts`). A new fade longer than that will be read mid-fade and fail.
- **The owner reviews designs in Lavish** (`lavish-axi <file>`, then `lavish-axi poll <file>` as a tracked background job). Sketches must use the real pictures: initials in place of the Council portraits made the owner reject all three options.
- **The review pages from 13 November 2026 are not in the repository.** They sit untracked under `docs/preview/2026-11-13-*` in the `amun-mac-app-3e38e7` worktree and are ignored by Prettier.

## First steps

1. Read `AGENTS.md`.
2. Create a branch from `main` and stage the runtimes if your worktree is fresh.
3. Run `pnpm check` and the four app journeys to confirm a green start.
4. For Fork, show the owner options for switching between the chats inside a work, and wait for approval before building it.
5. Leave the Sprints reader until the owner connects Azure DevOps.
6. Agents acting on their scopes needs no sign-in and no new screen, so it can proceed alongside the Fork design review.
