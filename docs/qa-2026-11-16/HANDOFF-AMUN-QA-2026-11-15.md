# Amun QA and fixes — handoff (2026-11-15, 08:55 Dubai)

> **Latest state (15 Nov 14:52 Dubai): read `SESSION-STATE-2026-11-15.md` in this folder first.** It lists the owner decisions, what is done, what is verified, and the remaining work in order.


Written for an AI session that knows nothing about Amun. Read it fully before acting.

## 1. What Amun is

Amun is a macOS desktop app (Electron, React renderer, TypeScript, SQLite) for product delivery. The owner is Tamer Sabry, a product and delivery lead at Tahaluf.

A lead agent called **Firstmate** works in a chat. It delegates to specialist agents ("crew"), such as the Product Manager, UX, Research & Insights and Product Marketing.

Its main areas:
- **Work areas:** Products, Projects, Tasks and RFPs, each with its own conversation.
- **Library:** documents such as PRDs and notes.
- **Roadmap, Sprints and Portfolio.**
- **RFP board:** Received → In response → Submitted → Won → Handed to delivery.
- **Plans with approval:** publishing to Azure DevOps or Notion only happens after an explicit review and approval.

**AI rule (from the owner):** every AI call goes through **GitHub Copilot**. Amun uses the bundled "Pi" harness with provider `github-copilot`, default model Claude Sonnet 5.5. The Claude Code and Codex CLI integrations stay **off**. There is no silent fallback.

**Code changes** are made with the **GitHub Copilot CLI** (`~/.local/bin/copilot -C <repo> -p "<prompt>" --allow-all-tools`), then reviewed by you.

## 2. Where everything is

| Item | Location |
|---|---|
| GitHub repo | https://github.com/tamer-sabry8/amun |
| Main checkout (do not change its branch) | `/Users/tamersabry/Projects/amun` |
| Fix worktree used for this work | `/Users/tamersabry/Documents/ChatGPT/Amun/azure-qa-20261114` (branch `fix/azure-connection-qa-20261114`) |
| Installed app under test | `/Applications/Amun.app` (bundle id `ai.amun.desktop`; Computer use may list it as "Amun-before-copilot", which is the same id) |
| Built DMGs + checksums | `/Users/tamersabry/Documents/ChatGPT/Amun/releases/Amun-0.1.0-beta-arm64-<commit>.dmg` (+ `.dmg.json` with SHA-256) |
| Rollback copies of earlier installs | `/Users/tamersabry/Documents/ChatGPT/Amun/releases/installed-rollback/Amun-<commit>.app` |
| QA report (45 journeys) source folder | `/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/qa-20261114/` |
| Report HTML (annotatable in Lavish) | `/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/qa-20261114/all-journeys.html` |
| Live Lavish review session for that report | http://127.0.0.1:4387/session/2d82357e2b182104 (local only) |
| Portable copy of the report | `/Users/tamersabry/Documents/ChatGPT/Amun/Amun-QA-Journeys.html` |
| Report evidence overlays | `.lavish/qa-20261114/logs/updates-*.json` (newest is `updates-20261115-0850.json`) |
| Screenshots | `.lavish/qa-20261114/screenshots/` |
| Project rules for agents | `AGENTS.md` and `CLAUDE.md` in the repo root (read both) |
| Approved UI preview for the Viewing change | `/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/iss025-preview/index.html` |
| Notes from parallel sessions | `/Users/tamersabry/ClaudePersonal/side-session-notes/local_ed4ca155-0c62-47c3-8a5a-facddd82d59e/` |

## 3. How to build, install and run

All commands run on Node 24 from `~/.nvm/versions/node/v24.22.0/bin`, inside the fix worktree.

```bash
cd /Users/tamersabry/Documents/ChatGPT/Amun/azure-qa-20261114
export PATH=~/.nvm/versions/node/v24.22.0/bin:$PATH
pnpm check                        # eslint, tsc, prettier, vitest (must be all green)
pnpm exec vitest run --coverage   # what CI runs; enforces per-file coverage thresholds
pnpm beta:mac                     # packages and writes ../releases/Amun-0.1.0-beta-arm64-<HEAD>.dmg (needs a clean tree)
```

If `packages/crew/tests/firstmate-worktree.test.ts` fails only with `safe.bareRepository`, that comes from the sandbox's git config. Rerun with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.bareRepository GIT_CONFIG_VALUE_0=all`.

**Installing a built DMG** follows the same steps every time:
1. Verify: `shasum -a 256` matches the `.dmg.json`, and `hdiutil verify` reports VALID.
2. Quit Amun: `osascript -e 'tell application id "ai.amun.desktop" to quit'`.
3. Keep a rollback: `ditto /Applications/Amun.app releases/installed-rollback/Amun-<old>.app`.
4. Mount the DMG read-only and copy the app in: `ditto "<mount>/Amun.app" /Applications/Amun.app`.
5. Check the signature: `codesign --verify --deep --strict`.
6. Start it: `open -a /Applications/Amun.app`.

The build is **ad-hoc signed** for trusted testers. It is not notarized; never claim Apple verification.

## 4. Rules you must follow

**Testing method**
- Test in the **installed app's GUI with Computer use**. Load the tools with ToolSearch query `computer-use`, then `request_access` for `ai.amun.desktop`.
- If the owner's screen is a full-screen Space, use `request_full_control`, then `open_application` and `app_menu Window>Zoom`.
- Screenshot before and after each action, and after typing but before sending.
- Never test through Amun's code, database or APIs.
- Never access `~/Library/Application Support/Amun` or profile backups. Never give Copilot access to them.

