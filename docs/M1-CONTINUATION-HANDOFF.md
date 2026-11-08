# Amun interim M1 continuation handoff

Updated 8 November 2026, Asia/Dubai, at the owner's explicit request for a fresh chat. This is an interim checkpoint. M1 and its final handoff task T022g remain incomplete.

## Start here

Read this file, AGENTS.md, docs/TASKS.md and the referenced evidence before changing code. Continue all unblocked M1 work with TDD until its gates pass or real user input is required. Keep the task tracker and draft PR current and push tested logical increments. Do not begin M2 or the neumorphic redesign. Ask for explicit design approval when other work is ready. Do not merge the M1 PR without a new authorization.

## Checkout and GitHub

- Real checkout on macOS is /Users/tamersabry/Projects/amun.
- The Codex saved project is /Users/tamersabry/Documents/ChatGPT/Amun. It is not the Git checkout. Run repository commands with the real checkout as working directory.
- Repo is tamer-sabry8/amun, https://github.com/tamer-sabry8/amun.
- Existing M1 branch is feat/m1-durable-core-shell.
- Current PR is https://github.com/tamer-sabry8/amun/pull/2, OPEN, DRAFT, unmerged as verified.
- M0 PR https://github.com/tamer-sabry8/amun/pull/1 is MERGED, 6 November 2026 at 11:59:19 UTC.
- Verified remote main is 0b8b3bd90284b7b5ae12f6de32a592bcd311c61e.
- Code checkpoint 04102e9 includes Notion recovery and single-profile window ownership. b222fbb records refresh evidence. 415df550f47a5c2b850b44db06300c1565118b23 records revocation.
- The accepted app revision is 679867d. Subsequent documentation commits may advance the draft PR head.
- Foundation checks passed for 679867d on push and PR. The packaged suite independently passed 42 journeys with one development-only skip.
- Checkout was clean before this handoff edit. Inspect status/remotes before fetch/pull. Preserve later local work. No reset, clean or force-push.

## Full plan and source precedence

docs/plans/product-and-r1-plan.md is the full product and R1 plan. docs/TASKS.md owns current milestones, scope changes and exit gates. Later explicit user decisions override original attachments and dated evidence. Read docs/decisions/ (particularly ADR-001, 004–011), docs/plans/m1-native-pi-commands.md and docs/plans/m1-user-journey-audit.md. docs/MAC-ACCEPTANCE-HANDOFF.md is historical M0 context. docs/evidence/M0-final-audit.md owns revised M0 acceptance. Old incremental notes below the task lists can be superseded.

## M1 task audit — 8 November

The canonical checklist is [TASKS.md](TASKS.md). The completed entries cover T013–T022 foundations and auth, T022a native commands, T022b sharing, T022f hosting, T022h Firstmate updates and T037 bridge governance. T022a includes the 35-command catalog audit and the separate real behavioral tests documented in the [native command ledger](plans/m1-native-pi-commands.md).

| Open M1 entry                                | Next action                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T022d · Physical external-drive verification | When a physical drive is available, use a disposable selected folder for the same short listing and cancellation check. The internal APFS Data volume passed on 8 November in 2.4 seconds. A mounted HFS+ disk image passed earlier. |
| T022c · Redesign                             | Paused by the owner.                                                                                                                                                                                                                 |
| T022g · Final handoff                        | Prepare after T022c and remaining M1 gates. This file is the interim handoff.                                                                                                                                                        |

The owner moved authenticated Google checks (including Sheets and Maps) and live Obsidian vault acceptance to **R3-GOOGLE** and **R3-OBSIDIAN**. Existing connector setup and discovery evidence stays with M1. M2 remains locked.

## Most recent Notion result and safety rules

Owner-approved page is https://app.notion.com/p/4113581de3a9818b96e6d337a0d4f242 under Document Hub. Publication/action ID is af4ebf45-2c7d-4720-98b3-f63823e16f22. Its exact approved footer matches. Amun recorded succeeded/confirmed and the visible window showed success. Do not publish it again. The older same-title fixture is 4113581d-e3a9-81cc-9eaf-e236f2bdcd7c.

