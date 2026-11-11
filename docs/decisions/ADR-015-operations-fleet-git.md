# ADR-015: Operations dashboard, CLI continuity, tool detection, Creator Mode, session goals, ports, tickets, fleet and git fabric

Status: proposed — storage, rules, views and tests only; not yet driven by or reachable from the app
Milestone: R2 preparation. Builds on ADR-012, ADR-013 and ADR-014.

## What already existed and was extended, not rebuilt

- **Dashboard.** The portfolio view, the Island and Requests queue, the Activity drawer and the reminders scheduler stay. The dashboard summarises records from the trajectory, task claims, heartbeats, session goals and agent spend.
- **Chat and terminal.** Amun already has a terminal pane and Pi conversations. Continuity adds one reference and one record (the trajectory) for both surfaces.
- **Tool detection.** Acceptance scripts discovered Claude Code, Codex and tmux; there was no product model of it. Onboarding path selection (`packages/crew/src/existing-setup.ts`) is untouched.
- **Creator Mode.** Built on the plugin catalog and widget registry; nothing new is stored outside them.
- **Lead and workers.** Firstmate already dispatches secondmates into separate worktrees. The fleet plan adds decomposition, dependency order and merge order; it does not spawn workers.
- **Tickets.** Azure DevOps work items and the GitHub issue path already exist and are not replaced. The ticket model is provider-neutral.
- **Git and pull requests.** Worktree creation (`delivery-worktree.ts`), branch guards (`branch-maintenance.ts`) and the PR workspace with revision-bound merge already exist. The git fabric adds the branch graph, conflict projection, sandboxed rebase and cherry-pick, and checkpoints.

## Decision

One migration adds `session_goals`, `port_leases`, `tool_registry`, `fleet_plans`, `fleet_tasks`, `tickets` and `git_checkpoints`.

- **Operations dashboard** (`domain/operations.ts`, `data/operations.ts`): live sessions with stuck detection, a ranked attention queue with permitted actions, schedule health, capacity with a plain reason for waiting, usage by any dimension, a budget forecast, and quality rates.
- **Chat-to-CLI continuity** (`domain/session-ref.ts`, `data/session-surface.ts`): an `amun://session/<id>` reference, the same state from either surface, and a command interpreter (`status`, `events`, `search`, `say`, `decide`, `open`, `ref`) with text or JSON output. Every action is recorded with its surface and actor. An automation cannot answer an approval.
- **Tool detection** (`domain/tool-detection.ts`, `crew/tool-probe.ts`, `data/tool-registry.ts`): a probe looks a known name up on the path and runs only that tool's fixed version command, without a shell and with a minimal environment. Results are classified as ready, needs sign-in, not installed, outdated, blocked or turned off, each with one next step.
- **Creator Mode** (`data/creator.ts`): an agent gets a frozen, secret-free view of extension surfaces, proposes a declarative extension (widgets as labelled fields, or restricting rules), and receives every validation problem. A valid extension is stored in the catalog as user-created and mounted into the registry without a restart; a widget that fails to mount is skipped and reported. Generated code is never executed.
- **Session goals** (`domain/session-goals.ts`, `data/session-goals.ts`): criteria with checks, guardrails (turns, budget, deadline), a verdict after every turn with the failing output fed back, a blocked summary, resume with raised limits, and a notification returned exactly once. Progress is stored, so the loop survives a restart.
- **Ports and lifecycle** (`domain/lifecycle.ts`, `data/port-leases.ts`): `.amun.json` with `setup`, `run`, `teardown` and non-secret `env`; one port per task, enforced by the database; `WORKSPACE_PORT` injected; a badge for the task tab; a teardown plan that releases the port.
- **Ticket ingestion** (`domain/tickets.ts`, `data/tickets.ts`): one ticket shape and an adapter interface for ten providers, a filterable backlog, a branch name and agent brief from a ticket, and proposed status and comment updates that go through the existing approval path. Ticket text is quoted to the agent as a request, not as instructions.
- **Fleet** (`domain/fleet.ts`, `data/fleet.ts`): plan validation including dependency loops, parallel waves, ready and stalled subtasks, a worker brief with the contracts it relies on, limited retries, ordered merges and delivery only after integration tests pass.
- **Git fabric** (`crew/git-fabric.ts`, `data/git-checkpoints.ts`): branch graph with stacked lineage, a conflict projection that changes nothing, the three versions of a conflicted file, rebase and cherry-pick tried in a throwaway worktree, protected-branch refusal, and checkpoints with rollback that refuses to lose unsaved or newer work.

## Remaining work

- **No tracker adapter is implemented.** The adapter interface exists; Jira, Linear, GitLab, Asana, Monday.com, YouTrack, Plain and Featurebase each need an authenticated client, which could not be built or verified without accounts.
- **No `amun` executable.** The command interpreter exists and is tested; it is not yet installed as a command or connected to the running service.
- **Nothing runs the checks of a session goal or the lifecycle commands.** The modules decide and record; executing commands belongs in the service, under the existing approval and sandbox rules.
- **No agent performs conflict reconciliation.** The module supplies the three versions and a sandbox; asking an agent to resolve and verifying the result is not built.
- **No canvas.** There is no pan-and-zoom branch view, drag-and-drop cherry-pick or keyboard publishing; only the data they would show.
- **Token counts are not stored**, so usage reports cost and runs but zero tokens.
- The views are not in the shell navigation and have no service command. No packaged Mac, accessibility or performance evidence exists.
