# R1 milestone tracker

Only **M0** is active. M1–M6 are locked until the preceding exit gate has evidence and product-owner decisions resolve remaining blockers. A checked task means its tests and full Definition of Done passed, not merely that code exists.

The source plan is preserved in [product-and-r1-plan.md](plans/product-and-r1-plan.md). The current user request takes precedence over its embedded agent instructions. The user confirmed Electron/TypeScript; see ADR-001-desktop-stack.md. Product scope and task IDs remain traceable.

## Working agreement

- One milestone at a time; focused branches and draft PRs into `main`. No automatic merge.
- TDD: add a behavior test, record its meaningful failure, implement the minimum, run the suite, refactor, rerun.
- Every implemented behavior needs unit coverage, including invalid inputs and security failures; integration/UI tests supplement unit tests.
- Domain and governance require at least 90% line coverage. Never substitute mocks for live acceptance evidence.
- Record red/green output, environment, commit, limitations and DoD evidence under `docs/evidence/<task-id>/`.
- PRs explain user benefit, security boundaries, performance impact, tests and outstanding gates.
- Never log secrets, disable TLS, auto-approve writes, or represent unknown outcomes as success.

- External integrations use supported APIs or MCPs; discover compatible existing CLI/MCP setups and reuse supported sign-ins with explicit selection. See [ADR-007](decisions/ADR-007-existing-tools-and-api-integrations.md).

## Current progress

- T001/T003/T004: complete. macOS CI run 42012823971 passed the clean install, checks and live shell launch/isolation test. See evidence links.
- T002: six entity contracts plus health RPC implemented with schema rejection/round-trip tests. Consumer adoption exists in renderer/service; Pi bridge remains T037.
- T005: complete. macOS CI run 42013744485 passed both launch/isolation and real service crash-recovery tests (<5 s recovery).
- T006: Pi 1.4.0 pinned; bounded LF-only parser unit-tested; isolated live get_state/get_available_models probe passes. Packaged Linux Electron-as-Node probe passes with empty PATH; macOS packaged containment, RPC, launch/isolation and crash-recovery checks passed (run 42145190729). Packaged OpenRouter and GitHub Copilot inference now pass on the real Mac. Streaming/extension UI integration remains open.
- T007: checksum-pinned Firstmate distribution is packaged; real watcher command/marker loading and missing-ownership refusal pass in isolated source and packaged probes on macOS (run 42147118853). Every Amun-created home forces Claude auto and Codex restricted. Owned watcher operation, personal skills import and worker approval/dispatch remain open.
- First-installer requirement: preserve the existing Herdr → Pi → Firstmate setup. Read-only discovery and state-isolation unit tests are implemented; actual reuse/attachment and Mac onboarding remain open. See [ADR-005](decisions/ADR-005-existing-installations.md) and [coexistence evidence](evidence/T007/coexistence.md).
- T009: live ICV API proof complete, with authorised test IDs and real stale-revision conflicts. T008/T010/T011/T012 remain open; browser and native terminal proofs pass locally, but their remaining gates are not waived.

- Backend clarification: Amun must not depend on Herdr. Managed-home creation now rejects Herdr and requires explicit tmux selection for the M0 proof; operational tmux integration remains unproven. The original attached plan is preserved as reference, with this user clarification taking precedence.

- T007 isolation increment: private short tmux socket roots and a launch-environment allowlist are unit-tested; source/packaged startup probes use them. A new macOS integration probe checks two same-named sessions remain independent. Worker lifecycle and persistent reconnect remain open; see [evidence](evidence/T007/tmux-isolation.md).

- T006 protocol increment: bounded correlated request client, stream-event delivery and explicit select/confirm responses pass 12 unit tests; source Pi probe uses the client. Packaged authenticated inference now passes for both providers; renderer integration remains open. See [evidence](evidence/T006/rpc-client.md).

- Local Mac baseline and installation inventory completed: see [local evidence](evidence/M0-local-mac.md). T010 now has a live local prototype/security/redirect proof; real authenticated browsing remains open. The GitHub → Google sign-in attempt was rejected by Google in the embedded browser; see T010 evidence.

## Current blockers

- Local execution is now verified on the user’s Mac. The historical Linux handoff is superseded for execution access by [local evidence](evidence/M0-local-mac.md); authenticated acceptance gates remain open.
- Stack decision resolved: Electron/TypeScript, as explicitly selected by the user.
- Apple Developer signing/notarization and clean-account installation remain open; unsigned local Mac source/package tests pass.
- ICV API access and live T009 writes now pass through a Keychain PAT. Provider/service UI integration, operational crew recovery and remaining browser/release gates remain open. Do not request credentials in chat.
- GitHub API access restored. Work is tracked in draft PR #1.