Persist the unique intent before sending. Track not sent / sent-unknown / confirmed. Never repeat create while sent-unknown. Reconcile by ID with backoff or a PM-supplied URL. Prefer a proven searchable page property, otherwise show a one-line footer in the exact approval preview. Document Hub currently uses the footer. Duplicate titles, missing/edited IDs and ambiguous matches cannot confirm. Production live fetch omits separate id sometimes; validate its canonical URL against requested identity. The read-only live lookup and an in-memory lost-reply ledger both confirmed the exact page with zero external writes.

Notion uses official hosted MCP browser OAuth, service-owned grant/Keychain, Edge or Dia. No token-entry onboarding. Pi /share is disabled with no gist/Radius fallback. Exact-content review is mandatory before every new publication.

Disposable OAuth lifecycle profile is named by /private/tmp/amun-notion-lifecycle-profile-path. Validate that it resolves under /private/tmp/amun-notion-lifecycle-* before use. Its registration was verified distinct from the working profile. Owner approved revoking only this grant. Notion returned HTTP 200. Production refresh then attempted once, cleared its local credential and returned reconnect-required. After the owner accepted the Keychain prompt, the packaged UI showed reconnect guidance. This disposable profile is intentionally disconnected. Do not ask the owner to sign it in again without a concrete new test.

Working profile /Users/tamersabry/Library/Application Support/Amun/M1-acceptance still read the approved page after revocation. Do not copy/delete grants or print credential records, access/refresh tokens, complete environments or browser cookies.

## Sessions, runtimes and testing

Read AGENTS.md. Preserve personal Herdr/Pi/Firstmate workers, homes, locks and installed versions. Firstmate operational homes MUST be real Git worktrees backed by Amun-owned repositories. Installed checkout is /Users/tamersabry/Projects/firstmate. Pi launchers live under ~/.pi/agent/bin/pi and ~/.local/bin/pi. Inspect current versions read-only. Official Amun-scoped CLI profiles have subscription sign-ins. Never assume every credential is portable.

Bundled Pi is 1.4.0. Current Firstmate pin is bf05a4f, retained rollback is 4a67799. Staged update procedure and approval rules are in AGENTS.md and docs/evidence/M1/2026-11-07-firstmate-candidate.md. Trust and verified Firstmate hooks can be automatically accepted only in disposable Amun-owned worktrees.

Use Node 24.22.1 and pnpm 11.25.0. Existing toolchain PATH prefix is /tmp/node-v24.22.1-darwin-arm64/bin:/tmp/amun-toolchain/node_modules/.bin. Verify availability. Read package.json and scripts first. At 679867d, lint, types, formatting, coverage and 452 unit tests passed. The accepted arm64 build is /private/tmp/amun-m1-verified-local-stow/Amun-darwin-arm64/Amun.app. Use disposable profiles and preserve personal sessions.

Useful temporary proof files (inspect before running, do not blindly replay)

- /private/tmp/amun-rev-ui.cjs inspects ONLY the disposable profile, checks connection and prints reconnect count.
- /private/tmp/amun-reconcile-approved.mts calls production read-only lookup for the approved page.
- /private/tmp/amun-scratch-lost-reply.mts simulates uncertainty in an in-memory DB then uses real MCP reads.
- /private/tmp/amun-refresh-proof.mts forces the due path for the disposable grant. It has already passed and that grant is now revoked.
- /private/tmp/amun-revoke-specific.mts already executed approved revocation. Do not repeat.
  Logs include /private/tmp/amun-focus-check.log, amun-focus-all-source.log, amun-focus-packaged.log and amun-google-final-package.log. /private/tmp is not durable storage; canonical evidence is committed.

