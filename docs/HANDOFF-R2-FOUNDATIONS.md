# Handoff: R2 foundations built on 11 November 2026

## Executive summary

One working session reviewed Amun against seven open-source agent products, decided to keep building Amun, and then added nine foundations as new, tested modules. **None of them is wired into the running app.** They are storage, rules, presentational views and unit tests. A user of the app sees no change, apart from one accessibility fix to the Activity drawer button.

Your job as the next agent is the wiring: recording real events, calling these modules from the service, and adding the views to the shell. Read "What is not done" before you start.

State when this file was last updated:

- `main` head before PR 14: `03029f1` (merge of PR 12). PR 14 carries this file; once it merges, all four pull requests are on `main`.
- Local checks on the last branch: 597 unit tests pass across 179 files; lint, typecheck, format and the coverage gate pass.
- No packaged Mac, accessibility or performance run was made for any of this work. The session ran on Linux with Node 22; the repo pins Node 24.

## Read these first

1. `AGENTS.md` — standing owner rules. Two matter most here: T022c (interface redesign) needs explicit owner approval before any design or implementation, and credentials stay in service-owned storage.
2. `docs/R1-BETA-TO-R2-HANDOFF.md` and `docs/R1-ACCEPTANCE.md` — R1 state. R1 acceptance is still a draft: memory is 525–530 MiB against a 500 MiB budget (T056 open) and owner sign-off is pending.
3. `docs/decisions/ADR-012-widget-registry.md`, `ADR-013-trajectory-org-goals.md`, `ADR-014-heartbeats-checkout-plugins-feedback.md` — the decisions behind this work.

## The conversation, in order

1. **Review and comparison.** The owner asked for a review of Amun and a comparison with Paperclip, Paseo, OpenChamber, T3 Code, Orca, emdash and DeepSeek Harness, and whether to abandon Amun and build on one of them.
   - Recommendation given and accepted: keep Amun. None of the seven has governed Azure DevOps Server work-item writes, payload-bound approvals, Notion sync or product memory.
   - The owner's idea of hosting Pi and Firstmate inside DeepSeek Harness was assessed and not recommended: Harness subagents are one-shot with auto-answered permissions, the project is a developer preview that does not accept external pull requests, and a fork would be maintained alone.
   - Findings about Amun itself: Electron (not the Tauri the original brief names; see ADR-001), `apps/desktop/src/service.ts` is 2,061 lines, `apps/renderer/src/shell.tsx` is about 1,950 lines, and `README.md` still describes an M0 foundation.
2. **Widget registry and dock layout** (PR 11).
3. **Activity drawer label fix** (PR 12), found when PR 11's CI failed on an existing accessibility defect.
4. **Features 1–4:** session trajectory; search, branch comparison and replay; agent organisation; goal alignment (PR 13).
5. **Features 5–8:** heartbeats; atomic task checkout; plugin catalog; element feedback (PR 14).
6. **This handoff.**

A licensing point the owner raised: copying MIT or Apache-2.0 code requires keeping its copyright and licence notice. To honour the owner's wish for no attribution in the code, **no code was copied from any other project**. Everything is an original implementation of the same ideas.

## Pull requests and branches

