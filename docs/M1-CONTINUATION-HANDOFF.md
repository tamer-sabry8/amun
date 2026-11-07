# Amun interim M1 continuation handoff

Prepared 7 November 2026, Asia/Dubai, at the owner's explicit request for a fresh chat. This is an interim checkpoint. M1 and its final handoff task T022g remain incomplete.

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
- This handoff is committed immediately after those checkpoints. Use git log -1 and git ls-remote to get its exact latest hash. Do not assume 415df55 is the head.
- Last observed CI was pending. Recheck it. Never infer real Mac acceptance from CI.
- Checkout was clean before this handoff edit. Inspect status/remotes before fetch/pull. Preserve later local work. No reset, clean or force-push.

## Full plan and source precedence

docs/plans/product-and-r1-plan.md is the full product and R1 plan. docs/TASKS.md owns current milestones, scope changes and exit gates. Later explicit user decisions override original attachments and dated evidence. Read docs/decisions/ (particularly ADR-001, 004–011), docs/plans/m1-native-pi-commands.md and docs/plans/m1-user-journey-audit.md. docs/MAC-ACCEPTANCE-HANDOFF.md is historical M0 context. docs/evidence/M0-final-audit.md owns revised M0 acceptance. Old incremental notes below the task lists can be superseded.

## M1 tasks still needing completion/audit

- T016c passed. New source consent and restart confirmed the workspace after the earlier packaged lifecycle tests. See docs/TASKS.md.
- T016b passed. Normal Agents launch, subscription inference, lost receipt recovery and full-quit reattachment passed in source and package for both workers. See docs/evidence/M1/2026-11-07-agents-and-native-tree.md.
- T022a native UI for ALL requested Pi commands remains open. Use pinned Pi 1.4.0 interfaces and actual loaded resources. Many session/model/settings/auth/import/export/trust/tree/compose paths pass. Amun-owned prompt templates and skill drafts passed real source and packaged acceptance. The owner approved individually reviewed local executable extensions and normal Mac account permissions for explicit shell commands. Native text attachments, both shell prefixes, reviewed local extension commands, plain/file bearings and the pinned Calm toggle now have acceptance coverage. The native streaming queue and branch-only model/effort selection also passed source acceptance. Remaining Firstmate away/quiet, ahoy, stow, the interactive bearings board and composer parity remain open. Do not forward unsupported built-ins as model prompts.
- Native /llama live acceptance is explicitly BLOCKED because the owner has no llama.cpp router. Keep it tracked, continue independent work.
- T022d now includes all eight official Workspace servers and Maps tool discovery, folder-scoped read-only filesystem, and blank Chrome sessions through Playwright, Chrome DevTools and the archived Puppeteer adapter. Source and packaged acceptance passed. Obsidian loopback MCP setup is implemented and the owner deferred live vault testing. A separate mounted HFS+ filesystem passed folder acceptance. Account-specific Google reads and a physical external drive remain unverified. See docs/evidence/M1/2026-11-07-mcp-and-composer.md.
- T022c redesign awaits explicit approval. Appendix A dark theme is the chosen default. User's HTML reference supplies depth/layout ideas, not colors. Never start redesign just because it is on M1's list.
- T022g final handoff comes last after the separately approved redesign and actual gates. This interim file does not complete it.
- T022b sharing, T022f hosting, T037 amun-bridge (moved into M1), T022h staged Firstmate updates/rollback are checked. T013–T022 foundation tasks have recorded acceptance. Re-audit changing behavior and current CI.

## Most recent Notion result and safety rules

Owner-approved page is https://app.notion.com/p/4113581de3a9818b96e6d337a0d4f242 under Document Hub. Publication/action ID is af4ebf45-2c7d-4720-98b3-f63823e16f22. Its exact approved footer matches. Amun recorded succeeded/confirmed and the visible window showed success. Do not publish it again. The older same-title fixture is 4113581d-e3a9-81cc-9eaf-e236f2bdcd7c.

Persist the unique intent before sending. Track not sent / sent-unknown / confirmed. Never repeat create while sent-unknown. Reconcile by ID with backoff or a PM-supplied URL. Prefer a proven searchable page property, otherwise show a one-line footer in the exact approval preview. Document Hub currently uses the footer. Duplicate titles, missing/edited IDs and ambiguous matches cannot confirm. Production live fetch omits separate id sometimes; validate its canonical URL against requested identity. The read-only live lookup and an in-memory lost-reply ledger both confirmed the exact page with zero external writes.

Notion uses official hosted MCP browser OAuth, service-owned grant/Keychain, Edge or Dia. No token-entry onboarding. Pi /share is disabled with no gist/Radius fallback. Exact-content review is mandatory before every new publication.

Disposable OAuth lifecycle profile is named by /private/tmp/amun-notion-lifecycle-profile-path. Validate that it resolves under /private/tmp/amun-notion-lifecycle-* before use. Its registration was verified distinct from the working profile. Owner approved revoking only this grant. Notion returned HTTP 200. Production refresh then attempted once, cleared its local credential and returned reconnect-required. After the owner accepted the Keychain prompt, the packaged UI showed reconnect guidance. This disposable profile is intentionally disconnected. Do not ask the owner to sign it in again without a concrete new test.

