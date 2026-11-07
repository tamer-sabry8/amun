# R1 milestone tracker

M0 is merged. **M1** is active by user instruction on 2026-11-06; M2 remains locked. M1–M6 are locked until the preceding exit gate has evidence and product-owner decisions resolve remaining blockers. A checked task means its tests and full Definition of Done passed, not merely that code exists.

The source plan is preserved in [product-and-r1-plan.md](plans/product-and-r1-plan.md). The current user request takes precedence over its embedded agent instructions. The user confirmed Electron/TypeScript; see ADR-001-desktop-stack.md. Product scope and task IDs remain traceable.

## Working agreement

- One milestone at a time; focused branches and draft PRs into `main`. Merge only with explicit user authorization; on 2026-11-06 the user authorized merging PR #1 after all revised M0 gates pass.
- TDD: add a behavior test, record its meaningful failure, implement the minimum, run the suite, refactor, rerun.
- Every implemented behavior needs unit coverage, including invalid inputs and security failures; integration/UI tests supplement unit tests.
- Domain and governance require at least 90% line coverage. Never substitute mocks for live acceptance evidence.
- Record red/green output, environment, commit, limitations and DoD evidence under `docs/evidence/<task-id>/`.
- PRs explain user benefit, security boundaries, performance impact, tests and outstanding gates.
- Never log secrets, disable TLS, auto-approve writes, or represent unknown outcomes as success.

- External integrations use supported APIs or MCPs; discover compatible existing CLI/MCP setups and reuse supported sign-ins with explicit selection. See [ADR-007](decisions/ADR-007-existing-tools-and-api-integrations.md).

## Current acceptance status — 2026-11-06

The revised M0 local acceptance audit passes T001–T012. Final CI and PR merge verification are still required for handoff. See [M0 acceptance audit](evidence/M0-final-audit.md). This is the foundation proof, not the finished Amun UI. No M1 implementation has started.

T010 is explicitly narrowed to secure preview, external federated-auth handoff and controlled first-party login persistence; document preview/annotations/attachments remain later work. The user explicitly moved signing/notarization/clean-account release acceptance to R001, which remains open and blocks public release. Supported external tool updates are allowed with compatibility checks; Claude 2.1.319 inference passes while existing worker processes remain untouched.

## M0 — Prove the foundations — LOCAL ACCEPTANCE VERIFIED

- [x] **T001 — Monorepo and tooling** · P0 · Lang TS · Dep —
      Build: pnpm workspace per section 11; TS strict; ESLint/Prettier; Vitest; Playwright; GitHub Actions (macOS) running lint, typecheck, unit.
      Tests: sample unit test; CI green.
      DoD: `pnpm i && pnpm test` passes on a clean clone; CI badge green.
- [x] **T002 — Contracts package** · P0 · TS · Dep T001
      Build: zod schemas for RPC methods, attention item, notification, status activity, action, approval, run; generated TS types.
      Tests: schema round-trip and rejection tests.
      DoD: UI, service and bridge import only from `packages/contracts` for cross-process types.
- [x] **T003 — ADR and evidence templates** · P0 · Markdown · Dep T001
      DoD: `docs/decisions/ADR-000-template.md`, `docs/evidence/README.md`.
- [x] **T004 — Electron shell + secure renderer** · P0 · TS · Dep T001
      Build: Electron Forge + Vite; main, preload (minimal), renderer with contextIsolation/sandbox/CSP.
      Tests: Playwright launches app; test asserts `window.require` undefined and CSP present.
      DoD: app opens a window with the empty shell.
- [x] **T005 — Service process + MessagePort RPC** · P0 · TS · Dep T002, T004
      Build: `utilityProcess` service; typed request/response + event stream over MessagePort; health method; restart on crash with backoff.
      Tests: RPC round-trip; service crash → UI shows "Reconnecting" → recovers.
      DoD: kill service PID during E2E; UI recovers in < 5 s.
- [x] **T006 — Bundled Pi in RPC mode** · P0 · TS · Dep T005
      Build: `runtime/pi` pinned package + lockfile; spawn via Electron-as-Node (`ELECTRON_RUN_AS_NODE`) or bundled Node (decide by spike; record ADR); env `PI_CODING_AGENT_DIR`, `PI_SKIP_VERSION_CHECK=1`; JSONL client splitting on LF only (do not use Node `readline`); request ids; event stream; `extension_ui_request` → Amun request.
      Tests: replay fixtures for `get_state`, `get_available_models`, prompt streaming, extension UI select/confirm; live: `pi auth check --json` per provider.
      DoD: packaged app, no global Pi on PATH, lists Copilot and OpenRouter models after Amun-scoped sign-in.
