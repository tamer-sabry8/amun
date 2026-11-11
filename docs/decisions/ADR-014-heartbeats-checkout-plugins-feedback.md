# ADR-014: Heartbeats, task checkout, plugin catalog and element feedback

Status: proposed — storage, rules and views only; not yet driven by or reachable from the app
Milestone: R2 preparation. Builds on ADR-012 (widget registry) and ADR-013 (agent organisation).

## What already existed and was extended, not rebuilt

- **Wakes.** Firstmate's own watcher and wake-drain protocol (`packages/crew/src/wake-ack.ts`) and the reminders scheduler stay as they are. Heartbeats add a per-agent record above them.
- **Action claims.** `ActionStore.claim` already gives a governed external write a single executor. Task checkout is ownership of a unit of work, a different thing; it does not replace action claims.
- **Extensions.** The skills library (review, install, update), reviewed local Pi extensions, MCP servers and model routing already exist. The plugin catalog describes and governs them through one manifest; a skill plugin must point at a skill already reviewed in the skills library. Interface plugins register kinds in the existing widget registry.
- **Prototype feedback.** The prototype preview already lets a person pin a text note to a listed element. Element feedback adds the richer capture (position, styles, errors, screenshot reference), masking, the agent's stated plan and before/after comparison.

## Decision

One migration adds four capabilities.

**Heartbeat-driven execution.** `agent_heartbeats` holds each agent's cadence and limits; `agent_wakes` records every wake: the trigger, why, the decision (act, wait, delegate, escalate, request approval, refused), what it waits on and when it acts next. Stop conditions are checked before the agent's assessment runs: retired, halted by a person, paused, hourly wake limit. An action is also refused when the agent is outside its scope, schedule or budget, and a run of consecutive actions halts the agent until a person releases it. A person asking for status is always answered. Delegation and escalation follow the org chart and carry the objective reference.

**Atomic task checkout.** `task_claims` has one row per task with one holder. Checkout runs in an immediate transaction, so two callers cannot both win. States: available, claimed, waiting for a person, waiting for a dependency, failed, paused, completed. A claim that is not renewed is marked stalled and released only through `recover`; nobody takes it over silently. Transfer, pause, resume and reclaim need a named actor and a reason. `task_claim_events` is an append-only history.

**Plugin catalog.** A manifest declares kind (model provider, connector, skill, workflow, interface, policy), origin (built in, your organisation, third party), version, compatibility and permissions. Installing grants nothing. Enabling requires the permission lines the person was shown. An update with the same access keeps its grant; one that asks for more is turned off until granted again. A policy plugin can only deny or require approval. Network targets must be listed in the manifest's own permissions.

**Element feedback.** A capture from a preview page is bounded and cleaned (the page is untrusted), masked as the person chooses, redacted and only then stored and turned into the agent's message. The agent must state a plan that names the element before a change is recorded. Before and after are compared, and the person accepts or asks for another iteration.

## Remaining work

- Nothing calls these yet. Firstmate dispatch should take a checkout before starting a worker and record wakes; the scheduler should call `Heartbeats.due`.
- The preview panel does not yet produce a capture; that needs a selection overlay in the isolated browser view, with no privileged bridge to the page.
- The catalog does not yet configure Pi providers or MCP servers from enabled manifests.
- The views are not in the shell navigation and have no service command.
- No packaged Mac, accessibility or performance evidence exists.