## M0 — Prove the foundations — ACTIVE

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
- [ ] **T007 — Firstmate home management** · P0 · TS + Bash (existing) · Dep T006
      Build: `runtime/firstmate` pinned snapshot; create Amun-managed home under `~/Library/Application Support/Amun/firstmate/<home>`; import overlay from an existing home (backend, crew-dispatch.json, claude-permission-mode forced to `auto`, secondmate-harness, skills); project trust for its `.pi/extensions`; never write into the user's personal home.
      Tests: overlay merge unit tests; live: Firstmate starts in the managed home; watcher extension loads; personal home untouched (hash before/after).
      DoD: ADR documents which Firstmate behaviours work under RPC and which need fallback (interactive TUI in a backend pane).
- [ ] **T008 — Crew observation and reattach** · P0 · TS · Dep T007
      Build: adapter reading Firstmate task records and Amun-managed backend state (non-Herdr; discover format first; document it); map to `runs`; detect `unknown` after restart; reattach by recorded backend pane + worktree; never spawn.
      Tests: fixtures of recorded Firstmate and selected backend state; live: dispatch Codex + Claude workers, restart service, reattach.
      DoD: zero duplicate workers across 10 restart trials; unknown state shown when unverifiable.
- [x] **T009 — Azure DevOps proof** · P0 · TS · Dep T005
      Build: client on azure-devops-node-api with explicit `api-version=7.0`; PAT from Keychain; `NODE_EXTRA_CA_CERTS` support; read projects/teams/process/work items; create story + task; update with JSON Patch `test /rev`; read iterations; read Azure Repos PRs.
      Tests: MSW fixtures; live `@live` against the Tahaluf test project.
      DoD: evidence of created IDs; stale-revision update returns conflict and is handled; supported-endpoint matrix recorded.
      Local acceptance: ICV Test PBI #1088026 and Test Task #1088027; both revision updates and stale rejections proved. See [T009 evidence](evidence/T009/README.md).
- [ ] **T010 — Browser view proof** · P1 · TS · Dep T004
      Build: WebContentsView in the inspector slot; per-product partitions; navigation controls; permission handler; popup handling; SSO redirect test.
      Tests: page script cannot access `ipcRenderer`, Node or Amun ports; Playwright.
      DoD: authenticated site + local prototype both render; security test green.
- [ ] **T011 — Terminal dock proof** · P1 · TS · Dep T005
      Build: node-pty in service (rebuilt for Electron ABI), xterm.js in renderer, resize, scrollback; "attach to backend pane" mode (read-only default, explicit take-control).
      Tests: echo/resize tests; packaged-app test.
      DoD: works from Finder launch without inheriting an interactive shell environment.
- [ ] **T012 — Packaging and performance baseline** · P1 · TS · Dep T004–T011
      Build: Forge signing + notarization; DMG; include pinned Pi and Firstmate snapshot; native modules signed.
      Tests: install on clean macOS account; measure cold start, total RAM, editor latency.
      DoD: notarized DMG; budgets recorded in ADR.
      **M0 exit gate:** every item in the M0 DoD has evidence; failures become product-owner decisions before M1.

## M1 — Durable core and shell — LOCKED

- [ ] **T013 — Database and migrations** · P0 · TS · Dep T002
      Build: Drizzle schema for section 8.6; migrations; FTS5 for search.
      Tests: migrate up from every prior version with seed data.
      DoD: data survives app upgrade test.
- [ ] **T014 — Governance engine** · P0 · TS · Dep T013
      Build: action and approval state machines (8.4); payload hash (canonical JSON); target-revision binding; invalidation triggers; separate approval kinds (publish, commit, merge, notion_publish, file_destructive, skill_install, model_outside_allowlist).
      Tests: exhaustive state-transition tests; property tests for hash stability.
      DoD: ≥ 90% coverage; mutating a payload after approval always invalidates.
- [ ] **T015 — Outbox and reconciliation framework** · P0 · TS · Dep T014
      Build: outbox table written in the same transaction as the action; worker (liteque or in-house); per-connector `reconcile(operationMarker)`; never auto-retry `unknown` merges/creates without reconciliation.
      Tests: crash between write and ack; duplicate-suppression tests.
      DoD: chaos test "kill after remote write, before local ack" produces no duplicate.