- [x] **T007 — Firstmate home management** · P0 · TS + Bash (existing) · Dep T006
      Build: `runtime/firstmate` pinned snapshot; create Amun-managed home under `~/Library/Application Support/Amun/firstmate/<home>`; import overlay from an existing home (backend, crew-dispatch.json, claude-permission-mode forced to `auto`, secondmate-harness, skills); project trust for its `.pi/extensions`; never write into the user's personal home.
      Tests: overlay merge unit tests; live: Firstmate starts in the managed home; watcher extension loads; personal home untouched (hash before/after).
      DoD: ADR documents which Firstmate behaviours work under RPC and which need fallback (interactive TUI in a backend pane).
- [x] **T008 — Crew observation and reattach** · P0 · TS · Dep T007
      Build: adapter reading Firstmate task records and Amun-managed backend state (non-Herdr; discover format first; document it); map to `runs`; detect `unknown` after restart; reattach by recorded backend pane + worktree; never spawn.
      Tests: fixtures of recorded Firstmate and selected backend state; live: dispatch Codex + Claude workers, restart service, reattach.
      DoD: zero duplicate workers across 10 restart trials; unknown state shown when unverifiable.
- [x] **T009 — Azure DevOps proof** · P0 · TS · Dep T005
      Build: client on azure-devops-node-api with explicit `api-version=7.0`; PAT from Keychain; `NODE_EXTRA_CA_CERTS` support; read projects/teams/process/work items; create story + task; update with JSON Patch `test /rev`; read iterations; read Azure Repos PRs.
      Tests: MSW fixtures; live `@live` against the Tahaluf test project.
      DoD: evidence of created IDs; stale-revision update returns conflict and is handled; supported-endpoint matrix recorded.
      Local acceptance: ICV Test PBI #1088026 and Test Task #1088027; both revision updates and stale rejections proved. See [T009 evidence](evidence/T009/README.md).
- [x] **T010 — Browser view proof** · P1 · TS · Dep T004
      Build: WebContentsView in the inspector slot; per-product partitions; navigation controls; permission handler; popup handling; SSO redirect test.
      Tests: page script cannot access `ipcRenderer`, Node or Amun ports; Playwright.
      DoD (user-revised 2026-11-06): controlled first-party direct login persists across app restart, separate product remains signed out; local prototype renders; known federated-provider navigation is blocked and explicitly handed off externally; security tests green. No arbitrary SSO compatibility claim.
- [x] **T011 — Terminal dock proof** · P1 · TS · Dep T005
      Build: node-pty in service (rebuilt for Electron ABI), xterm.js in renderer, resize, scrollback; "attach to backend pane" mode (read-only default, explicit take-control).
      Tests: echo/resize tests; packaged-app test.
      DoD: works from Finder launch without inheriting an interactive shell environment.
- [x] **T012 — Packaging and performance baseline** · P1 · TS · Dep T004–T011
      Build: unsigned development package; include pinned Pi and Firstmate snapshot and native modules; record release prerequisites.
      Tests: source and packaged runtime/native checks; measure cold start, total RAM and applicable interaction latency. Clean-account release testing is deferred by explicit user decision on 2026-11-06.
      DoD: tested unsigned development package and measured budgets/limitations recorded in ADR. Signing, notarization, signed native modules, notarized DMG and clean-account release acceptance remain mandatory before public release, deferred by explicit user decision on 2026-11-06.
      **M0 exit gate:** every item in the M0 DoD has evidence; failures become product-owner decisions before M1.

## M1 — Durable core and shell — ACTIVE

Evidence for T013–T015: [durable core acceptance](evidence/T013/2026-11-06-durable-core.md).

- [x] **T013 — Database and migrations** · P0 · TS · Dep T002
      Build: Drizzle schema for section 8.6; migrations; FTS5 for search.
      Tests: migrate up from every prior version with seed data.
      DoD: data survives app upgrade test.
- [x] **T014 — Governance engine** · P0 · TS · Dep T013
      Build: action and approval state machines (8.4); payload hash (canonical JSON); target-revision binding; invalidation triggers; separate approval kinds (publish, commit, merge, notion_publish, file_destructive, skill_install, model_outside_allowlist).
      Tests: exhaustive state-transition tests; property tests for hash stability.
      DoD: ≥ 90% coverage; mutating a payload after approval always invalidates.
- [x] **T015 — Outbox and reconciliation framework** · P0 · TS · Dep T014
      Build: outbox table written in the same transaction as the action; worker (liteque or in-house); per-connector `reconcile(operationMarker)`; never auto-retry `unknown` merges/creates without reconciliation.
      Tests: crash between write and ack; duplicate-suppression tests.
      DoD: chaos test "kill after remote write, before local ack" produces no duplicate.
      Foundation history: [initial evidence](evidence/M1/2026-11-06-foundations.md). Current T017–T022 acceptance: [source and packaged shell evidence](evidence/M1/2026-11-06-shell-acceptance.md). T016 live Copilot/OpenRouter authorization and packaged inference now pass; M1 remains open for T016b and T022a. PR CI at a87fe2e passed; later changes require their own verification.