Working profile /Users/tamersabry/Library/Application Support/Amun/M1-acceptance still read the approved page after revocation. Do not copy/delete grants or print credential records, access/refresh tokens, complete environments or browser cookies.

## Sessions, runtimes and testing

Read AGENTS.md. Preserve personal Herdr/Pi/Firstmate workers, homes, locks and installed versions. Firstmate operational homes MUST be real Git worktrees backed by Amun-owned repositories. Installed checkout is /Users/tamersabry/Projects/firstmate. Pi launchers live under ~/.pi/agent/bin/pi and ~/.local/bin/pi. Inspect current versions read-only. Official Amun-scoped CLI profiles have subscription sign-ins. Never assume every credential is portable.

Bundled Pi is 1.4.0. Current Firstmate pin is bf05a4f, retained rollback is 4a67799. Staged update procedure and approval rules are in AGENTS.md and docs/evidence/M1/2026-11-07-firstmate-candidate.md. Trust and verified Firstmate hooks can be automatically accepted only in disposable Amun-owned worktrees.

Use Node 24.22.1 and pnpm 11.25.0. Existing toolchain PATH prefix is /tmp/node-v24.22.1-darwin-arm64/bin:/tmp/amun-toolchain/node_modules/.bin. Verify availability. Read package.json and scripts first. pnpm check passed 430 unit tests plus lint/types/format. Source E2E passed 25 with one packaged-only skip. Five targeted final package tests passed (native Pi, Notion status/recovery, same-profile ownership). Packaged Google discovery also passed. A broader earlier package run used an intermediate build and failed the subsequently fixed focus assertion, so do not claim that run fully passed.

Final tested separate package is /private/tmp/amun-review-focus-probe/Amun-darwin-arm64/Amun.app; earlier lifecycle package /private/tmp/amun-owner-probe/Amun-darwin-arm64/Amun.app. The normal apps/desktop/out package may predate latest code. Do not overwrite a package under a running app. One profile should have one owner after the single-instance fix. Older running builds can still have duplicate owners. Do not terminate unknown/personal sessions.

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
- R3 personalization/team foundations/discovery; Docker MCP Registry explicitly deferred to R3-DOCKER.
- Optional R4 T022e web OAuth callback, https://amun.transfrm.ai/mcp/callback. Existing GitHub device sign-in is sufficient for M1. No Worker client secret is needed now. Follow docs/evidence/M1/github-oauth-callback.md only when later authorized.
- R4/R5 broader teams/Windows/prerequisite installation and parity per full plan.

## External identities and repos

GitHub device OAuth app public client ID Ov23liy0rc9FOVsMe7Sd. Owner enabled device flow and disabled wildcard matching. Hosted MCP repo scope was explicitly reviewed. Company Copilot cloud host is tahaluf.ghe.com (enterprise URL /enterprises/tahaluf); company repository host ghes.tahaluf.ae is separate. Open company consent in Microsoft Edge.

Azure DevOps https://devops.tahaluf.ae/TahalufCollection/ICV is API/MCP only. Permitted acceptance names are test PBI, Test Stories or test tasks; never use Amun in ADO titles. Verify team/allowed records before additional writes.

Owner's hosting is https://amun.transfrm.ai under Cloudflare/transfrm.ai, deployed via hosted Cloudflare Code Mode. Existing Worker amun-origin-a941858ac1204b13. Each other user chooses their own host; never hard-code owner's domain as universal. Connectors should prefer supported official hosted MCP OAuth. Browser automation is not an integration mechanism.

Amun is Electron/TypeScript. Firstmate upstream is kunchenguid/firstmate, Pi @earendil-works/pi-coding-agent. Paseo getpaseo/paseo is reference for Pi commands, not an enabled backend. Third-party connector examples are not automatically trusted executable commands.

## Resume sequence

1. Verify macOS, real checkout, clean/preserved state, current branch/remote/PR heads and CI.
2. Read docs/TASKS.md and docs/plans/m1-native-pi-commands.md for current coverage. The latest app build is /private/tmp/amun-m1-native-shortcuts/Amun-darwin-arm64/Amun.app from e440584. It includes reviewed extensions, workspace references and image drafts, public provider summaries, and native park/resume. The unit and coverage gates passed with 442 tests. A packaged live test confirmed the same subscription worker root PIDs and start times after app restart. The acceptance check ignores transient same-executable helper children while checking for new independent workers.
3. Continue the remaining Firstmate commands and native primary supervision in verified disposable Git worktrees. The owner's decision is to pause primary supervision on app quit and reattach surviving workers on reopen. Explicit captain shell commands use normal Mac account permissions. Each local executable extension requires individual review and trust.
   Two owner decisions are pending: whether the Lavish Bearings board opens in Amun or the external browser, and whether verified local maintenance by an unattended Firstmate can proceed automatically or each action needs a Request. The pinned unattended branch constructs its own shell tool. The captain’s terminal permission applies to directly initiated commands.
4. Complete unblocked remaining MCP gates; keep explicit non-gating/deferred items honest.
5. Keep redesign and M2 gated. Once independent M1 work is done, obtain explicit redesign approval with a concrete reviewable plan.
6. Update evidence/tasks and PR after tested increments. Final handoff and final M1 acceptance are later steps.