- [ ] **T016 — Auth broker** · P0 · TS · Dep T006, T013
      Build: Keychain storage (@napi-rs/keyring); Pi provider sign-in UI (Copilot, OpenRouter, OpenAI/Codex, API keys) driven through Pi (pi-ai login via bridge/CLI) into the Amun-scoped Pi dir; readiness via `pi auth check --json`; ADO PAT; GitHub (device flow / PAT; GHES host); Notion (internal integration token in R1 unless public OAuth is confirmed safe); refresh lock (proper-lockfile).
      Tests: unit with fake keyring; live sign-in for Copilot and OpenRouter; Claude subscription option absent.
      DoD: all connections show independent status; secrets only in Keychain or the 0600 Pi dir.
- [ ] **T017 — Audit and redaction** · P0 · TS · Dep T013
      Build: audit_log writer; pino redaction; export redaction.
      Tests: canary-secret test across logs, exports, memory, updates.
      DoD: canary never found.
- [ ] **T018 — Backup and restore** · P1 · TS · Dep T013
      DoD: encrypted export/import of a workspace; secrets excluded; restore test passes.
- [ ] **T019 — Design tokens and themes** · P0 · TS/JSON · Dep T001
      Build: DTCG tokens for Tamer Sabry default, Navy Gold, Navy Cyan (values from the brand table in Appendix A); Style Dictionary → `--amun-*` CSS variables; locked safety tokens; contrast validator.
      Tests: contrast unit tests (≥ 4.5:1 text, ≥ 3:1 UI); theme switch persists.
      DoD: all component states render in three themes.
- [ ] **T020 — App shell layout** · P0 · TS/React · Dep T005, T019
      Build: sidebar (switcher, ⌘K, 6 fixed tiles, nav, pinned tabs, artifacts), top bar with mode tabs, Focus and the status pill slot, workspace router, right edge in fixed order (status rail, drawer layer, single-slot inspector with Issue/Web tabs), composer, terminal dock, Focus mode with exact restore.
      Tests: Playwright layout + keyboard navigation; axe.
      DoD: no auto-reordering of tiles; inspector and drawers never open without user action; drawers overlay without layout shift.
- [ ] **T021a — Firstmate Island (action queue)** · P0 · TS/React · Dep T002, T013, T020
      Build: attention-item store and contract (5.3); item types; origin labels (Firstmate / Secondmate / Crewmate / Amun); ordering; Rail, Pill, Card, Expanded sizes; "+N more"; snooze; navigate vs inline modes; governed items always navigate; removal only on resolution or snooze; live region; ⌘⇧J; reduced motion; empty state.
      Tests: unit for ordering, resolution and snooze rules; test that a governed item can never resolve from the Island; visual baselines for every type × size × theme; a11y.
      DoD: gallery page in the dev build shows all combinations; clicking an item and navigating away leaves it open.
- [ ] **T021b — Status pill, status rail and drawers** · P0 · TS/React · Dep T002, T020
      Build: top-bar status pill (counts, colour states, click pins Activity); right rail with Notifications, Activity, Artifacts, Downloads, Skills and extensions; drawer layer with 150 ms hover intent, 250 ms close grace, click to pin, ⌥⌘1–5, Esc, focus management; one drawer at a time; overlay without layout shift; tap = pin.
      Tests: Playwright hover-intent and pin tests; keyboard-only test; one-drawer rule; a11y; visual baselines per drawer × theme.
      DoD: run and publication progress appear only in the pill and Activity drawer, never in the Island.
- [ ] **T022 — Requests and command palette** · P1 · TS · Dep T020
      DoD: Requests history (open and resolved, filters) whose badge equals the Island count from the same query; ⌘K searches entities and runs commands.

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

- [ ] **T037 — amun-bridge Pi extension** · P0 · TS · Dep T006, T014 — Build: Unix-socket client with token; `tool_call` hook: classify tool by Amun's own registry; governed/unknown → create action, return block with action id; handler errors block; Amun tools (`amun_get_context`, `amun_propose_backlog_publication`, `amun_propose_sprint_commitment`, `amun_request_merge`, `amun_raise_decision`, `amun_report_blocker`); event forwarding. Tests: direct and codemode-nested MCP write attempts are blocked; a tool claiming `readOnlyHint` but registered as governed is blocked; extension that replaces `/mcp` detected and reported. DoD: test matrix green on live Pi.
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
- T011: actual worker attachment, native read-only default, explicit control, resize, ownership-loss refusal and client-only detach pass source/package. Finder manual result pending.
- T012: current process-cold/warm-cache launches 322/317/330 ms, summed Electron working set 481 MiB, echo 13/13/12 ms. Clean-account installation and signing/notarization remain open.
- Personal CLI version issue: Claude's updater changed its shared launcher from 2.1.311 to 2.1.319 during the first worker run. Amun update guards are now tested; the user's decision on restoring the launcher is pending.
- T010 remains blocked. No M1/M2 work or merge.