- [x] **T016 — Auth broker** · P0 · TS · Dep T006, T013
      Build: Keychain storage (@napi-rs/keyring); Pi provider sign-in UI (Copilot, OpenRouter, OpenAI/Codex, API keys) driven through Pi (pi-ai login via bridge/CLI) into the Amun-scoped Pi dir; readiness via `pi auth check --json`; ADO PAT; GitHub (device flow / PAT; GHES host); Notion hosted MCP browser OAuth (replacement tracked in T016c; prior token foundation is not current acceptance); refresh lock (proper-lockfile).
      Tests: unit with fake keyring; live sign-in for Copilot and OpenRouter; Claude subscription option absent.
      DoD: all connections show independent status; secrets only in Keychain or the 0600 Pi dir.
- [x] **T016a — Reliable provider sign-in feedback** · P0 · TS · Dep T016
      User-reported 2026-11-06: successful Copilot sign-in shows configured while an old connection-error banner remains. Clear stale errors/device codes on success or a fresh attempt; preserve current failure feedback; prevent duplicate login/readiness while an attempt is active. Force Microsoft Edge for provider authorization; explain Copilot cloud host versus GitHub repository host. Tests: meaningful failing regressions, source and packaged acceptance, real company Copilot sign-in and inference. Status: implementation, unit/source checks and final packaged auth tests pass; see [auth evidence](evidence/M1/2026-11-06-copilot-tenant-fix.md). Copilot authorization and packaged gpt-5.4-nano inference passed in the separate M1 profile.

- [ ] **T016c — Notion hosted MCP browser connection** · P0 · TS · Dep T016
      User decision: external-browser OAuth through official hosted MCP, no manual-token onboarding. Implement pinned SDK discovery/registration/PKCE, validated loopback callback, durable registration reuse, Keychain-only credentials, cross-process refresh serialization, terminal invalid_grant, disconnect and safe status. Test source and packaged real-workspace consent/read; do not equate this chat's connector with Amun's connection. Unknown tools blocked, uncertain writes never retried automatically. [Stress-tested decision](decisions/ADR-011-hosted-mcp-auth.md). Packaged Edge consent in a disposable profile passed. Twenty simultaneous checks at the refresh threshold produced one live refresh, one rotated credential save and verified workspace identity. A synthetic invalid credential produced a real invalid_grant response without retry or browser launch. The owner approved revocation of the separately registered disposable grant. Notion accepted it, one real refresh failed and Amun returned reconnect-required and cleared the disposable credentials. A read confirmed the working profile still reaches Document Hub. After the owner allowed the Keychain prompt, the packaged disposable window displayed the reconnect message. The Notion connection lifecycle evidence is recorded; audit all T016c requirements before changing its checkbox. T037 is in M1. T048/T049 remain later work.

- [ ] **T016b — Subscription-backed Codex and Claude CLI access in M1** · P0 · TS · Dep T016, T020
      Explicit user requirement 2026-11-06: use Codex CLI through the user's ChatGPT/Codex subscription and Claude Code CLI through the user's Claude subscription; do not substitute API keys. Discover installed capabilities/versions and reuse the existing isolated Amun worker profiles through official CLI mechanisms, preserving personal sessions and Keychain behavior. Provide native Amun sign-in/status/launch controls with Microsoft Edge for company-required browser flows. Distinguish Pi's supported OpenAI/Codex OAuth model provider from actual Codex CLI worker execution; do not invent Claude subscription OAuth in Pi where the pinned provider does not support it. Tests: real CLI authentication status and bounded no-tool inference for both subscriptions, native UI behavior, worker ownership/permission propagation and reconnect; no credential values in logs/IPC. Earlier M0 CLI evidence is reference, not automatic M1 acceptance. Native sign-in entry points and actual packaged existing-subscription reuse now pass; fresh missing-profile OAuth and real inference now pass for both CLI subscriptions using the packaged helper and separate UUID-scoped profiles. Normal Agents reattachment, propagated launch permissions and ten restart trials per build pass with the two real workers. Normal persistent crew dispatch and initial receipt creation remain open. [M1 reattachment evidence](evidence/M1/2026-11-07-agents-and-native-tree.md). [Fresh onboarding and journey evidence](evidence/M1/2026-11-07-native-journeys.md). See [native CLI evidence](evidence/M1/2026-11-06-native-cli-login.md).

- [x] **T017 — Audit and redaction** · P0 · TS · Dep T013
      Build: audit_log writer; pino redaction; export redaction.
      Tests: canary-secret test across logs, exports, memory, updates.
      DoD: canary never found.
- [x] **T018 — Backup and restore** · P1 · TS · Dep T013
      DoD: encrypted export/import of a workspace; secrets excluded; restore test passes.
- [x] **T019 — Design tokens and themes** · P0 · TS/JSON · Dep T001
      Build: DTCG tokens for Tamer Sabry default, Navy Gold, Navy Cyan (values from the brand table in Appendix A); Style Dictionary → `--amun-*` CSS variables; locked safety tokens; contrast validator.
      Tests: contrast unit tests (≥ 4.5:1 text, ≥ 3:1 UI); theme switch persists.
      DoD: all component states render in three themes.