**External writes**
- Allowed only to **Azure DevOps** `TahalufCollection/POCs` (https://devops.tahaluf.ae/TahalufCollection/, owner signed in via Microsoft Edge) and the **Notion** page "test for Amun to use" (id `4173581de3a980eaae45d78ca230f0a3`).
- Exactly three historical QA records exist: Azure items 1091009 and 1091010, and Notion page `QA-20261114-Copilot-Notion-Smoke`. Do not recreate them.
- Never approve old pending reviews blindly.
- **A pending story review exists in `QA-20261115-Invites` ("Revised: title only", destination POCs). Do not approve it unless the owner says so.**

**Approvals and changes**
- **Every UI change needs owner approval first.** Show the current screen beside the proposal in an annotatable preview, run it through the `/impeccable` skill, and wait for approval. Approving a workflow is not approving its visual design.
- **No GitHub merges.** Commits and pushes to the fix branch are fine for fixes the owner asked for. Ask before committing anything else.
- Do not type tokens or passwords anywhere.
- Do not use `git stash` (the stash is shared across worktrees).
- Do not switch branches in other worktrees.

**Reporting**
- After each meaningful result, add `logs/updates-<YYYYMMDD-HHMM>.json` (same schema as the existing overlays).
- Then run `python3 render_reports.py` in `.lavish/qa-20261114/` and copy `all-journeys.html` to `Amun-QA-Journeys.html`.

## 5. Pull requests and branches

**PR #30 (OPEN, not merged)**
- Link: https://github.com/tamer-sabry8/amun/pull/30, "R1 beta QA fixes: honest plan reviews, RFP facts, per-area context, formatted Viewing".
- Branch `fix/azure-connection-qa-20261114` → `main`. It is 18 commits ahead of main, from 2f1a5ac to d311ff8.
- Mergeable. The last CI run was pending; an earlier `unit` coverage failure was fixed in 6660dff.
- Codex review: three findings, fixed in 7cb7104, with threads replied to and resolved.
- **Keep it unmerged.** The owner merges.

Commit history on the branch, oldest first:

| Commit | What it does |
|---|---|
| 2f1a5ac / 70c17f7 / 24a9f23 / 4900639 / 8b0a726 / 676f466 / 1703513 / 46eed70 | Earlier QA fixes (14 Nov): Copilot routing, bounded document context, Azure backlog setup and selection persistence, crew draft recovery, reviewed publication fields, graphics preference, RFP board record. |
| 7a28319 | Service refuses RFP *response* drafting (tracking is still allowed). |
| 7255824 | Take only the stated name when creating work from a message. |
| a457a53 | Test timeout room. |
| 5cf4636 | "Changes requested" label (not "Approved"); refuse Notion update/re-sync plans; refuse external plans called "local"; parse RFP client, deadline and owners; per-area Firstmate context. |
| 9ea0d95 | Show plan refusals in the conversation; RFP owners in Firstmate's record block. |
| 90728a8 / 7de82f7 | **Owner-approved UI:** Viewing renders Markdown (headings, tables, tickable checklists); Table tool starts on a new line. |
| 6660dff | Coverage test for the Pi harness mapping. |
| 7cb7104 | Newest Firstmate reply read separately (no repeated actions); Pi trust prompt and timeout are not "ready"; accepted offer for the open area is sent. |
| d311ff8 | Firstmate follow-through: Request changes and answer cards reach Firstmate; Won RFP names prerequisites; legacy RFPs get board records; unlinked reading notes; cross-group approval offer; sources in updates; stated length passed to delegates. |

**Installed now (11:05 Dubai):** 91067be. DMG SHA-256 `1e937caf3260a0518030540b4e2913c572f6f891e4315a75f72c12f7e40d2789`, hdiutil VALID, codesign OK. Rollbacks are in `releases/installed-rollback/` (be9fef3, d311ff8, …). PR #30 head is 91067be, pushed and not yet merged.

**Other remote branches:** older milestone, feature and handoff branches. PRs #23–#29 are merged.

Other local Claude sessions may have unpushed branches (for example `claude/cli-connector-discovery`). Do not touch them.

## 6. QA status (45 journeys)

19 passed (one by an adapted path), 16 tested with some criteria unmet, 6 absent from the default shell, 4 blocked on the owner. The detail per journey is in the report.

**Absent in the default shell.** These need owner UI approval before anything is built:
- UC09: memory search, correct and delete.
- UC24: board search, filter and drag.
- UC29: PR review.
- UC30: acceptance checklist.
- UC36: reminders.
- UC42: skill install.

**Blocked on the owner:**
- UC22: repeat-publish duplicate test to Azure DevOps.
- UC23: Azure DevOps sub-task write.
- UC28: GitHub branch and PR for a coding worker.
- UC45: turning Wi-Fi off during a sync (log export is also absent).

**Remaining partial journeys, and what blocks them:**
- **Need a new UI or feature (owner approval):**
  - UC04: client field on projects.
  - UC06: delete wording about external records.
  - UC10: recording a permission grant.
  - UC12: version history (ISS-026).
  - UC13: approval and version state on documents.
  - UC15: objective tracker linked to several areas.
  - UC19: render the prototype in the Browser panel.
  - UC20: re-approval state.
  - UC25 and UC26: stories in a sprint, assignees, commit.
  - UC32: blocker owner and age.
  - UC41: model label on each reply.
  - UC33: clickable source links.
  - UC35: Notion page update and conflict detection.
- **Output quality:** UC11, the PRD is longer than requested (ISS-029). A stated-length fix shipped in d311ff8 but is not retested.
- **UC27:** after "accept the risk" nothing was confirmed. The answer-card follow-through fix shipped in d311ff8 but is not retested on this exact card.

**Open issues:**
- ISS-026: no version history.
- ISS-028 and ISS-038: menus that don't close with Escape.
- ISS-029: PRD length.
- ISS-033: a reminder request is treated as new work.
- ISS-034: title-only search.
- ISS-037: skills path missing.
- ISS-040: review panel squashes the chat (looked fixed on later builds; re-check).
- ISS-041: a reply lost when navigating away mid-turn.
- ISS-005: model display shows "Auto" after relaunch in product composers.

## 7. Fixes to verify with Computer use (expected results)

Use synthetic QA names (prefix `QA-2026…`). Retest each item in the installed app.

| # | Fix (commit) | How to test | Expected result |
|---|---|---|---|
| 1 | Review label (5cf4636) | Any product → ask Firstmate to "Propose one user story … do not publish until I approve" → Review changes → Request changes | Header reads "To Azure DevOps · 1 item · Changes requested · nothing was published". Nothing is published. |
| 2 | Request-changes follow-through (d311ff8) | Same as #1 | Firstmate gets a turn, asks what to change, and after an instruction brings back a **revised** proposal (verified 08:45). |
| 3 | Notion update refusal (5cf4636, 9ea0d95) | Ask to "re-sync the existing Notion page QA-20261114-Copilot-Notion-Smoke … update that page" | No plan card. The line "Amun can only create new Notion pages; updating an existing page is not supported yet." appears. On the next turn Firstmate corrects itself. Read-only check that Notion has no new page. |
| 4 | Local-plan honesty (5cf4636) | Sprints → work area → "Add two local QA stories to the draft sprint … keep it local" | Firstmate says adding stories to a local draft sprint isn't available yet. No Notion or Azure plan is created. "Do not publish until I approve" still creates a normal plan. |
| 5 | RFP facts (5cf4636) | Home: "Track a new RFP called QA-… for client QA Test Client, due <date>. RFP owner is Sara; pre-sales Omar; the response owner is not known yet." → Work → New RFP | The card shows the client, the deadline ("Due in N days"), Sales or account owner Sara, Pre-sales Omar, and Response owner empty and flagged. |
| 6 | Per-area context (5cf4636) | In another RFP's conversation ask "What client, deadline and stage does this record hold?" | Only that record's values, with nothing from other RFPs. |
| 7 | RFP owners known to Firstmate (9ea0d95) | Ask "Who are the account owner, pre-sales and response owner?" | Sara, Omar, not set. |
| 8 | Viewing renders Markdown (90728a8, 7de82f7) | Library or document → mode menu → Viewing | The formatted document fills the pane: tables, headings, and checkboxes inline with their text. Ticking a box writes `- [x]` in Editing. Editing and the toolbar are unchanged. |
| 9 | Table tool (90728a8) | Editing → caret after text → Table | The table starts after a blank line and renders in Viewing. |
| 10 | No repeated actions (7cb7104) | Long conversation; check Firstmate doesn't redo an earlier delegation or plan | Only the newest reply's actions run. A unit test covers the reported 150k/50k/200k/50k case. |
| 11 | Pi trust / timeout (7cb7104) | Hard to trigger in the GUI. Observe delegation to a new worker | The job is not delivered while a worker shows its trust screen. A timeout says "The worker did not reach its prompt in time." |
| 12 | Offer for the open area (7cb7104) | Accept a Home or Island offer for the conversation that is already open | The draft request is sent at once, without leaving and returning. |
| 13 | Answer cards reach Firstmate (d311ff8) | Answer any Firstmate question card | Firstmate replies and acts on the choice (verified 08:42). **Still to retest:** "Yes, draft PRD v1.1 …" (UC13) gives a v1.1 draft; "Add it and accept the risk" (UC27) gets a confirmation. |
| 14 | Won RFP hand-off (d311ff8) | Won RFP with prerequisites unticked: "Create the delivery project now." | Firstmate refuses, lists Proposal signed and BRD approved as no, and points to Hand to delivery (verified). |
| 15 | Legacy RFP on board (d311ff8) | RFPs board | QA-20261114-RFP-Retest appears in Received (verified). |
| 16 | Unlinked reading note (d311ff8) | "This article is general reading, leave it unlinked …: '<title>'" | Saved as an unlinked note with that title (verified). |
| 17 | Cross-group approval offer (d311ff8) | Personal project: "Use what you know about <Work product> …" | Offers to ask for approval and uses nothing (verified). |
| 18 | Sources in updates (d311ff8) | `/update Stakeholder update … under 90 words` | Claims name their sources in brackets (verified). |
| 19 | Stated length to delegates (d311ff8) | Ask for a document "of 1 page" that Firstmate delegates | The result is close to the stated length. **Not yet retested.** |
| 20 | Earlier fixes | Azure Backlog project, team and level survive relaunch; RFP response drafting is refused; name taken from a long message | As described (all verified earlier today). |

## 8. Owner annotations from Lavish

Received 2026-11-15 ~09:00 Dubai from the report's issue table ("Next step" column).

**Partial capture.** The previous session cut off the start of this feedback batch, and Lavish delivers each batch only once. The notes below are the ones captured. The last lost note was a "Do this" on ISS-005's next step ("Record the model shown on each request and after restart (UC41)"). The owner's overall instruction (uid 35) covers every row: do all next steps. If unsure, ask the owner to re-send the earlier notes.

| # | Owner note | Where (issue row) | Next-step text it refers to |
|---|---|---|---|
| — | Do this (lost; inferred) | ISS-005 (Major) | Record the model shown on each request and after restart (UC41). |
| 27 | **Do this** | ISS-018 (Major) | Install-then-relaunch with a completed worker present. |
| 29 | **Do this** | ISS-028 (Minor) | Escape and outside click close it. |
| 31 | **Do this** | ISS-007 (Unrated) | Reopen Sprints after the reader exists. |
| 32 | **Do this** | ISS-019 (Unrated) | Time first launch on a clean profile. |
| 33 | **Do this** | ISS-024 (Unrated) | Ask Firstmate a BRD question in the product after reopening it, and note whether the card reappears. |
| 34 | **Do this** | ISS-012 (Major) | Create an RFP from Home; confirm Received, client, deadline, owner and the tracking-only boundary. |
| 35 | **"do all next steps in phases and releases not in 1 big wave. In the handoff tell the LLM to break into chunks and sub agents to work 1 by 1 serially"** | Header of the "Next step" column | Applies to every open issue's next step. See section 10. |

Raw capture: `/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/qa-20261114/logs/owner-annotations-20261115-0900.txt`.

**More notes are waiting for you.** The owner sent more notes at about 09:08, after the batch above. The previous session's listener was stopped at 09:22, at the owner's request, before it received them. They should still be queued in Lavish. Your first `poll` (section 9) should return them: log them here before acting. No listener is active, so `LISTENER_ACTIVE` should not appear.

**Batch received 2026-11-15 09:24 Dubai (QA takeover session).** One poll returned exactly one note, and the owner then ended the Lavish session (`session_ended: true`, `ended_by: user`). No other prompts were queued, so the 09:08 notes were either this note or never queued.

| # | Owner note | Where | Handling |
|---|---|---|---|
| 36 | "no need for this for now. Lets do this after u complete the extra testing and give me another html report with annotations" | Freeform message (whole report) | Lavish review paused. Finish the testing and fixes first, then deliver a **new** annotatable HTML report and open it in Lavish for the owner's annotations. Do not reopen the old session before then. |

Raw capture: `.lavish/qa-20261114/logs/owner-annotations-20261115-0924.txt`.

## 9. How to read further annotations from the Lavish session

The owner reviews the report at http://127.0.0.1:4387/session/2d82357e2b182104. It is backed by the file `/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/qa-20261114/all-journeys.html`.

```bash
L=~/.nvm/versions/node/v24.22.0/bin/lavish-axi
F=/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/qa-20261114/all-journeys.html
$L $F --reopen                      # reopen the same session if it was closed (prints the URL)
$L poll $F --owner next-session     # waits for and returns the owner's queued annotations
$L reply $F --agent-reply "<short message>"   # post a reply without waiting
```

- `poll` **consumes** what it returns. Copy every annotation into section 8 straight away.
- If another listener is active, `poll` fails with `LISTENER_ACTIVE`. Use `--takeover` only if no other session is meant to be listening.
- Run it as a tracked background job (or in the foreground) and leave it running until feedback arrives. Do not kill it.

## 10. Owner-directed plan: every "Next step", in phases and releases

The owner asked for this work to be done **in phases and releases, not in one big wave**. Break each phase into small chunks. Give **each chunk to one sub-agent at a time, serially** (never in parallel), and check its result before starting the next. Close every phase with a release:
1. `pnpm check` and `pnpm exec vitest run --coverage`, plus `pnpm test:e2e` when the change touches app flows.
2. Commit, then push to PR #30's branch. Do not merge.
3. `pnpm beta:mac`, then install with checksum, rollback and codesign checks.
4. GUI retest with Computer use.
5. Report overlay and render.
6. Update this handoff.

Only then start the next phase.

**Phase 0 — CI green. Released as be9fef3 at 10:17 Dubai.** Local checks are green and the GUI release smoke passed (Copilot answer in RFP-Phase1; ISS-018 relaunch passed). Remaining: confirm GitHub CI on be9fef3, including the later CI steps (pi-bridge, runtime, tmux, firstmate, packaged proofs), which have never run on this branch.
- CI job `unit` on d311ff8 fails in `pnpm test:e2e`: 14 failed, 47 passed. Most say "GitHub Copilot is not connected or its model is unavailable".
- Root cause: commit 24a9f23 made Firstmate and crew require GitHub Copilot, while the e2e suite drives the app with its own test provider. This was never caught because CI was blocked by billing on 14 Nov.
- **Status at 09:22 Dubai:** a Copilot CLI fix ran for about 23 minutes without finishing, and the owner asked to stop it. It was stopped, and **the fix worktree was reset to clean at d311ff8**.
- Its partial, unverified edits (7 files: `apps/desktop/src/main.ts`, `apps/desktop/src/native-pi-worker.ts`, `apps/service/src/native-pi-process.ts`, `packages/crew/src/copilot-routing.ts`, `packages/crew/src/native-pi-preferences.ts`, `packages/crew/src/native-pi.ts`, `playwright.config.ts`) are saved as `/Users/tamersabry/Documents/ChatGPT/Amun/releases/phase0-e2e-partial-copilot-20261115-0922.patch`.
- Copilot's diagnosis log is next to it (`.log`); it had reached the bundled Pi SDK's default-model selection. The CI failure excerpt is `releases/phase0-ci-e2e-failures-d311ff8.txt`.
- Review the patch (`git apply --check` first); reuse it or start fresh. Budget about 13 minutes per full local `pnpm test:e2e` run.
- Required fix: the e2e launcher explicitly declares its test provider (test-scoped only, never active in packaged runs, no silent fallback), and the other failing specs are fixed.
- Failing specs: conversation-queue, conversation-shell, firstmate-bearings, firstmate-calm, firstmate-posture, firstmate-stow, local-extension, m1-auth, m2-products, native-pi-import, native-pi, pi-resources, rebuild-shell, supervision-model.

**Phase 0 progress (QA takeover session, 2026-11-15 ~10:10 Dubai).**
- Chunk 0a (Copilot CLI, ~2 min): applied the saved partial patch and finished it. `AMUN_E2E_TEST_PROVIDERS` is declared only in `playwright.config.ts`, blanked by `main.ts` when packaged, and forwarded to the Pi worker. `firstmate-supervision.ts` `modelArguments()` drops the Copilot `--provider/--model` only in declared test mode. The debug line is removed, and there are new unit tests (`copilot-routing.test.ts`, `firstmate-supervision-model.test.ts`). The full e2e run went from 14 failures to 5.
- Chunk 0b (Copilot CLI, ~14 min):
  - A: with no authenticated model in test mode, a send now raises `CopilotUnavailable`, so the "Waiting to send" state returns.
  - B: the stow spec fixture now uses `pi-worker`/`amun-pi`, matching the intentional 24a9f23 change.
  - C: the bearings/posture order failures could not be reproduced once A was fixed.
- Chunk 0c (Copilot CLI, 1 min): the `authenticatedModel()` gate applies only in declared test mode, so production sends are unchanged. The Pi SDK itself falls back to `checkAuth()` when its snapshot is stale.
- `pnpm check` and `vitest --coverage` are green (1218 tests). The full e2e rerun is in progress; logs are in `releases/phase0/`.

**⚠ Local e2e safety (found 10:10 Dubai).** Some specs (shell, browser, pi, terminal, preview-handoff) launch the unpackaged app without `--user-data-dir`. The dev app's product name is "Amun", so they use the real default profile `~/Library/Application Support/Amun`. The first full local run (09:31, when the installed Amun was closed) therefore probably drove those specs against the owner's real profile. Nobody has inspected that folder (rule). A later run failed those specs in ~200 ms, because the installed Amun held the profile's single-instance lock. Chunk 0d adds `AMUN_E2E_USER_DATA`: `playwright.config.ts` creates a temp profile, and unpackaged `main.ts` uses it unless `--user-data-dir` is given. **Do not run local `pnpm test:e2e` from a commit without chunk 0d.**

**Phase 1 — done on d311ff8 (10:05).** Results are in overlay `updates-20261115-1005.json`. Passed: UC11 length, ISS-012, ISS-015, ISS-016, ISS-024, ISS-041, ISS-001, item 6/7, ISS-040 (document pane only). Failed: ISS-005 (Auto label) and the UC27/UC13 scope card (new ISS-044). New issues: ISS-043 (reply out of view) and ISS-045 (raw Markdown in chat).

**Phase 1 (original list):** One chunk per item:
- Section 7 items 13 (UC13 PRD v1.1 card; UC27 accept-the-risk card) and 19 (stated length, UC11).
- ISS-005 (owner: do this): record the model shown on each request and after a restart, in Home and in a product. Product composers showed "Auto" after relaunch on d311ff8.
- ISS-012 (owner: do this): create an RFP from Home; confirm Received, client, deadline, owner and the tracking-only boundary. Likely already passing (UC38 and UC40 verified); re-confirm on the newest build.
- ISS-024 (owner: do this): in QA-20261114-MoCA, ask Firstmate a BRD question after reopening the product; note whether a "Source BRD text needed" card reappears.
- ISS-001: first turn in a new project and after a context switch; no false "Connect an AI provider" error.
- ISS-015: a fresh delegation saves its draft with no recovery step needed (observed working today; record it).
- ISS-016: the Agents pane shows output while drafting.
- ISS-040: opening a review no longer squashes the conversation column.
- ISS-041: send a request, open Settings at once, return later; the reply must not be lost.

**Phase 2 — Behaviour fixes (no new UI; through the Copilot CLI).** One chunk per issue. Started 10:18 with chunk 2a, ISS-044: scope-card choices reach Firstmate (prompt in `releases/phase2/chunk2a-prompt.txt`). Next: ISS-005, ISS-043 (scroll to newest reply), ISS-028/038, ISS-033, ISS-019, ISS-007.
- ISS-018 (owner: do this): with a completed Pi worker present, install a new build and relaunch. Amun must relaunch normally; a finished worker must not hold the bundle identity.
- ISS-019 (owner: do this): time the first launch on a clean disposable profile (never the owner's profile), and confirm the first-run prompt recognises Pi readiness (7cb7104 added Pi trust handling).
- ISS-028 and ISS-038 (owner: do this for ISS-028): Escape and an outside click close the document title menu and the composer "+" menu. This changes dismissal behaviour only, not visuals.
- ISS-007 (owner: do this): Sprints shows the team's real sprints once a sprints reader exists. If that needs a new reader but no new UI, build it; otherwise list it under Phase 3.
- ISS-033: a reminder sentence must not open the work-area picker. Firstmate says reminders aren't available yet.
- ISS-029: a requested length is honoured (pairs with section 7 item 19).
- ISS-041: the fix for any reply-loss bug found in Phase 1.
- ISS-006: a failed Azure DevOps connection shows a readable reason. Error wording is visible copy, so show the owner first.


**Phase 2 release (11:05 Dubai, 91067be).**
- Commits:
  - ab484a7 — ISS-044: scope cards reach Firstmate.
  - fd9737d — ISS-005: model label.
  - 5734d42 — ISS-043: scroll to the newest reply.
  - ba4521f — ISS-028/038: menus close on Escape.
  - b5153ce — ISS-007: read-only sprints reader with `/sprint refresh|team|default`.
  - 91067be — a message sent mid-reply is held instead of dropped; a fresh document reaches Firstmate; e2e stability.
- Local checks: coverage 1236/1236; e2e 61 passed, 0 failed.
- GUI results on 91067be:
  - Passed: ISS-044 (Firstmate confirmed and delegated a revised PRD draft, so the Firstmate workflow is intact), ISS-005, ISS-028, ISS-038, ISS-043 for text replies and on open.
  - Failed: ISS-043 for card replies; ISS-007 binding lookup (chunk 2h in progress).
- Performance (`scripts/rebuild-performance-proof.ts`, temp profiles): startup ~340 ms (pass); setup ~462 MiB (pass); Home ~505 MiB (FAIL, budget 500).
- New issue ISS-046: Settings shows Copilot and OpenRouter as Signed out while Copilot works.

**Owner decisions, 15 Nov 10:44–10:51.**
- Approved: the reminder wording (ISS-033), chat Markdown (ISS-045), the Azure DevOps error text (ISS-006) and the Phase 3 features. Fix the Settings UI with `/impeccable`; the section tiles are very poor.
- **Priority:** replace the old-shell screens still visible in the default shell ("terminal" wording, legacy panels). Then create the PR and **merge to main**; the owner now authorises the merge of this work.
- Keep the Firstmate principles: captain → Firstmate → crew → Firstmate → captain (https://github.com/kunchenguid/firstmate). Keep the Council flow (https://github.com/nateherkai/roast-room). The guard text is in `releases/phase3/firstmate-guard.txt` and goes into every Copilot prompt.
- Test the app's performance, then merge everything.


**Owner decisions, 15 Nov 12:49–12:52 Dubai.**
- Keep the network-service-in-process change.
- Build a native live crew-session view.
- No CI artifact download is needed: fix the CI failure by reproducing it locally.
- The pending review "Revised: title only" was **approved and published** at the owner's choice (12:50). The publish **failed safely**: '"User Story" is not a work item type in POCs. Nothing was duplicated.' POCs is a Scrum project, so the item type should be Product Backlog Item; fix chunk 4g.
- **UC22:** after 4g, re-send the same approved story to POCs, then repeat the publish to prove there is no duplicate. Report the work item ID.
- **UC23:** one QA sub-task under that story, published only after the owner approves its review card in chat.
- **UC28:** Claude creates the private repo `tamer-sabry8/amun-qa-sandbox` (with a README). The crewmate adds one README line on a branch and opens a PR there. No merge.
- **UC45:** do the Wi-Fi-off test together at the very end. The owner toggles Wi-Fi when told.


**UC22 result (14:35 Dubai, build 53e8966).**
- Created #1091018 in POCs. The type fix works.
- The repeat publish created the duplicate **#1091019**: there was no cross-plan duplicate check, and Firstmate was unaware of the publish. Fix chunk 4p is in progress.
- The owner asked for #1091019 to be deleted (14:41). The built-in browser is not signed in to devops.tahaluf.ae (401), so the owner deletes it in Edge: work item ⋯ menu → Delete, which goes to the Recycle Bin. Keep #1091018.
- "Retry the N" only chatted. Fixed in chunk 4o (93…), which re-sends only the failed items.

**Legacy UI found in the default shell** (Phase 3 chunks 3a–3e):
- Settings: Accounts uses NativePiPanel, Tools uses LegacySettings connections, Skills uses SkillsLibrary, Data uses BackupControls, Advanced uses AgentsPanel and NativePiPanel.
- Agent detail > Watch embeds the whole legacy AgentsPanel ("Open verified worker terminal"). The crew watch view is a core Firstmate feature: keep it and restyle it.
- The setup wizard uses NativePiPanel.

**Phase 3 — New UI or features. Each needs owner approval first** (current screen beside the proposal in Lavish, then `/impeccable`, then wait):
- ISS-026: version history.
- ISS-034: search by meaning, across permitted content.
- ISS-037 and UC42: skill install.
- ISS-013, ISS-033 and UC36: reminders.
- UC09: memory correct and delete.
- UC24: board search, filter and drag.
- UC25 and UC26: stories in a sprint, assignees, commit.
- UC30: acceptance checklist.
- UC29: PR review.
- UC32: blocker owner and age.
- UC41: model label on each reply.
- UC04: client field on projects.
- UC10: recorded permission grant.
- UC13 and UC20: approval and version state on documents.
- UC15: objective tracker.
- UC19: prototype preview in the Browser panel.
- UC33: clickable source links.
- UC35: Notion page update with conflict detection.
- UC45: log export.

Propose them a few at a time, never all at once.

**Phase 4 — Owner-gated external tests:**
- ISS-022 and UC22: repeat-publish duplicate test on a fresh, owner-approved review in Azure DevOps POCs.
- UC23: sub-task.
- UC28: GitHub coding run.
- UC45: network loss (the owner turns Wi-Fi off).

Ask the owner before each one.

**Already done (do not redo):**
- Today's PR #30 fixes, listed in sections 5 and 7.
- The ISS-025 Viewing render, approved and shipped.
- ISS-021, ISS-023, ISS-030, ISS-031, ISS-032, ISS-035, ISS-036, ISS-039, ISS-042 and ISS-027, verified in the GUI.

## 16 Nov 05:35 — closing note
PR #30 merged to main (c0130a4) after CI green on 36ac9d2. Installed 36ac9d2. See SESSION-STATE-2026-11-15.md last section and .lavish/qa-final-20261116/index.html for what remains with the owner.

## 16 Nov 05:40 — REMAINING (read this first if resuming)
Done: PR #30 merged to main (c0130a4). Installed 36ac9d2 (sha256 bc9b8d96…6fee). Final report: .lavish/qa-final-20261116/index.html (Lavish session c4e1ac07bef9e7b9); journeys: Amun-QA-Journeys.html.
Main CI run 43786308908 on c0130a4: GREEN (16 Nov ~05:45).
Agent can do (needs screen unlocked):
1. GUI retest on 36ac9d2: Invites → red banner → "Check what was created" should settle the old QA Task as "not created" with the reason (was looping on a868c4e). Screenshot, add to overlay, re-render report.
2. Ask Firstmate for the QA Task again; it should ask for Remaining Work (number) and Activity (allowed values). Do NOT approve.
Owner only:
3. UC23: give Remaining Work + Activity, approve the new card.
4. Delete ADO duplicates #1091019 and #1091025 (POCs).
5. UC45: Wi-Fi off/on while Amun works.
6. Old pending cards: two Code change cards in Invites, one standalone Task card on Home.
7. Standing-permission test (agent was not allowed to add one).
Minor: e2e firstmate-stow flaked once (passed on rerun); 23 legacy e2e specs skipped.

---------------------------------------------------------------------
## BRIEF FOR A NEW AGENT (16 Nov 2026, 05:50 Dubai) — read this section first
---------------------------------------------------------------------

### 1. Where things stand
- Product: Amun, a macOS Electron app (bundle `ai.amun.desktop`; the window may be titled "Amun-7a28319"). The repository is tamer-sabry8/amun.
- PR #30 (`fix/azure-connection-qa-20261114`) is MERGED into main as merge commit **c0130a4**. Its last commit, **36ac9d2**, is included in main. Main CI run 43786308908 ("Foundation checks") passed.
- Installed in /Applications: build **36ac9d2** (DMG `releases/Amun-Beta-0.9-arm64-36ac9d2.dmg`, sha256 bc9b8d96…6fee). A DMG built from main c0130a4 is in `releases/` (see §6).
- Rollbacks for every earlier build are in `releases/installed-rollback/Amun-<sha>.app`. The latest is `Amun-a868c4e.app`.
- Reports:
  - `Amun-QA-Journeys.html` covers all 45 journeys, built from `.lavish/qa-20261114/logs/updates-*.json` with `python3 render_reports.py`.
  - The final summary is `.lavish/qa-final-20261116/index.html` (Lavish).
- Working copy: `/Users/tamersabry/Documents/ChatGPT/Amun/azure-qa-20261114`, currently detached at origin/main. Start any new work on a NEW branch from main.

### 2. Rules you must keep (owner's)
- Make code changes only through the GitHub Copilot CLI:
  `~/.local/bin/copilot -C <repo> -p "$(cat prompt.txt)" --allow-all-tools`
  Append `releases/phase3/common.txt` to each prompt. Review every diff yourself.
- Use Node 24: `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.bareRepository GIT_CONFIG_VALUE_0=all`.
- Before committing, run `pnpm check`, `pnpm exec vitest run --coverage` and `pnpm test:e2e`. Always use `pnpm test:e2e`, never Playwright alone, because it builds first. Expect 61 passed and 23 skipped.
- Commit trailer: `Co-Authored-By: <model> <noreply@anthropic.com>`.
- Release:
  1. Detach any mounted Amun Beta images.
  2. Run `pnpm beta:mac`.
  3. Check the sha256 and run `hdiutil verify`.
  4. Quit Amun and `ditto` the old app into rollback.
  5. Copy the new app into /Applications and run `codesign --verify --deep --strict`.
  6. Launch with `nohup /Applications/Amun.app/Contents/MacOS/Amun > <scratch>/amun-stdout.log 2>&1 &`. The console log is the main diagnosis tool.
- Testing:
  - Test ONLY through the GUI, using the computer-use `app_*` tools on `ai.amun.desktop`.
  - Never read or modify `~/Library/Application Support/Amun`, the database or the APIs.
  - Use synthetic `QA-2026…` data only.
  - External writes go ONLY to Azure DevOps TahalufCollection / project POCs, the Notion page "test for Amun to use", and GitHub `tamer-sabry8/amun-qa-sandbox`.
- Approvals and prompts:
  - NEVER approve a publication or review card on the owner's behalf unless the owner said so for that exact card. Changed payloads need new approval.
  - Leave password, Keychain and Wi-Fi actions to the owner.
  - If the screen is locked, GUI actions fail. Wait for the owner.
- Firstmate principle: captain → Firstmate → crew → Firstmate → captain. Never bypass it.

### 3. Fixed but NOT yet verified in the installed app (do these first)

**T1 — UC23: the stuck "being checked" item settles (fix in 36ac9d2)**
- What was failing: in work area "QA-20261115-Invites", an approved Azure Task stays "being checked" forever. The Task is "QA-20261115 Verify the invitee role defaults to Member (related to #1091018)". The red banner reads: "Checking whether … got through. Nothing was duplicated." Pressing "Check what was created" changes nothing.
- Root cause: the reconcile lookup rebuilds the work item from the approved fields. POCs requires Remaining Work and Activity for a Task, which the old card lacked, so the rebuild threw `PlanNotSent`. That was treated as "lookup failed", and the state went back to "unknown" every time.
- Fix (`packages/data/src/plan-publication.ts`, reconcile catch): a `PlanNotSent` from `find` means the item cannot exist as approved, so the state becomes "missing" (not created) and the reason is kept as the note. In `apps/desktop/src/plan-targets.ts`, `find()` lets a read failure through as a plain Error, so an unreachable Azure still counts as uncertain, never as "not created". Covered by unit tests.
- How to test:
  1. Open Amun and go to Home.
  2. On the "Failure · Work / QA-20261115-Invites" row, click "See what happened".
  3. In the conversation's red banner, click "Check what was created". Wait about 10–20 s.
- Success criteria:
  - The banner no longer says "Checking whether…". It reports the item as not created (for example "0 created, 1 not created, nothing duplicated").
  - The reason mentions the missing required field(s), such as Remaining Work or Activity.
  - Nothing is created in Azure: in POCs, #1091018 gains no new child Task.
  - Take a screenshot as evidence.
- If it still loops: check the console log for the lookup error. Do not retry-publish.

**T2 — UC23: Firstmate asks for the right values (fix in a868c4e, partly seen)**
- What was failing: Firstmate said it could not see Azure's refusal and that "Estimates … would be refused by Amun", so it could not raise a correct card.
- Fix: each turn, Firstmate's context lists the stored reason for every item that was not created, and the required fields per work item type, with allowed values. The plan tool accepts Original Estimate, Remaining Work and Completed Work (numbers, in hours) and Activity when the type has them. Non-numeric hours are refused.
- How to test: run T1 first. Then, in the Invites conversation, type: "Why did the QA Task under #1091018 fail, and what do you need from me to raise it again?"
- Success criteria:
  - Firstmate names the actual reason (Remaining Work and/or Activity required).
  - It asks the owner for a Remaining Work number and an Activity, listing the allowed Activity values.
  - It does NOT choose values itself, and does NOT say estimates would be refused.
  - It proposes no card until values are given.
- Then STOP. The owner supplies the values and approves.

**T3 — UC23 end to end (OWNER approves)**
- After the owner gives values, Firstmate raises a new review card. The card must list Title, Description (acceptance included), Parent #1091018, Remaining Work, and Activity.
- After the OWNER approves, success means: exactly one new Task in POCs, child of #1091018 (Hierarchy-Reverse link), with the given values; the card shows "1 created" with a link; no duplicates.

**T4 — ISS-059: failure reasons visible**
- Expected: on any failed item, "See why it failed" opens the plan and shows the destination's own reason.
- Partly seen on 7f071f8 and 7a12bc6. Confirm on 36ac9d2 with the T1 item.

**T5 — UC28: PR description from facts (a868c4e)**
- Optional. Only on the owner's request, ask Firstmate for another one-line README change in amun-qa-sandbox.
- After the owner approves, the PR body should list branch, files and line counts taken from the actual diff, with no invented claims.
- Never merge that PR.

**T6 — UC35: Notion append paragraphs (a868c4e)**
- Optional. Append two lines to the Amun-created test page under "test for Amun to use".
- After approval, each line should be its own paragraph in Notion.

### 4. Owner-only items
1. UC23 values and approval (T3).
2. Delete the duplicate POCs items #1091019 and #1091025.
3. UC45: turn Wi-Fi off while Amun is working, then back on. Expected: a clear offline notice, no lost or duplicated writes, and recovery on reconnect.
4. Old pending cards: two Code change cards in Invites and one standalone Task card on Home. Approve or dismiss at the owner's discretion.
5. Standing-permission test (the agent's safety checks blocked adding one).

### 5. Already verified (no action needed)
- UC22: no duplicate on repeat publish.
- UC35: Notion update.
- UC28: PR #1 opened in amun-qa-sandbox; open, not merged.
- Agents redesign in light and dark.
- Sprints, Skills install, Portfolio, diagnostics export, delegation and relay, Keychain startup, Beta 0.9 About.

### 6. Known minor issues
- The e2e `firstmate-stow` test timed out once under load and passed on rerun.
- 23 legacy-shell e2e specs are still skipped in packaged runs.
- Each new ad-hoc build may trigger one Keychain prompt.
- First launch takes 4–7 s against a 3 s target.

### 7. DMG from main
`/Users/tamersabry/Documents/ChatGPT/Amun/releases/Amun-Beta-0.9-arm64-c0130a4.dmg`, built from main c0130a4. sha256 0888a3cc1b67aebbad396f1403f3cba675972661b5aa84b0a7c392d80e7b07db, `hdiutil verify` VALID, ad-hoc signed. Its content is identical to 36ac9d2 plus the merge.