TDD is explicit user scope. Demonstrate meaningful failure, implement, rerun, record tested revision and limitations. Domain/governance requires >=90% lines. Mocks do not establish live acceptance. Do not rerun expensive unrelated suites without reason.

## M0 and releases

Revised local M0 passed and merged. Release R001 is still open by explicit owner deferral: Apple Developer setup, signing/notarization (including native modules), notarized DMG and clean macOS-account install belong to later release acceptance, T057/M6. There is no notarized DMG claim. T010 scope was revised to secure preview/external handoff plus direct-login persistence; Google rejects embedded authentication and should use the external browser. Larger file/annotation/attachment features were deferred.

Full release map is in product-and-r1-plan.md section 2 and docs/TASKS.md.

- R1 is milestones M0–M6.
- M2 LOCKED until M1 gate resolved. Ordered tasks T023 products/source isolation; T024 file ingestion/provenance; T025 Firstmate product interview; T026 editable understanding and approval; T027 PRD editor/autosave/history/roundtrip; T028 generated PRD, modes, proposal review and version-bound approval; T029 RICE prioritization. Dependencies and exact acceptance are in TASKS. M2 exit is a real product objective to approved sourced PRD v1. Do not implement during M1.
- M3 backlog/sprint/ADO; M4 crew/PR/merge acceptance (T037 moved earlier); M5 memory/Notion sync/skills/portfolio/reminders; M6 chaos/accessibility/performance/signing/release report.
- R2 visual roadmap, Decision Room, RFP/proposals; owner's Transfrm.ai document hosting also later. Do not show these as working in R1.
- R3 personalization/team foundations/discovery; Docker MCP Registry, authenticated Google and live Obsidian acceptance are tracked under R3-DOCKER, R3-GOOGLE and R3-OBSIDIAN.
- Optional R4 T022e web OAuth callback, https://amun.transfrm.ai/mcp/callback. Existing GitHub device sign-in is sufficient for M1. No Worker client secret is needed now. Follow docs/evidence/M1/github-oauth-callback.md only when later authorized.
- R4/R5 broader teams/Windows/prerequisite installation and parity per full plan.

## External identities and repos

GitHub device OAuth app public client ID Ov23liy0rc9FOVsMe7Sd. Owner enabled device flow and disabled wildcard matching. Hosted MCP repo scope was explicitly reviewed. Company Copilot cloud host is tahaluf.ghe.com (enterprise URL /enterprises/tahaluf); company repository host ghes.tahaluf.ae is separate. Open company consent in Microsoft Edge.

Azure DevOps https://devops.tahaluf.ae/TahalufCollection/ICV is API/MCP only. Permitted acceptance names are test PBI, Test Stories or test tasks; never use Amun in ADO titles. Verify team/allowed records before additional writes.

Owner's hosting is https://amun.transfrm.ai under Cloudflare/transfrm.ai, deployed via hosted Cloudflare Code Mode. Existing Worker amun-origin-a941858ac1204b13. Each other user chooses their own host; never hard-code owner's domain as universal. Connectors should prefer supported official hosted MCP OAuth. Browser automation is not an integration mechanism.

Amun is Electron/TypeScript. Firstmate upstream is kunchenguid/firstmate, Pi @earendil-works/pi-coding-agent. Paseo getpaseo/paseo is reference for Pi commands, not an enabled backend. Third-party connector examples are not automatically trusted executable commands.

## Resume sequence

1. Verify macOS, real checkout, clean/preserved state, current branch/remote/PR heads and CI.
2. Use the open-entry table above and docs/TASKS.md. Keep Google and Obsidian live checks in R3.
3. Preserve the established Firstmate rules in AGENTS.md. Stow processes the selected conversation, crew memory, backlog and budget on-device. Ordinary edits apply automatically and individual pinned decisions persist. Primary supervision pauses on quit and reattaches surviving workers on reopen.
4. Keep the draft PR unmerged, M2 locked and redesign paused pending a new owner instruction.