- [x] **T020 — App shell layout** · P0 · TS/React · Dep T005, T019
      Build: sidebar (switcher, ⌘K, 6 fixed tiles, nav, pinned tabs, artifacts), top bar with mode tabs, Focus and the status pill slot, workspace router, right edge in fixed order (status rail, drawer layer, single-slot inspector with Issue/Web tabs), composer, terminal dock, Focus mode with exact restore.
      Tests: Playwright layout + keyboard navigation; axe.
      DoD: no auto-reordering of tiles; inspector and drawers never open without user action; drawers overlay without layout shift.
- [x] **T021a — Firstmate Island (action queue)** · P0 · TS/React · Dep T002, T013, T020
      Build: attention-item store and contract (5.3); item types; origin labels (Firstmate / Secondmate / Crewmate / Amun); ordering; Rail, Pill, Card, Expanded sizes; "+N more"; snooze; navigate vs inline modes; governed items always navigate; removal only on resolution or snooze; live region; ⌘⇧J; reduced motion; empty state.
      Tests: unit for ordering, resolution and snooze rules; test that a governed item can never resolve from the Island; visual baselines for every type × size × theme; a11y.
      DoD: gallery page in the dev build shows all combinations; clicking an item and navigating away leaves it open.
- [x] **T021b — Status pill, status rail and drawers** · P0 · TS/React · Dep T002, T020
      Build: top-bar status pill (counts, colour states, click pins Activity); right rail with Notifications, Activity, Artifacts, Downloads, Skills and extensions; drawer layer with 150 ms hover intent, 250 ms close grace, click to pin, ⌥⌘1–5, Esc, focus management; one drawer at a time; overlay without layout shift; tap = pin.
      Tests: Playwright hover-intent and pin tests; keyboard-only test; one-drawer rule; a11y; visual baselines per drawer × theme.
      DoD: run and publication progress appear only in the pill and Activity drawer, never in the Island.
- [x] **T022 — Requests and command palette** · P1 · TS · Dep T020
      DoD: Requests history (open and resolved, filters) whose badge equals the Island count from the same query; ⌘K searches entities and runs commands.

- [ ] **T022a — Pi slash commands in M1** · P0 · TS · Dep T006, T016, T020
      Explicit user scope addition 2026-11-06: native Amun UI for every command, no terminal fallback. Include the attached user-facing Pi prefixes/shortcuts and Firstmate skill commands; CLI flags and internal toolbelt scripts are implementation references. Verify the full built-in command list against pinned Pi 1.4.0 and loaded session resources; provide usable supported command paths for models/settings/auth, sessions/context, export/share, runtime/project, extensions, templates and skills. Document RPC/SDK/interactive-only differences; never fake completion or send unsupported built-ins as model text. Commands operate only on Amun-owned sessions/configuration. Pi native /share is disabled with no gist/Radius fallback (ADR-010). Conversation Share to Notion is tracked in T022b; review content before any permitted bug-report upload. Tests: per-command routing, invalid inputs, permissions and isolation; source/packaged real-session acceptance. Remains open until the full requested command coverage is verified; does not authorize M2. [Native coverage ledger](plans/m1-native-pi-commands.md). [Journey and placement audit](plans/m1-user-journey-audit.md): conversation tools/sharing belong in Conversations, subscription setup in Settings; full conversation reading/composing, visible receipts and return-from-connection flows remain open. Native session lifecycle, copy/export review, selected runtime settings, trust, changelog, model scope/cycling and CLI status/inference pass recorded source and packaged acceptance at d763366. Remaining command families are not complete. User confirmed 2026-11-07: no llama.cpp router is available; native `/llama` live acceptance is explicitly BLOCKED, not waived. Continue independent command work. See [subscription and session evidence](evidence/M1/2026-11-06-subscription-and-native-sessions.md).

