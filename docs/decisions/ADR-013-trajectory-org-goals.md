# ADR-013: Session trajectory, agent organisation and goal alignment

Status: proposed — storage, rules and views only; not yet recorded into or reachable from the app
Milestone: R2 preparation

## What already existed and was not rebuilt

- **Resume and fork of a conversation.** Pi's native sessions already provide new, resume, clone, tree navigation, fork, import and export in the Conversations view (`docs/plans/m1-native-pi-commands.md`). Nothing here replaces them.
- **Audit log.** `audit_log` records governed actions with redaction. It stays the record of external writes.
- **Product objectives.** `objectives` already link a product's PRD, story drafts and work items. Goals link to an objective instead of duplicating it.
- **Crew roster.** Firstmate's bearings already list live crew members and their runs.

## Decision

One migration adds three capabilities.

**Session trajectory.** `trajectory_sessions` and `trajectory_events` hold a chronological record per session: user input, system policy, model reasoning, tool use, injected context, delegated work, approvals, errors and outcomes. Database triggers refuse updates and deletes; a correction is a new event with `refers_to`. Each event carries the hash of the one before it, so `verify` detects tampering. Summaries and details pass through the existing `Redactor` before storage; an event marked confidential keeps its summary and withholds its detail.

On the same record: search with filters (text, source, kind, participant, tool, status, time) across a session or a product; a resume brief (what happened, what is unfinished, which approvals are needed); branches that inherit history up to a fork point, can be compared (outcome, cost, duration, tool use, errors) and promoted without removing the others; and replay in two explicit modes — a reconstruction copies the stored record, a re-execution is a new run — with a comparison of steps, outcome and recorded conditions.

**Agent organisation.** `agents` gives every agent, first-party or customer-supplied, an identity, role, title, runtime, manager, status, scopes, budget, schedule and escalation. The database and the service both require an accountable owner or a manager; accountability resolves up the reporting line. Loops are refused. `refusals` answers whether an agent may do something now: status, schedule, product/tool/action/data scope and budget for the current period.

**Goal alignment.** `goals` form a hierarchy (goal → initiative → project → workstream) within an administrator-set taxonomy. `goal_links` connect existing objectives, work items, runs, sessions, artifacts and decisions to a goal. Contribution (`advanced`, `no_effect`, `set_back`) is recorded separately from completion and needs a reason. The policy can require alignment for chosen kinds of work. `context` produces the goal text an agent receives; `report` gives progress, contribution by agent and cost.

## Remaining work

- Nothing writes to the trajectory yet. Pi session events, Firstmate dispatches, connector calls and approvals must be recorded from `apps/desktop/src/service.ts` and the native Pi worker.
- The views (`trajectory-view.tsx`, `org-goals-view.tsx`) are not in the shell navigation, and there is no service command for them.
- Permission refusals and the alignment rule are not yet enforced at dispatch.
- No packaged Mac, accessibility or performance evidence exists.
