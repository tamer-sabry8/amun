# Amun QA session state — 15 Nov 2026 (written 14:52 Dubai, before context compaction)

Read this first after compaction. Full background: `HANDOFF-AMUN-QA-2026-11-15.md` (same folder; sections 8 and 10 hold owner notes and decisions).

## How I work (owner rules, do not change)
- All code changes go through GitHub Copilot CLI, ONE chunk at a time (never two at once in the worktree):
  `~/.local/bin/copilot -C /Users/tamersabry/Documents/ChatGPT/Amun/azure-qa-20261114 --add-dir /Users/tamersabry/.nvm/versions/node/v24.22.0 -p "<prompt>" --allow-all-tools`
  Append `releases/phase3/common.txt` (rules + Firstmate/Council guard) and, for features, `releases/phase5/feature-rules.txt`.
- Review each diff, then `pnpm check` and `pnpm exec vitest run --coverage` (Node 24 at `~/.nvm/versions/node/v24.22.0/bin`, with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.bareRepository GIT_CONFIG_VALUE_0=all`), `pnpm test:e2e` (~4 min, must be 61 passed), commit, push to `fix/azure-connection-qa-20261114` (PR #30).
- Release: `pnpm beta:mac` (clean tree) → DMG in `releases/` + `.dmg.json`; verify sha256 + `hdiutil verify`; quit Amun; `ditto` rollback to `releases/installed-rollback/Amun-<old>.app`; copy new app; `codesign --verify --deep --strict`; `open -a /Applications/Amun.app`.
- GUI tests with Computer use on `ai.amun.desktop` (shown as "Amun-7a28319"). Window is usually off-Space: `request_full_control`, `app_menu Window>Zoom`, `app_release`, then `computer_batch` (coordinates at 0.6 scale ×1/0.6). Release full control after.
- Never touch `~/Library/Application Support/Amun`. No git stash. Synthetic QA-2026… data only. External writes only to Azure DevOps TahalufCollection/POCs and Notion "test for Amun to use".
- Commit trailer now: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` (owner asked to switch to Fable 5.2).
- Firstmate principle (in AGENTS.md): captain → Firstmate → crew → Firstmate → captain. Council follows Roast Room. Never bypass.
- After each result: overlay `logs/updates-<date>-<time>.json` in `.lavish/qa-20261114/`, `python3 render_reports.py`, copy `all-journeys.html` to `Amun-QA-Journeys.html`, update the handoff.

## Owner decisions (today)
- Approved: reminder wording, chat Markdown, ADO error text, ALL Phase 3 features, Settings redesign via /impeccable.
- Priority given: remove all old (legacy) UI from the app. Then PR and **merge to main** (owner authorised the merge when everything is done).
- Keep network-service-in-process change. Build live crew view (done). No CI artifact download.
- UC22: approved. Created #1091018 (good). Duplicate #1091019 was created (bug, fixed in 687221a); **owner will delete #1091019 himself later, not a blocker**.
- UC23: one QA sub-task under #1091018; publish only after owner approves its review card in chat.
- UC28: repo `tamer-sabry8/amun-qa-sandbox` (private, created by me). Crewmate adds one README line on a branch, opens a PR, no merge.
- UC45: Wi-Fi-off test together at the very end (owner toggles Wi-Fi when told).
- Version: app must be **"Beta 0.9"** (0.9.0), shown in Settings › About and in the DMG name. Prompt: `releases/phase5/f19.txt` (Copilot run started 14:50, log `releases/phase5/f19-copilot.log`).
- Owner said: keep going until everything is completed; do not stop.
- Lavish: old session ended by owner. At the end deliver a NEW annotatable HTML report and open it in Lavish.

## State right now
- Branch head pushed: **687221a** (PR #30, not merged). CI: 53e8966 = **success** (first green); 687221a in progress.
- Installed in /Applications: **687221a** (DMG sha256 2ab8ed7b…9428, verified, ad-hoc). Rollbacks kept for every earlier build.
- Running: Copilot f19 (Beta 0.9 + About). When done: review, check, commit.
- Last local results: check 1329 tests pass; e2e 61 passed / 23 skipped.

## Done and verified in the GUI
ISS-005 (model label), ISS-012, ISS-015, ISS-016, ISS-018, ISS-024, ISS-028, ISS-038, ISS-041, ISS-001, ISS-044 (scope card → Firstmate delegates), ISS-045 chat Markdown, ISS-046 (Copilot/ChatGPT/OpenRouter show Signed in), UC11 length, UC41 model on replies, Settings list nav + Tools/Skills/Backup/Advanced in new style, ADO test connection, conversation layout fix (53e8966), UC22 first publish (#1091018, PBI type resolved).

## Built, committed, NOT yet verified in the GUI
- ISS-007 Sprints real sprints (`/sprint refresh`), ISS-043 card-reply scroll, ISS-033 reminder message, agent Watch view + live session, Firstmate skills in "/" menu, PRD/Backlog panes new look, no legacy shell in installed app (check `?legacy=1` impossible), Retry button real re-send (33548e3), cross-plan duplicate guard + "Already in Azure DevOps as #…" warning (687221a) → **redo UC22 repeat publish to confirm it links, not creates**.
- Features: UC04 client, UC32 blockers, ISS-026/UC13/UC20 versions + approval, UC33 source links, UC09 remembered facts, UC24 RFP search/filters, UC45 diagnostics export, UC10 permission changes.
- Memory: clean profile Home 457–459 MiB (budget 500 met). Owner profile ~579 MiB after lazy worker (was 705); first launch after install 4–7 s vs 3 s gate (open).

## Remaining work, in order
1. Finish f19 (Beta 0.9/About) → commit.
2. Phase 3 features still to build, one Copilot chunk each (prompts ready in `releases/phase5/`): f10 objective tracker (UC15), f11 sprint stories/assignees/commit (UC25/26), f12 acceptance checklist (UC30), f13 PR review + governed merge (UC29), f14 prototype preview (UC19), f15 Notion update + conflict detection (UC35), f16 search by content/meaning (ISS-034), f17 skill install (ISS-037/UC42), f18 real reminders (ISS-013/UC36).
3. Release (check, coverage, e2e, push, DMG named Beta 0.9, install).
4. Full GUI retest of everything in "not yet verified" + new features; fix what fails (loop).
5. UC22 repeat-publish recheck; UC23 sub-task (ask owner to approve card); UC28 coding run in amun-qa-sandbox.
6. Check migrations 33–35 (+ any new) do not collide with `main`; confirm PR #30 CI green on final head.
7. UC45 Wi-Fi test with owner.
8. Overlays + render report; write NEW annotatable HTML report and open in Lavish; update handoff.
9. Create/refresh PR, **merge to main** (owner authorised), final report (PR link/state, build installed, pass/fail with evidence, annotations handled, what still needs owner).

## Open issues not yet fixed
- First launch after install 4–7 s (gate 3 s).
- Owner-profile memory ~579 MiB (saved separate-graphics preference keeps GPU/network out of process).
- Azure "update existing item" governed path does not exist yet (needed by f11).
- 38 legacy-shell e2e specs skipped in packaged runs (should be migrated to the new shell later).
- Duplicate work item #1091019 in POCs awaiting owner deletion.

## Update 15:46 Dubai
- ALL Phase 3 features are now built and committed locally (not pushed yet at 15:46): f19 Beta 0.9 + About, f10 objectives (mig 36), f18 reminders (mig 37), f16 content search FTS (mig 38), f12 acceptance checklist (mig 39), f17 skill install, f14 prototype preview, f15 Notion update + conflict (mig 40), f11 sprint items + governed assignee/iteration updates, f13 Pull requests + governed merge. Migrations now 33–40.
- Running: release checks (check, coverage, e2e). Next: push, `pnpm beta:mac` (DMG now named Amun-Beta-0.9-arm64-<commit>.dmg), install, perf proof, then steps 4–9 of "Remaining work".
- To review in GUI: PR view "Send my review" writes to GitHub (confirm it is owner-initiated only).
- Embedding/semantic search needs an owner model decision (FTS + synonyms shipped).

## INCIDENT 15:55 Dubai — Beta 0.9 (345e084) hangs on "Opening Amun…" on the owner's profile
- Installed: Amun-Beta-0.9-arm64-345e084.dmg (sha256 ca095ac7…24ba). Clean profile fine; owner profile never gets a snapshot (service starts, renderer Connected). 687221a opened the same profile fine. The profile DB has ALREADY been migrated by this build (33→40), so do NOT roll the app back blindly.
- Amun is left closed. Rollback copy of 687221a: releases/installed-rollback/Amun-687221a.app.
- Fix in progress: Copilot hotfix (`releases/phase5/hotfix1.txt`, log `hotfix1-copilot.log`): legacy-data regression test, root cause, visible error state instead of hanging, redacted reason in logs.
- After the fix: check, e2e, push, build, install, relaunch; if still stuck run `/Applications/Amun.app/Contents/MacOS/Amun` from a shell to read the redacted reason.
- Full-screen control approval timed out at 15:53 (owner away); background app_* tools work only when the window is reachable.

## INCIDENT ROOT CAUSE (16:45 Dubai)
- Not data. A macOS Keychain prompt (SecurityAgent pid 57328, started 15:53:31 = first Beta 0.9 launch) is waiting for the owner; Amun startup blocks on a Keychain read, so the snapshot is never sent. Ad-hoc builds have a new cdhash each build → new Keychain identity each install.
- OWNER ACTION: answer the macOS Keychain prompt for Amun (Always Allow). I must not handle password prompts.
- Installed now: Amun-Beta-0.9-arm64-67bd7c6.dmg (sha256 2c9b1cd2…a981), Amun closed. Head pushed: 67bd7c6 (hotfix error-state 80fe31e + native PRD/Backlog 67bd7c6, the latter unverified in GUI and revertible on its own).
- Running: Copilot hotfix 2 (`releases/phase5/hotfix2.txt`): startup/snapshot must never wait on Keychain; find the blocking call.
- Then: check, e2e, push, build, install, GUI retest (needs owner to approve full-screen control and the Keychain prompt).

## 16:55 — hang FIXED: build 6970325 installed (sha256 d96e8b09…de9b), opens on owner profile while the Keychain prompt waits. Head pushed 6970325. Next: GUI retest (background app_* works), then report + merge. Owner still must answer the Keychain prompt before ADO/Notion/GitHub tests (Sprints, UC22 recheck, UC23, UC28).

## 17:00 — GUI results on Beta 0.9 (6970325), overlay updates-20261115-1700.json written
Passed: opens with Keychain prompt pending (ISS-047), About "Version Beta 0.9 (0.9.0)", content search (ISS-034), RFP search (UC24), reminders (UC36/ISS-013/033), Remembered facts section, PRD pane native, Pull requests tab present, model label + Markdown.
New open: ISS-049 (PRD pane empty-state copy). ISS-048 duplicate guard recheck pending Keychain.
Still to GUI-check: version history/approval menu, blockers, project client, source links, acceptance, skill install, prototype preview, objectives, diagnostics export, permission changes, agent Watch, Backlog pane, Sprints/ADO/Notion/GitHub (need Keychain answer). Then UC22 recheck, UC23, UC28, UC45, new Lavish report, merge to main, final report.
Background app_* control works when the Amun window is on the current Space (no full-screen approval needed).

## 17:10 — more GUI passes on 6970325 (add to next overlay)
- ISS-026 Version history: "Version 1 (current) · You · Approved" (P5_ISS026_version_history.jpg). UC13/UC20 Mark as approved → tag "Approved (v1)", menu shows "Remove approval" (P5_UC13_approved_v1.jpg). I approved the QA doc "1-page PRD for faster first-teammate onboarding" in Invites (local, synthetic).
- Backlog pane native, shows saved project POCs (P5_backlog_pane_native.jpg). Minor: "▶ Change this project" triangle.
- Clicking menu items by coordinate can hit the editor behind; use element_index for menu items.
- Still to check: Pull requests pane, agent Watch/live session, objectives, blockers, client, source links, acceptance, skill install, prototype preview, diagnostics export, permission changes; then Keychain-dependent ones.

## 17:20 — more GUI passes on 6970325 (not yet in an overlay; add to next overlay with the 17:10 items)
- UC04 client: header tag "Client: QA Test Client" in QA-20261114-Reminder (P5_UC04_client_tag.jpg). ISS-043 reply scrolled into view.
- UC32 blocker: Home row "Blocked · QA-20261114-Reminder · Waiting for the security review of QA-20261115 · Priya · raised today · It's unblocked" (P5_UC32_blocker_home.jpg). Blocker card NOT seen inside the project view (check/fix). Test blocker left in place (synthetic).
- UC29 Pull requests pane: empty state + "Ask Firstmate to connect one" (P5_UC29_pull_requests_empty.jpg).
- Test reminder marked Done.
- Remaining GUI checks without Keychain: agent Watch/live session, objectives, source links, acceptance checklist, skill install, prototype preview, diagnostics export, permission changes. With Keychain (owner must answer prompt): Sprints, UC22 recheck, UC23, UC28 (connect amun-qa-sandbox), Notion update.
- Small fixes queued for one Copilot chunk: ISS-049 PRD empty-state copy; Backlog "▶ Change this project" triangle; blocker card in project view; older docs' version author shows "You".

## 18:05 checkpoint
- Owner answered the macOS Keychain prompt (~18:00). Keychain-dependent checks now unblocked: Settings › Accounts sign-ins, Sprints `/sprint refresh`, UC22 recheck, UC23 sub-task (review card → owner approves in chat), UC28 sandbox repo, Notion update.
- Owner's current Space is a full-screen app → background app_* cannot reach the Amun window; full-screen control approval timed out at 18:04. Retry when the owner is back.
- Running: Copilot small-fixes chunk `releases/phase5/small1.txt` (ISS-049 copy, Backlog triangle, blocker card in project view, version author). Log `small1-copilot.log`. Then review diff, check, coverage, e2e, commit, push, build, install.

## 18:25 checkpoint
- Full-screen control approved 18:12 (KEEP it while GUI testing; releasing it strands the window on another Space). Amun window zoomed via Window>Zoom.
- Accounts after Keychain: GitHub Copilot + OpenRouter Signed in; ChatGPT/Meta stuck "Checking…"; xAI/Kimi Signed out. Tools: ADO showed stale "Not working" → Test connection → Connected (bug 5 in fix2). Notion + GitHub NOT connected → need OWNER browser sign-in (Edge) before UC35/UC28.
- UC22 RECHECK FAILED: "Retry the 1" on the old failed Invites plan CREATED #1091025 (3rd copy; guard skipped on retry / type User Story vs PBI). Owner must delete #1091019 AND #1091025. No more ADO writes until fix2 lands. UC23 waits for fix2.
- New bugs (all in `releases/phase5/fix2.txt`): retry duplicate; stale failed banner; Sprints All-areas loads forever + "Product context" message; Portfolio cards print "false"; ADO stale status; Settings›Skills unreachable (productContext legacy-only); Agents "Output so far" raw Markdown + previous task's output.
- GUI PASS: Permissions page; diagnostics export review; Agents roster; Firstmate delegates to Research & Insights and relays result + files Doc (captain→Firstmate→crew→Firstmate→captain intact); Watch panel "no live session"; Browser pane; doc Viewing with clickable source links; new crew doc version author "A crew agent".
- Auto-mode refused adding a standing permission in Settings (loosens an approval gate) → owner to test.
- small1 chunk (ISS-049, Backlog triangle, blocker row in project view, version author mig 41): check 1409 + coverage pass; first e2e was run WITHOUT build (stale, 20 fails, false alarm); rerun `pnpm test:e2e` shows 1 fail so far (rebuild-shell.spec:64) — investigating. ALWAYS use `pnpm test:e2e` (builds first).

## 18:58 checkpoint
- Build 8acea64 (fix2 + small1) INSTALLED 18:46: Amun-Beta-0.9-arm64-8acea64.dmg sha256 de7fd919…f278a, VALID, codesign OK; rollback releases/installed-rollback/Amun-6970325.app. check 1416, coverage, e2e 61/0 passed; pushed 8acea64; PR CI pending. (DMG build needed a re-run: old image stayed mounted → detach all mounts before rebuilding.)
- Owner connected Notion + GitHub (18:36). After restart: ADO/GitHub "Saved, not tested", Notion "Not connected" until Test (fix3 #5). Notion destination set: test for Amun to use (https://app.notion.com/p/4173581de3a980eaae45d78ca230f0a3) — verified.
- GUI PASS on 8acea64: Invites stale failure gone from Home; Portfolio no "false"; Sprints refresh answers (no hang); Skills reachable (product select) → synthetic skill qa-20261115-checklist approved, shows in "/" as "Your skill"; UC22: Firstmate refuses to re-raise (lists #1091018/#1091019/#1091025) — no write.
- UC23: Firstmate raised a standalone Task card (no parent link). OWNER DECIDED "Fix parent link first" → card left unapproved; fix3 running (Copilot, releases/phase5/fix3.txt): parent link, "1 story" wording, Sprints past-sprint message + Timeline overlay box, Notion status after restart, Skills wording/form reset.
- UC35: created Notion page "QA-20261115 Notion update test" (id 4193581d-e3a9-8129-b916-edfbdcd7bea8) under test page via approved card (I approved; synthetic, owner-authorized destination). Update REFUSED (Firstmate can't name page) + Firstmate contradiction + Notion card lacks body/parent → fix4.txt queued (run after fix3).
- Next: fix3 review → fix4 → release → GUI retest UC23 (owner approves card in chat) + UC35; then UC28 (GitHub sandbox), UC45 with owner, Lavish report, merge.

## 19:55 checkpoint
- Pushed b86bbda (63002ab UC23 parent + UC35 Notion update; b86bbda UC28 gated GitHub code change → PR). check 1441, cov, e2e 61/0. Installed b86bbda 19:44 (sha256 63b76b6f…3c62); rollback Amun-8acea64.app. CI green on 8acea64.
- OWNER (19:34): redesign Agents screen like 3 screenshots via /impeccable, PM selected initially, click to switch; "make this change and merge and push to production". f21 + f21b + f21c (Copilot) in working tree, uncommitted. f21c running: ellipsis/min-width, selected amber border, header line; PLUS ADO "Could not check" reason visibility + root cause.
- OWNER APPROVED UC23 publish (19:47). Card showed "Under #1091018 · …", Task, POCs. Publish → NOT created: "Could not check whether this already exists" (duplicate lookup throws on real POCs; safe, nothing written). "Retry the 1" banner pending — retry only after f21c fix lands (owner approval stands for the same item).
- UC35 on b86bbda: update card appears with exact diff (good); approved → "Notion did not accept this", page unchanged (verified via Notion MCP). fix6.txt queued (Notion update call + visible reasons + "Not updated" + UC28 code card not shown in Pull requests + crewmate choice).
- UC28 on b86bbda: Firstmate delegated to Product Manager; "changed 1 file… Open Pull requests" but pane shows no Code changes (repo not connected to product) → fix6 #5.
- Next: f21c review → fix6 → release (check/cov/e2e/build) → install → GUI: Agents screen (dark theme), UC23 retry, UC35 approve, UC28 approve → PR in sandbox; then merge PR #30 to main (owner: "merge and push to production"), UC45 with owner, Lavish report, final report.

## 20:25 checkpoint
- Pushed + installed 4d4985a (Agents redesign + fix6) sha256 5423008e…ad0d; rollback Amun-b86bbda.app. check 1453, cov, e2e 61/0.
- Agents redesign VERIFIED in owner dark theme: PM selected, click switches ("Specialist 05 of 12 · Product Marketing"). f21d (show all 20 catalog specialists, Add to team) done in working tree, uncommitted.
- Amun now runs launched from shell with console captured to scratchpad/amun-stdout.log (not the profile). Real causes: UC23 "Task in POCs has no Acceptance criteria field, so it would be lost"; UC35 "page is not under the connected Notion destination" (wrong parent check; MCP fetch has empty ancestor-path). → fix7 running (Copilot).
- UC28: Solution & AI Architecture made change on Amun's copy; card never shows because service.ts code-change handler gates on legacy preferences.productId → fix8.txt queued after fix7.
- Owner-approved UC23 publish still pending a working retry (same item; approval stands).

## 20:58 checkpoint
- Pushed + installed f255f64 (fix7+fix8+f21d) sha256 07125986…5f1b, launched from shell → scratchpad/amun-stdout2.log. rollback Amun-4d4985a.app. check 1462, cov, e2e 61/0.
- UC35 PASS (20:54): Notion page "QA-20261115 Notion update test" now has "Updated by Amun Beta 0.9 (UC35 check)." + marker kept (verified via Notion MCP). Minor: appended with <br> in same paragraph.
- UC23: duplicate check now OK; create returns ADO 400 (body discarded) → fix10 (keep Azure error message, relation URL, field filter). Owner approval for this Task stands.
- UC28: card still missing → fix9 running (Copilot: workAreaId filter, swallowed errors).
- Agents: 20 specialists, "12 of 20 selected", not-on-team dimmed ✔; overflow at 1200px → fix10 #4.
- "View diagnostics" from a failure opens generic Settings › Advanced (minor).

## 21:30 checkpoint — OWNER ASLEEP, standing approval for computer-use sessions; keep going to merge on main
- Pushed + installed 7f071f8 (fix9+fix10) sha256 26aef068…7d77; console → scratchpad/amun-stdout3.log; rollback Amun-f255f64.app. Full-screen control approved 21:20 — KEEP it (don't release).
- Agents redesign PASS on 7f071f8: 20 specialists, "12 of 20 selected", fits window, Add to team (13/20) then Remove (back to 12/20) — owner team restored.
- UC23: Azure refuses: "TF401320 Rule Error for field Remaining Work… Required… 2 additional errors". Needs required fields on card + owner-supplied values → NEW approval needed (payload changes). Do NOT self-approve. Leave card for owner.
- UC28 ROOT CAUSE: renderer bridge.ts doesn't forward "code-change-result" → fix11 running (plus audit of all result kinds, Azure required fields, 4xx = not created, View diagnostics).
- After fix11: release, install, UC28 → approve sandbox code card (within owner-approved UC28 scope: throwaway repo, branch + PR, no merge), verify PR on GitHub; then PR #30 merge to main; Lavish report; final report.

## 16 Nov 05:00 checkpoint
- 7a12bc6 installed (sha 9d84659d…3c48). UC28 PASS: PR #1 in amun-qa-sandbox, open, not merged. Agents redesign PASS light + dark.
- UC23 retest on 7a12bc6: Firstmate could not see Azure's refusal reason and thought estimates would be refused → fix13.
- fix12 (PR body from facts, Notion paragraphs) + fix13 (failed reasons in Firstmate context, estimates/Activity accepted as numbers, definite refusal stops "being checked" loop) reviewed; release pipeline r11 running (logs releases/phase5/*-r11.log).
- Next: install r11, retest UC23 (Firstmate should ask for Remaining Work/Activity; do NOT approve — owner), CI, merge PR #30, overlay + report + Lavish, final report.

## 16 Nov 05:35 — DONE: PR #30 MERGED to main (c0130a4)
- Final head 36ac9d2: check 1502, coverage, e2e 61/0, CI unit green. Installed 36ac9d2 (sha bc9b8d96…6fee), rollback Amun-a868c4e.app.
- a868c4e = fix12+fix13; 36ac9d2 = fix14 (old Task stuck "being checked" because lookup rebuilt it and was refused for missing Remaining Work/Activity → now "not created" with reason; read failures stay uncertain).
- GUI retest of 36ac9d2 UC23 BLOCKED: screen locked 05:19.
- Overlay updates-20261116-0525.json rendered → Amun-QA-Journeys.html. Final Lavish report: .lavish/qa-final-20261116/index.html (session c4e1ac07bef9e7b9).
- Owner to do: UC23 values + approve new card (press Check what was created first); delete #1091019/#1091025; UC45 Wi-Fi; old code-change cards + old Task card; standing-permission test.