- [ ] **T022d — Native MCP connections** · M1. GitHub hosted MCP read/write with separate browser authorization and reviewed writes. Use Google’s separate hosted Gmail, Drive and Calendar MCP endpoints. Community or archived Google connector repositories are unnecessary. Google OAuth and authenticated reads for Gmail, Drive and Calendar remain tracked as a non-gating follow-up by the owner’s decision. M1 may exit with this follow-up open. Sheets is an earlier request outside this three-service sign-in check. Maps, Cloudflare docs, Playwright, Chrome DevTools, Obsidian, scoped local/external disk folders and the requested archived Puppeteer adapter are tracked separately. No Chroma. Archive status is not acceptance. No inherited browser sessions, arbitrary discovered commands or whole-disk default. Packaged GitHub OAuth and an authenticated MCP read of the Amun manifest from main pass. GitHub required the explicitly reviewed repo scope. Packaged exact-review creation of GitHub issue #3 and independent read-back passed on 7 November. Packaged Gmail, Drive and Calendar server initialization and tool listing also pass. User-authorized Google account reads remain a non-gating follow-up. Other connectors remain open. Obsidian live test awaits installation and vault. See [connector evidence](evidence/M1/2026-11-07-mcp-and-composer.md).
- [x] **T022b — Conversation Share to Notion** · P0 · TS · Dep T014, T015, T016, T022a
      User decision 2026-11-06: Notion is the R1 sharing default. Disable native Pi share server-side; no gist/Radius fallback. Provide selected-conversation secret removal, exact final-content preview, user-chosen Notion parent section, approval bound to content/destination, and new-page publication through the supported API/MCP boundary. No uncertain-write automatic retry. Keep publishing blocked until an Amun Notion connection and parent are configured. Native refusal, redacted preview, verified parent selection and durable exact-review approval are implemented and tested. Hosted MCP sign-in, saved-grant reuse and Document Hub schema verification pass in the packaged app. Live publication is now verified: the user approved the exact fixture at 05:04 +04 on 2026-11-07, Amun stored a succeeded action and receipt, and read-back confirmed its title, content and Document Hub destination. A workspace-scoped activity validation bug caused a misleading banner during publication; its regression and journey fixes are recorded in the evidence. Startup reconciles interrupted writes with a matching saved receipt. Conversations lists unconfirmed publications separately. Amun persists a unique publication ID before sending and tracks not sent, sent-unknown and confirmed. Unknown sends are reconciled by read-only lookup with backoff or a PM-supplied page URL. A verified searchable text property takes precedence over a visible footer in the exact review. Duplicate titles and edited or missing references cannot establish identity. The second approved, same-title Document Hub fixture passed live recovery by ID through Amun’s own hosted MCP connection. A disposable sent-unknown ledger restored its receipt with zero external writes. The remaining Notion connection lifecycle checks belong to T016c. Later PRD/decision/update sharing remains in its own milestone; Transfrm.ai is R2 reference only. [ADR-010](decisions/ADR-010-notion-sharing.md).

- [x] **T022f — Set up Amun hosting with Cloudflare Code Mode** · M1 · Use Cloudflare’s hosted API MCP with browser consent. Discover the zone and existing routing for `amun.transfrm.ai`. Review the exact proposed deployment and DNS changes, apply them through Code Mode, and verify DNS, TLS, and the intended route from the Mac. This hostname belongs exclusively to Tamer’s setup. Each other workspace chooses its own hosting provider and hostname. Record the deployed revision and rollback steps. GitHub MCP uses the verified device sign-in in M1.

- [x] **T037 — amun-bridge Pi extension** · P0 · TS · Dep T006, T014 — Build: Unix-socket client with token; `tool_call` hook: classify tool by Amun's own registry; governed/unknown → create action, return block with action id; handler errors block; Amun tools (`amun_get_context`, `amun_propose_backlog_publication`, `amun_propose_sprint_commitment`, `amun_request_merge`, `amun_raise_decision`, `amun_report_blocker`); event forwarding. Tests: direct and codemode-nested MCP write attempts are blocked; a tool claiming `readOnlyHint` but registered as governed is blocked; extension that replaces `/mcp` detected and reported. DoD: test matrix green on live Pi.

      [Live bridge matrix](evidence/M1/2026-11-07-pi-bridge.md).

- [x] **T022h — Staged Firstmate updates and rollback** · M1 · Native candidate discovery, disposable Git worktree, selected overlay, Pi replay, amun-bridge approval tests, and real Codex/Claude dispatch through isolated Herdr with restart recovery. Require exact revision and checksum, a human-readable report and explicit promotion approval. Preserve the previous verified pin for one-click rollback. T037 passed. The owner approved the exact candidate after a real packaged rollback trial. The active pin is `bf05a4f` and the retained offline pin is `4a67799`. The native rollback action applies to newly prepared worktrees. [Candidate evidence](evidence/M1/2026-11-07-firstmate-candidate.md).

- [ ] **T022c — Accessible neumorphic interface redesign — AWAITING USER APPROVAL** · P1 · TS/React · Dep T017–T022, T022a, T022b
      User correction 2026-11-06 22:51 +04: do not begin design or implementation until explicitly asking and receiving approval. The initial uncommitted styling experiment was reverted; no redesign is enabled. After approval, redesign the M1 interface using the supplied neumorphic HTML as a reference for raised controls, recessed fields, rounded surfaces and restrained depth. Ignore its colors; preserve the approved Appendix A dark default and existing theme alternatives. Apply consistently to navigation, settings, native Pi commands, review sheets, Firstmate Island and utility rail/drawers. Preserve actual application behavior, native window controls, keyboard focus, contrast, selected/disabled/error states, reduced motion and overlay drawers without layout shifts. Do not import mock data, inline handlers, CDN scripts or fake connection statuses from the reference. Tests: source and packaged keyboard/a11y checks, all theme states, resize/overflow, and reviewed visual evidence. Remains open until implementation and acceptance pass.

