# Amun packaged-app end-to-end test report, 22 November 2026

Tested by Claude Code through computer use on the installed Mac app, following `AMUN-WORK-INTAKE-AND-DELIVERY-CODING-HANDOFF.md` §2. Firstmate home: `/Users/tamersabry/Projects/firstmate` (the existing profile's home, kept on the owner's instruction). Model shown in the composer: GitHub Copilot · Claude Sonnet 5.5.

## 1. DMG build and installation receipt

| Item | Result |
| --- | --- |
| Supplied DMG `Amun-PR56-65fd8f8-arm64.dmg` | **Crashed at every launch.** dyld refused `Electron Framework` ("different Team IDs"): signed ad-hoc with hardened runtime on. Do not distribute it. |
| Fix | PR [tamer-sabry8/amun#57](https://github.com/tamer-sabry8/amun/pull/57): `npm run dist:mac:beta`, plus an after-sign check that fails ad-hoc builds with hardened runtime. |
| Rebuilt DMG | `~/Documents/ChatGPT/Amun/releases/Amun-0.16.1-adhocfix-65fd8f8-arm64.dmg`, SHA-256 `53789141ae723e81238120e665c821b25ffde68d1cba010e4b0ec34f4209a223`, build 155 s |
| Signature (as built, unmodified) | `flags=0x2(adhoc)`, `codesign --verify --deep --strict` OK, launches to Home |
| Installed `Amun.app` size | 538,400,948 bytes (sum of file sizes), **+667,396 bytes (+0.67 MB)** vs 537,733,552 baseline |
| Memory | 487 MiB (5 processes) ~20 s after launch; **671 MiB (7 processes) after ~1 h of the tests, over the 500 MiB budget** (Firstmate/Pi processes excluded) |
| Startup time | Not measured precisely (window-count probe lacked Accessibility permission). First window appeared within a few seconds. |
| Crashes after the fix | None |

## 2. Jira and Linear status

- Amun has **no Jira or Linear connection**. Settings › Tools lists Azure DevOps, Notion, GitHub and Obsidian only.
- `packages/server/src/server/amun/delivery-sync.ts` contains `LinearAdapter` and a Jira Cloud REST adapter that use env-var API keys. **Nothing imports them**; they have no screen, no RPC, and no epic or sprint creation.
- Firstmate handled the gap well in both tests: it said plainly that the tracker isn't connected, listed what it needs, and offered a CSV fallback. The crew produced a Jira-import CSV (Sales Prospects) and a Linear-ready CSV (Invoiced).
- Building the connection through the official hosted MCP servers (browser OAuth, Keychain storage, governed writes and read-back) is under way in a separate session, which will open its own PR. Screens will be shown for approval first.

## 3. Timing: Firstmate and crew (wall clock, Gulf time)

| Test | Step | Start | Finish | Duration |
| --- | --- | --- | --- | --- |
| 1 Sales Prospects | Folder created from Home | 16:03:20 | 16:03:23 | ≤3 s |
| 1 | Firstmate first reply (Pi cold start, dispatch PRD + Researcher) | 16:03:20 | 16:06:57 | **3 m 37 s** |
| 1 | "Don't interview me" message delivered to Firstmate (queued, no indicator) | 16:07:46 | 16:13:57 | **6 m 11 s** |
| 1 | Researcher: Sellbird review | ~16:07 | 16:09:36 | ~2 m 40 s |
| 1 | PRD v0.1 reverse-engineered | 16:14:05 | 16:17:19 | 3 m 14 s |
| 1 | Jira request → Firstmate answer | 16:19:08 | 16:20:16 | 1 m 08 s |
| 1 | Epics and stories + Jira CSV (10 epics, 32 stories) | 16:19:08 | 16:21:41 | 2 m 33 s |
| 2 Invoiced | Firstmate dispatch | 16:21:28 | 16:22:38 | 1 m 10 s |
| 2 | Researcher: billr review | 16:22:38 | 16:23:21 | 43 s |
| 2 | PRD: BRD v0.1 (written before the review landed) | 16:22:38 | 16:23:41 | 63 s |
| 2 | Rename + Linear request → answer | 16:27:28 | 16:28:10 | 42 s |
| 2 | Epics and stories + Linear CSV | 16:27:28 | 16:29:19 | 1 m 51 s |
| 3 Mira | Firstmate dispatch (started Product Marketing) | 16:27:37 | 16:35:29 | **7 m 52 s** |
| 3 | Research + competitive analysis | — | 16:36:14 | — |
| 3 | Pricing analysis and recommendation | — | 16:36:21 | — |
| 3 | Epics, stories, Sprint 1–2 plan | — | 16:36:36 | — |
| 3 | Wireframes (7 screens, LTR/RTL) | — | 16:39:54 | ~4 m 25 s after dispatch |
| 3 | Launch request → reply | 16:46:10 | 16:48:10 | 2 m |
| 3 | Launch simulation package (verdict: no-go) | 16:46:10 | 16:49:23 | 3 m 13 s |
| 4 | Six queued messages answered | 16:46:42–16:47:56 | 16:48:21–16:49:11 | 1.5–2.5 m each, not first-in-first-out |
| 4 | General question in a product chat | 16:49:05 (delivered) | 16:49:11 | 6 s |

Stalls: Firstmate cold start (~3.5 min); messages sent while Firstmate is mid-turn wait silently (up to 6 min); every screen switch costs a Firstmate turn (see B3).

## 4. Bugs, gaps and friction

### A. Bugs (wrong behaviour)

1. **Replies lost.** Firstmate answered, but Amun never showed or stored the answer, and the request stayed "sent". Affected: the Gitex Demo project creation (including its first interview question card), the Invoiced question asked in Gitex Demo, and the "Sales Prospect" near-duplicate warning. Earlier, the 16:08 discovery-question relay was also never shown.
2. **Replies filed in the wrong chat.** Firstmate's updates from background check-ins about Sales Prospects, Invoiced and Mira land in "Chat with Firstmate" (an Initiative), not in the product's own chat.
3. **Rename and client changes not applied.** Firstmate's `{"do":"rename"}` (Invoiced, Mira) and `{"do":"client"}` (Invoiced) were reported done to the captain, but the sidebar and Portfolio still show the old values.
4. **Intake name parsing:** "called Invoiced: a SaaS product…" becomes the name "Invoiced: a SaaS product", and "called Mira: …" becomes the whole sentence. The name pattern (`packages/domain/src/work/model.ts` ~315) doesn't stop at a colon.
5. **Intake client parsing:** "bill your clients from it" became `Client: s from it`. The client pattern (~677) lacks a word boundary after `client`.
6. **Stale request status.** `amun-r-67e623184e13` stays "needs-decision: question 1 still waiting on the captain" after the question was closed; Jira request `amun-r-4e94b431895f` stayed "sent" while Firstmate reported it working.
7. **Priority mismatch.** Portfolio shows Gitex Demo as "High priority", but Firstmate told the captain "Amun has no priority field I can set".
8. **"Open Sales Prospects" on the duplicate card** started a new empty chat and sent "Create a new product called Sales Prospects" to Firstmate, instead of opening the existing chat.

### B. Gaps (missing behaviour)

1. **No Jira or Linear connection** (see §2).
2. **Crew documents never reach Amun.** The PRD panel says "No PRD yet" after a PRD was written. The PRD, BRD, research, pricing, wireframes and collateral exist only as files in crew homes under `~/.treehouse/…`.
3. **Every screen switch sends Firstmate a request** ("Open agents. Show the selected view… Reply only with an acknowledgement", `packages/amun-ui/src/daemon/navigation.ts:69`). Each one is a Firstmate turn and delays your real messages.
4. **The Agents screen hides busy crew.** "Working" comes only from the last line of a crew status file (PRD showed idle while writing because its last line was `resolved`). Firstmate itself is never marked Working. Portfolio cards say "Nothing running" throughout.
5. **No way to mark stories done without a tracker.** The Stories tab only says "Link this product to Azure DevOps". Readiness stays "0/0 stories done", so there's no hand-off from "sprint stories are done" to "start launch activities". Firstmate confirmed: "you can't yet."
6. **The launch card doesn't enforce readiness:** you can approve and schedule at 0/0 stories, and steps 1–3 stay clickable after Verified live. There's no step for post-launch updates or collateral. Firstmate's simulation never updates the card (card actions do reach Firstmate as "Notes from Amun").
7. **Near-duplicates aren't caught:** "Sales Prospect" was created beside "Sales Prospects". Firstmate caught it, but that reply was lost (A1).
8. **Firstmate doesn't offer to move a drifting chat:** it answered an Invoiced question inside Gitex Demo without suggesting a move.
9. **Question cards don't reach "Needs your attention"**, which showed 0 with two open questions.
10. **The project checklist allows handover with zero tasks** ("All checklist tasks are complete").

### C. Friction

1. Chats are named from the raw first message ("Create a new Product ca…"), so two chats in one folder look the same.
2. A queued message has no "Queued" label in some cases (Sales Prospects, 16:07) but does in others.
3. Amun's charter relay reaches Firstmate as "The captain asks you to…", so Firstmate saved it to `data/captain.md:69` as your standing rule, and its acknowledgement appeared in a product chat you didn't ask in. **Kept on the owner's instruction.**
4. A Notion banner says "Notion MCP connected…" while Settings › Tools says Notion is "Not working".
5. Long text typed quickly into the launch-card fields lost characters ("Mira pi", "v1."). Short input was fine, so this may be an artifact of automated typing (unconfirmed).

### D. What worked well

- Explicit intake creates the right folder (Product, Project, Initiative) in about 3 seconds, and project intake captured client, high priority and due date (Gitex Demo).
- A new-work request inside another folder is held with a "Move to a new folder / Keep it here" card; nothing is sent until you choose.
- Exact duplicates prompt "Open / Create another / Keep it here".
- The no-interview instruction stayed limited to Sales Prospects and was honoured; the PRD followed the charter (why probes, one 5W+H problem statement, 20-topic checklist, reviewer section).
- The crew's research was useful and fast: Sellbird (AGPL-3.0, poor SaaS base), billr (Apache-2.0, Stripe), Chatwoot (MIT core plus a proprietary enterprise folder).
- Request references link each message to its exact reply ("Ready · View reply"); the "New replies" divider and unread dots work.
- Initiative → Project conversion works in place ("Was an Initiative"); the project checklist and handover receipt work.
- The launch card's manual path Scheduled → Deploying → Verified live works, and the receipt binds the exact version.

## 5. Test data left in Amun

Folders created by these tests: Sales Prospects, Sales Prospect (near-duplicate), Invoiced, Mira, Gitex Demo, Office Move Test. The Mira launch card is at Verified live (simulated). Crew files are in `~/.treehouse/firstmate-8bf1b0/*/firstmate/data/`. Nothing was published to any tracker or sent externally.