| PR                                                  | Branch                                 | State when written                                                     | Contents                                                     |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| [#11](https://github.com/tamer-sabry8/amun/pull/11) | `widgets_registry`                     | Merged to `main` (`944a370`)                                           | Widget registry, dock layout, request widgets, renderer host |
| [#12](https://github.com/tamer-sabry8/amun/pull/12) | `claude/inspiring-fermi-f8c2uh`        | Merged to `main` (`03029f1`)                                           | Activity drawer button label fix                             |
| [#13](https://github.com/tamer-sabry8/amun/pull/13) | `session-trajectory-org-goals`         | Merged to `main` (`4d46706`)                                           | Features 1–4                                                 |
| [#14](https://github.com/tamer-sabry8/amun/pull/14) | `heartbeats-checkout-plugins-feedback` | Merge approved by the owner; merged once CI passes on its final commit | Features 5–8 and this file                                   |

The owner explicitly approved each merge: PR 11 and PR 13 once CI passed, then PR 12 and PR 14 after reviewing their status. Do not treat this as standing permission; ask before merging any new pull request.

## What was built

All paths are relative to the repository root. "Data" modules take a `better-sqlite3` database that has been migrated with `migrate(db)` from `packages/data/src/database.ts`.

### 1. Widget registry and dock layout — PR 11, ADR-012

- `packages/domain/src/widgets.ts` — `WidgetRegistry`. A widget kind declares a slot (`island`, `activity`, `notifications`, `inline`, `toast`), a schema, a title and actions. `propose` validates data; `act` returns an intent and never performs an external write; `subscribe` and `version` suit React's `useSyncExternalStore`.
- `packages/domain/src/dock.ts` — `applyDock` over a tree of splits and tabbed panes (`open`, `close`, `activate`, `move`, `split`, `resize`), plus `dockDo`, `dockUndo`, `dockRedo`.
- `packages/domain/src/attention-widgets.ts` — maps existing attention items (Island requests) to widget kinds. Requests cannot be dismissed.
- `apps/renderer/src/widget-host.tsx` — `WidgetRenderers` (renderer registered by kind key), `PlainWidget` fallback, `WidgetSlot` component.
- Tests: `packages/domain/tests/widgets.test.ts`, `dock.test.ts`, `attention-widgets.test.ts`, `apps/renderer/tests/widget-host.test.ts`.

### 2. Activity drawer label fix — PR 12

- Defect: the status-rail Activity button shows a visible count when an activity exists, but its accessible name stayed "Activity drawer". axe reports `label-content-name-mismatch`. It fails only when an activity exists at scan time, so `tests/e2e/m6-accessibility.spec.ts` fails intermittently.
- Fix: `apps/renderer/src/rail-label.ts` (`railLabel`) used in `apps/renderer/src/shell.tsx`; three locators in `tests/e2e/m1-shell.spec.ts` and `tests/e2e/m1-preview.spec.ts` now match by prefix.
- Before this fix reached `main`, that accessibility test failed once on PR 11 and passed on a single re-run. If it fails again with the same rule, the fix did not cover the case; investigate, do not re-run.

### 3. Features 1–4 — PR 13, ADR-013

Tables (one appended migration): `trajectory_sessions`, `trajectory_events`, `trajectory_preferred`, `agents`, `agent_collaborators`, `agent_assignments`, `agent_usage`, `goals`, `goal_links`.

- **Session trajectory** — `packages/domain/src/trajectory.ts`, `packages/data/src/trajectory.ts` (`Trajectory`). Events have a source (`user`, `system`, `reasoning`, `tool`, `context`, `subagent`, `approval`, `error`, `outcome`). Database triggers refuse update and delete. Each event stores the hash of the previous one; `verify` detects tampering. Text passes through the existing `Redactor`; `confidential: true` keeps the summary and withholds the detail. A correction is a new event with `refersTo`.
- **Search, resume brief, branches, replay** — on the same class: `search`, `resume`, `fork`, `branches`, `compareBranches`, `promote`, `preferred`, `replay` (`reconstruction` or `re_execution`), `replayComparison`.
  - Not rebuilt: resume and fork of a Pi conversation already exist (`docs/plans/m1-native-pi-commands.md`).
- **Agent organisation** — `packages/domain/src/agent-org.ts`, `packages/data/src/agent-org.ts` (`AgentOrg`). Identity, role, runtime, manager, accountable owner, scopes, budget, schedule, escalation, assignments, collaborators, usage. `refusals` returns the reasons an agent may not act now. An agent must have an accountable owner or a manager; loops are refused.
- **Goal alignment** — `packages/data/src/goals.ts` (`Goals`). Hierarchy goal → initiative → project → workstream within an administrator taxonomy; `link` to existing objectives, work items, runs, sessions, artifacts and decisions; `assess` records contribution separately from completion; `context` builds the goal text for an agent; `aligned` applies the policy; `report` gives progress, contribution by agent and cost.
  - Not rebuilt: product `objectives` already exist; goals link to them.
- Views: `apps/renderer/src/trajectory-view.tsx`, `apps/renderer/src/org-goals-view.tsx`.
- Fixed in PR 14: sessions, branches and goal links were ordered by timestamp and then by a random id, so rows created in the same millisecond came back in a varying order and one test failed intermittently in CI. They are now ordered by timestamp and then insertion order. When you add a list query, break ties with `rowid`, never with a random id.
- Tests: `packages/data/tests/trajectory.test.ts`, `agent-org.test.ts`, `goals.test.ts`; `packages/domain/tests/trajectory.test.ts`, `agent-org.test.ts`; `apps/renderer/tests/trajectory-views.test.ts`.

### 4. Features 5–8 — PR 14, ADR-014

Tables (one appended migration): `task_claims`, `task_claim_events`, `agent_heartbeats`, `agent_wakes`, `plugins`, `element_feedback`.

- **Heartbeats** — `packages/data/src/heartbeats.ts` (`Heartbeats`). `configure`, `due`, `wake(agentId, trigger, reason, choose)`, `halt`, `release`, `state`, `trace`. Stop conditions run before the agent's assessment: retired, halted, paused, hourly wake limit; an action is also checked against scope, schedule and budget through `AgentOrg.refusals`, and a run of consecutive actions halts the agent. A `human_request` is always answered.
  - Not rebuilt: Firstmate's watcher and wake drain (`packages/crew/src/wake-ack.ts`) and the reminders scheduler.
- **Task checkout** — `packages/data/src/task-checkout.ts` (`TaskCheckout`). One holder per task, taken in an immediate transaction. A stalled claim is released only by `recover`. `transfer`, `pause`, `resume` and `reclaim` need an actor and a reason; `history` is append-only.
  - Not the same as `ActionStore.claim` in `packages/data/src/outbox.ts`, which gives a governed external write a single executor.
- **Plugin catalog** — `packages/domain/src/plugins.ts`, `packages/data/src/plugins.ts` (`PluginCatalog`, constructed with the app version). Kinds: `model_provider`, `connector`, `skill`, `workflow`, `interface`, `policy`. Origins: `first_party`, `customer`, `third_party`. Installing grants nothing; `enable` needs the permission lines the person was shown; an update that widens access is turned off until granted again. `contributeWidgets` registers interface-plugin kinds in the widget registry.
  - Not rebuilt: the skills library (`packages/data/src/skill-library.ts`), reviewed Pi extensions, MCP servers, model routing. A `skill` plugin must name a skill already in the `skills` table.
- **Element feedback** — `packages/domain/src/element-feedback.ts`, `packages/data/src/element-feedback.ts` (`ElementFeedback`). `submit` cleans, masks and redacts a capture and returns the message for the agent; `acknowledge` requires a plan naming the element; `recordAfter` compares before and after; `decide` accepts or asks for another iteration.
  - Extends, does not replace, the text pin in `apps/desktop/src/prototype-preview.ts`.
- Views: `apps/renderer/src/operations-view.tsx` (`ClaimsView`, `HeartbeatView`, `PluginCatalogView`).
- Tests: `packages/data/tests/heartbeats.test.ts`, `task-checkout.test.ts`, `plugins.test.ts`, `element-feedback.test.ts`; `packages/domain/tests/plugins.test.ts`, `element-feedback.test.ts`; `apps/renderer/tests/operations-view.test.ts`.

## What is not done

These are the gaps between "module exists" and "product capability".

1. **Nothing records into the trajectory.** Pi session events, Firstmate dispatches, connector calls, approvals and errors must be appended from `apps/desktop/src/service.ts` and `apps/desktop/src/native-pi-worker.ts`.
2. **Nothing enforces the new rules at dispatch.** `AgentOrg.refusals`, `Goals.aligned`, `TaskCheckout.checkout` and `PluginCatalog.policyEffect` are not called by `packages/crew/src/firstmate-dispatch.ts` or `apps/desktop/src/implementation-run.ts`.
3. **No scheduler calls `Heartbeats.due`.**
4. **No service commands.** The renderer reaches the service through typed commands in `packages/contracts/src/workspace.ts` handled by `packages/data/src/workspace-service.ts`. None exist for these modules.
5. **No view is in the shell.** Adding navigation entries edits `shell.tsx` and changes visible layout. Check the T022c rule in `AGENTS.md` and ask the owner first.
6. **The preview panel produces no capture.** Element feedback needs a selection overlay in the isolated browser view. Browser content must get no privileged bridge (`AGENTS.md`, brief §8).
7. **The catalog configures nothing.** Enabled `model_provider` and `connector` manifests are not yet turned into Pi provider or MCP settings.
8. **`packages/data/src/schema.ts` has no entries for the new tables.** The existing test only checks that tables declared there exist, so this passes; add them if you use Drizzle for these tables.
9. **No Mac evidence.** The repo's own rule is that unit, live integration, packaged Mac, accessibility and performance are separate gates.

## How to verify

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm check
```

```bash
pnpm exec vitest run --coverage
```

Notes:

- In a sandbox with an HTTP proxy, nine tests in `packages/connectors-ado/tests/transport.test.ts` fail because the Azure SDK routes local test traffic through the proxy. They pass with the proxy variables unset. This is the environment, not the code.
- CI is `.github/workflows/ci.yml`: one `unit` job on `macos-15` that also runs the Electron journeys and packaging. It takes about 15 minutes.
- The pull request template in `.github/pull_request_template.md` expects red/green TDD evidence.

## Rules that were followed and should continue

- Migrations are append-only (`packages/data/src/migrations.ts`). Two entries were appended; no released entry was edited.
- Apart from migrations, the only existing files changed in the whole session are `shell.tsx` (one label, PR 12) and two end-to-end specs (PR 12).
- No dependency or lockfile changed. New code avoids importing `zod` into `packages/domain`, which does not declare it; schemas there are structural.
- Acting on a widget, a wake or a plugin never performs an external write. External writes keep going through the existing approval and outbox path.

## Suggested next steps, in order

1. Confirm PR 14 is merged and `main` is green.
2. Close T056 (memory) or get the owner's decision on it; R1 is not signed off.
3. Add service commands for one capability end to end. Trajectory is the best first choice: record Firstmate dispatch and approval events, then show `TrajectoryView` for a run.
4. Take a `TaskCheckout` before a worker starts in `firstmate-dispatch.ts`, and release or fail it when the run ends.
5. Ask the owner about T022c before adding any navigation.
6. Continue the R2 tasks already recorded in `docs/R1-BETA-TO-R2-HANDOFF.md` (T059 roadmap, T060 Decision Room, T061 RFP).