- [ ] **T022g — Final handoff to a new chat** · Last M1 task, after the separately approved T022c redesign. Include verified branch and PR heads, acceptance evidence, outstanding M0 release gates, each unresolved M1 gate and its next action, local profile/worktree instructions, and the ordered M2 plan (T023–T029) with dependencies and exit criteria. Prepare the handoff against the actual final state. The owner requested an interim fresh-chat handoff before completing M1 on 7 November. See M1-CONTINUATION-HANDOFF.md. This interim checkpoint does not complete T022g.

## M2 — Product context and PRD — LOCKED

- [ ] **T023 — Products and source mapping** · P0 · TS · Dep T013, T020 — DoD: two products with isolated sources, models and memory.
- [ ] **T024 — Document ingestion** · P0 · TS · Dep T023 — Build: TXT, MD, text PDF, DOCX, PNG/JPEG; others fail with clear message; provenance rows. DoD: supported-format matrix published in docs.
- [ ] **T025 — Product interview via Firstmate** · P0 · TS · Dep T006, T024 — Build: Firstmate questions surfaced as Requests; answers stored with provenance. DoD: live interview on a real product.
- [ ] **T026 — Product understanding review** · P0 · TS · Dep T025 — DoD: facts/assumptions/questions editable; approved version used by later prompts (verified by prompt log).
- [ ] **T027 — PRD editor** · P0 · TS/React · Dep T020 — Build: Tiptap schema, Markdown mode via remark, autosave, history, stale-edit detection, import/export. Tests: round-trip corpus (headings, lists, tables, checklists, links, inline marks); unsupported formatting warns. DoD: round-trip suite green.
- [ ] **T028 — PRD generation, modes, review and approval** · P0 · TS · Dep T014, T026, T027 — Build: draft from objective; Write/Research/Review modes; selection HUD; inline proposal diffs; approval bound to version; invalidation explains affected work. DoD: live PRD approved; edit after approval invalidates.
- [ ] **T029 — RICE prioritisation** · P1 · TS · Dep T023 — Tests: formula, units, empty/zero/negative handling. DoD: "Priorities" tile shows ordered table.
      **M2 exit:** Live demo: objective → approved PRD v1 with sources in a real product.

## M3 — Backlog and sprint on Azure DevOps — LOCKED

- [ ] **T030 — ADO discovery and read model** · P0 · TS · Dep T009, T013 — Build: process/type/field/state/area/iteration/board-column discovery with caching; paging; permissions. DoD: Tahaluf test project rendered correctly in Backlog (list + board).
- [ ] **T031 — Story generation from PRD** · P0 · TS · Dep T028, T030 — Build: proposed hierarchy with requirement links; unknown required fields block publication. DoD: every story traces to a requirement.
- [ ] **T032 — Decision requests on items** · P0 · TS/React · Dep T021a, T031 — Build: AM-106 pattern: options, Firstmate proposal (Unapproved), missing confirmations, Save / Request confirmation / Later / Resolve. DoD: resolving updates the linked requirement and story.
- [ ] **T033 — Publication preview and execution** · P0 · TS · Dep T014, T015, T031 — Build: exact preview; approval; execution with operation marker (e.g. a tag or field agreed in M0) per item; Publication tracker activity. Tests: chaos network drop after item 3. DoD: zero duplicates; created IDs reported; sprint not committed.
- [ ] **T034 — Board and detail editing** · P1 · TS · Dep T030 — DoD: edits/moves respect board mapping and revisions; failures preserve edits.
- [ ] **T035 — Sprint planning and commitment** · P0 · TS · Dep T033 — Build: iteration selection; manual assignees; separate commitment approval; post-execution verification. DoD: publishing cannot commit implicitly; final server state matches approval.
- [ ] **T036 — Story blockers in Decisions tile** · P1 · TS · Dep T032 — DoD: reason, owner, age, next action listed.
      **M3 exit:** live publication + commitment on the Tahaluf test project with chaos test evidence.

## M4 — Firstmate, crew, PRs, acceptance — LOCKED

- [ ] **T038 — Firstmate conversation and composer** · P0 · TS · Dep T006, T037 — DoD: composer sends with selected-item context; streaming; steer/follow-up; never approves anything.
- [ ] **T039 — Model routing matrix** · P1 · TS · Dep T016, T038 — Build: per-product allowlist; task/difficulty matrix; actual model recorded per run; switching outside allowlist requires approval. DoD: Copilot and OpenRouter routes exercised live.
- [ ] **T040 — Crew view** · P0 · TS/React · Dep T008 — Build: hierarchy and list; status counts; selected agent panel (current task, needs decision, up next, recent work, access scope, history). DoD: matches Firstmate and Amun-managed backend state live.
- [ ] **T041 — Delegation and run tracker** · P0 · TS · Dep T037, T040 — Build: "Ask Firstmate to implement" with scope approval; run tracker activity; blocked → decision → resume. DoD: live run from story to PR link.
- [ ] **T042 — Prototype path** · P1 · TS · Dep T010, T041 — Build: bounded prototype run; preview in browser; feedback bar → PRD change proposals. DoD: feedback becomes accepted PRD change.
- [ ] **T043 — Terminal attach** · P2 · TS · Dep T011, T040 — DoD: read-only attach to a worker pane; take-control logged as user activity.
- [ ] **T044 — PR workspace** · P0 · TS · Dep T009, T016 — Build: Azure Repos (node-api) and GitHub/GHE (Octokit) adapters; cross-repo list; summary; Monaco diff; checks; reviews; threads; review actions with provider semantics. DoD: required workflow executed on each pilot provider; unsupported actions hidden, not faked.
- [ ] **T045 — Merge approval and execution** · P0 · TS · Dep T014, T044 — Build: approval bound to repo, PR, head SHA, merge method; execution re-checks SHA, policy, checks, permission; GitHub `expectedHeadOid`/`sha`; ADO completion with last merge source commit. Tests: change head after approval → refused. Live: worker identity cannot merge or force-push (server rejects). DoD: evidence for both.
- [ ] **T046 — Acceptance** · P0 · TS · Dep T045 — DoD: checklist + recorded Accepted/Rejected/Blocked; acceptance separate from merge.
      **M4 exit:** golden path (section 6) passes live, including restart-reattach and changed-head refusal.

## M5 — Memory, Notion, skills, portfolio, reminders — LOCKED

- [ ] **T047 — Portfolio** · P1 · TS · Dep T023, T036 — DoD: progress, blockers, decisions across ≥ 2 products; inferred dependencies labelled until confirmed.
- [ ] **T048 — Notion connector and publish** · P0 · TS · Dep T016, T015 — Build: notion-sdk-js; native Markdown endpoints; rate-limit handling; 503-after-commit reconciliation via `committed_resource_id`. DoD: approved publish to a test page; no duplicate on simulated 503.
- [ ] **T049 — Notion two-way memory sync** · P0 · TS · Dep T048 — Build: sync_links baseline; field mapping UI; conflict side-by-side; delete/unlink/keep prompt; offline edits retained. DoD: simultaneous edit, deletion, revoked access and offline tests pass.
- [ ] **T050 — Tasks and reminders** · P1 · TS · Dep T013, T021a, T021b — DoD: reminders during sleep appear on resume; consequential work awaits approval.
- [ ] **T051 — Skills library** · P1 · TS · Dep T014 — Build: curated skills; editor; external discovery from configured sources; preview; pinned hash; approved install/update; rejected install cannot execute. DoD: install/update/reject tests green.
- [ ] **T052 — Stakeholder updates** · P1 · TS · Dep T046, T048 — DoD: draft cites source records; unknowns marked; approved publish/export.

## M6 — Hardening and release — LOCKED

- [ ] **T053 — Chaos suite** · P0 — all scenarios in section 12.
- [ ] **T054 — Accessibility and keyboard** · P0 — zero serious/critical axe findings in three themes; keyboard golden path.
- [ ] **T055 — Visual baselines** · P1 — approved screenshots for all Island item types and sizes, each drawer, the status pill, and key screens.
- [ ] **T056 — Performance** · P1 — budgets from T012 met.
- [ ] **T057 — Release packaging** · P0 — notarized DMG with pinned Pi + Firstmate; clean-account install; prerequisite checks for the verified non-Herdr backend, Claude Code, Codex.
- [ ] **T058 — R1 acceptance report** · P0 — F01–F23 each linked to evidence; residual limitations named; product-owner sign-off.

## R3 — Expansion backlog

- [ ] **R3-DOCKER — Docker MCP Registry integration** · Select a catalog server for a concrete use case, review its permissions, pin the tested version and verify a scoped operation in an isolated Amun profile. Schedule selection and testing in R3.

## R4 — Optional improvements

- [ ] **T022e — Provision and verify the registered GitHub web callback** · Optional R4 follow-up by owner decision on 7 November 2026. M1 uses GitHub device sign-in. No hosted callback or Worker client secret is required for M1. Target `https://amun.transfrm.ai/mcp/callback`. The approved initial origin now resolves and rejects invalid callbacks over HTTPS. The owner confirmed disabling wildcard matching on 7 November. Deploy a transaction-bound callback, verify public DNS/TLS, complete web authorization from packaged Amun, and test invalid state, cancellation and replay. Device-flow acceptance is tracked separately in T022d. [Setup and acceptance steps](evidence/M1/github-oauth-callback.md).

## Local acceptance continuation

- T006: packaged OpenRouter inference passed; provider-specific GitHub Copilot OAuth proof is tracked separately. Renderer streaming/dialog integration remains open.
- T007: actual Pi-owned lock and fresh real watcher pass in source and packaged CLI-entry execution; wake/recovery and policy propagation remain open.
- T010: local prototype/redirect/security tests pass in source and packaged apps. Azure DevOps is prohibited as its browser test target; real authenticated browsing remains open. The GitHub → Google sign-in attempt was rejected by Google in the embedded browser; see T010 evidence.
- T011: native service PTY + xterm echo/resize/read-only tests pass source and packaged. Verified worker attachment and real Finder launch remain open.
- T012: measured provisional process-start, working-set and terminal-echo baseline; signing/notarization and clean-account installation remain open.

## Further local M0 continuation

- T006: strict service-to-renderer text/dialog projection and real offline Pi select/confirm round-trip now pass source and packaged Electron tests. Authenticated in-app provider selection remains open; see evidence/T006/service-boundary.md.
- T007: checksum-guarded Amun-only bundled patch fixes actual home-to-home Codex restricted-mode propagation, verified in source and package. Personal Firstmate remains untouched; actual worker approval behavior remains open.
- T008: private endpoint receipts and read-only tmux identity observation implemented and unit-tested. Ten fresh observer processes preserve one synthetic pane; worker status deliberately remains unknown. Real Codex/Claude dispatch and ten service-restart trials are still required.
- T010: explicitly blocked at the user's request. GitHub uses Google sign-in only; no more browser acceptance attempts are pending. Continue other M0 work.

## Authenticated UI and worker sign-in continuation (2026-11-06)

- T006: source and packaged service/renderer inference now pass for OpenRouter and GitHub Copilot with empty PATH, model projection and personal credential file unchanged. Real service crash removes the temporary Pi credential directory. See [evidence](evidence/T006/authenticated-ui.md). Final task audit remains open.
- T008: official Codex sign-in succeeded in a separate persistent Amun profile; a real read-only ephemeral inference completed with the exact expected reply. This does not prove Firstmate dispatch or reattachment. Claude's separate official sign-in is still pending.
- T010 remains blocked at the user's request; no further embedded sign-in attempt is required to continue other M0 work.

- T007: actual copied-home dispatch failure exposed the Git worktree requirement. Amun-owned snapshot Git store + genuine worktree provisioning is now tested, and real Firstmate Codex spawn succeeds; see [worktree evidence](evidence/T007/git-worktree-homes.md).
- T008: official isolated Codex and Claude sign-ins and real no-tool inference now pass. Firstmate worker completion and ten service-restart reattachment trials remain open.

## Current acceptance checkpoint (2026-11-06)

- T006 complete for M0: bounded service/UI model, stream and select/confirm handling; real source/packaged OpenRouter and GitHub Copilot inference with empty PATH; explicit selected Pi credential reuse and crash cleanup. See T006/authenticated-ui.md. General auth/onboarding remains later scope.
- T007: real Git worktree ownership and explicit watcher stop/rearm pass source/package. Existing configuration import and 63 tracked skill files + one internal link are verified without changing personal files. Actionable wakes and automatic recovery remain open.
- T008: real Codex + Claude dispatch and ten real service restarts each in source/package pass with stable worker PIDs/start times and zero duplicates. Production dispatch/receipt publication and Run mapping remain open; worker semantic state remains unknown.
- T011: actual worker attachment, native read-only default, explicit control, resize, ownership-loss refusal and client-only detach pass source/package. Finder manual result confirmed by the user: FINDER_OK and 24 80; T011 complete.
- T012: current process-cold/warm-cache launches 322/317/330 ms, summed Electron working set 481 MiB, echo 13/13/12 ms. Clean-account installation and signing/notarization remain open.
- Personal CLI version issue: Claude's updater changed its shared launcher from 2.1.311 to 2.1.319 during the first worker run. The user approved retaining 2.1.319 and supported external-tool updates; updater overrides were removed and fresh isolated 2.1.319 inference passed. No active worker was restarted.
- T010 remains blocked. No M1/M2 work or merge.

- T007 follow-up: real offline signal-to-Pi delivery probe failed with both default and short supported polling/grace settings. Lock ownership and watcher startup still pass; consumed wake and automatic replacement remain unverified. See `evidence/T007/owned-watcher.md`.

- User-confirmed 2026-11-06 closure: T011 passes actual Finder launch echo/dimensions plus prior source/package backend acceptance. T007/T008/T010/T012 remain open; no M1/M2 start.

## Explicit scope decisions — 2026-11-06

- Focus T010 on secure preview/external handoff and direct-login persistence proof. Local-file protocol, annotations, screenshot import and production agent attachment delivery are retained for later milestones, not implemented or waived. See `preview/STRESS-TEST.md`.
- Release gate R001 (open): Apple Developer setup, signing/notarization including native modules, notarized DMG and clean-account installation acceptance. Moved out of M0 at the user’s explicit request; no release evidence is claimed.
- PR #1 may be merged only after the revised M0 gates are all verified; the user authorized that conditional merge. M1 remains locked until then.

Earlier dated/incremental notes below the milestone lists are historical snapshots. The current acceptance status and `M0-final-audit.md` supersede their unresolved-gate wording.
