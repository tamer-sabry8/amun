# Amun PM playbook

> **Status: reference only, never auto-installed.** Amun never writes this (or any rule) into your Firstmate home.
> Amun uses your single existing Firstmate home and never creates per-space homes.
> If you want the First Mate to adopt parts of this playbook, tell the First Mate in chat and it decides where the rules go
> (`data/captain.md`, `data/captain-shared.md`, a mate's home, or ai-memory).

Amun reference guidance for product-management work on top of this vendored Firstmate. It adds PM shapes and Amun handoff conventions; it changes no Firstmate rule.
`AGENTS.md` wins on any conflict: you still never write to `projects/`, never merge or publish without the captain's word, never tear down unlanded work, crewmates still report only to you on the existing parent channel, and you report outcomes faithfully with verified evidence.

## 1. Single home, role routing, and reminders

- **Single Firstmate home:** Amun connects to the captain's single operational Firstmate home. Amun reads your fleet through `bin/fm-fleet-snapshot.sh --json` and your backlog through `data/backlog.md`, so the board moves when your normal lifecycle moves it. Use `bin/fm-brief.sh`, `bin/fm-spawn.sh`, `bin/fm-tasks-axi.sh`, `bin/fm-captain-hold.sh`, and `bin/fm-teardown.sh` as `AGENTS.md` describes.
- **Route by actual registered role and remit:** Check `data/secondmates.md` (and the current registry and charter) before delegating. A catalogue title alone grants no authority. Give one matching, available role only the evidence it needs. If no matching role is registered, available, or authorized for the request's scope (for example, personal-only for a WORK request), retain the request and explain the limitation—do not invent roles or open new chats.
- **Where guidance lives:** Keep short routing and decision guidance in the primary Firstmate home; keep detailed discovery, PRD drafting, and story decomposition guidance with the PRD mate.
- **Reminders (Trackr route):** Record reminders in `data/reminders/reminders.md` via the Trackr route. Always distinguish clearly between `recorded` (logged in `data/reminders/reminders.md`) and `scheduled` (actually wired to a firing timer or trigger)—never call a recorded-only note scheduled.

## 2. Request correlation and parent-channel handoffs

Every captain message from Amun starts with `[Amun request amun-r-…]`. Carry that exact provenance through the entire lifecycle:

- **Exact Amun request reference (`amun-r-…`):** Repeat it in backlog links (`amun-request:<ref>`), in every brief handed to a crewmate or second mate, and in every status report or delivery reply back to Amun.
- **Authorized scope and source provenance:** Carry the authorized product, project, or initiative (and WORK or PERSONAL scope) plus the exact approved source ID and revision through native correlated parent-channel handoffs.
- **No guessing:** Never guess which request a result belongs to from wording or timing, and never reuse a reference for different work. If a result's request reference is uncertain, leave the reference out so Amun keeps it visible without mislinking it.

## 3. Backlog kinds Amun's board understands

File every PM item through `bin/fm-tasks-axi.sh add <id> "<title>" --kind <kind>` before dispatch.

| Kind                   | Board column while queued | Use for                                                     |
| ---------------------- | ------------------------- | ----------------------------------------------------------- |
| `scout`                | Discovery                 | research, evidence, assumption checks                       |
| `prd`, `spec`, `story` | Spec / Prototype          | PRDs, BRDs, proposals, user stories, initiative evaluations |
| `prototype`            | Spec / Prototype          | Markdown wireframes and interactive-flow specifications     |
| `sync`                 | Backlog                   | governed delivery-system work routed to a delivery role     |

In flight shows as In Progress, In flight with a PR link or a captain hold shows as Review, and Done shows as Done.
A decision for the captain is a task held with `bin/fm-captain-hold.sh hold <id> --reason "<question>"`; Amun shows it in its decision bar and relays the captain's answer to you as a message.

## 4. Markdown-first PM shapes and the `amun` catalogue

Amun renders PM deliverables directly in its workspace as Markdown-first documents—including wireframes (`prototype` is a Markdown wireframe, not a local HTML bundle or dev-server browser preview).

### Supported PM document shapes

`proposal`, `brd`, `prd`, `idea`, `rice`, `moscow`, `roadmap`, `gantt`, `brief`, and `prototype` (Markdown wireframe).

### Delivering through fenced `amun` blocks

Put each action in its own fenced ` ```amun ` block containing **exactly one JSON object**:

- **`document`** (`{"do":"document", ...}`): Deliver a Markdown PM document with `"request": "amun-r-…"`, `"title"`, `"type"` (one of the PM shapes above), and `"body"` (Markdown). Include optional `"outputId"` and `"expectedVersion"` when publishing an explicit revision of an existing Amun document.
- **`show`** (`{"do":"show", ...}`): Open a supported Amun pane or document beside the chat (for example `stories`, `receipt`, `sprints`, `requirements`, `release`, `activity`, or a specific document). `show` is read-only and never performs a write.
- **`story-drafts`** (`{"do":"story-drafts", ...}`): Deliver editable story drafts derived from an approved PRD, carrying `"request": "amun-r-…"`, optional `"objectiveId"` and `"expectedVersion"`, and `"stories"` (each with short title, exact substantive requirement quote from the approved PRD, observable acceptance criteria, and child tasks).
- **`report`** (`{"do":"report", ...}`): Report progress or completion (`queued`, `waiting`, `working`, `needs-decision`, `failed`, `delivered`) for `"request": "amun-r-…"`.

### Conservative size budgets and JSON safety

- Keep `document.body` **≤ 80,000 characters**.
- Keep visible chat prose **≤ 12,000 characters**.
- Escape literal backticks inside JSON string values as `\u0060` so embedded Markdown code fences never close the outer ` ```amun ` block early.

## 5. Discovery, PRD, and Wireframe workflows

- **Discovery and Market Scout:** Research the captain's question; state evidence for and against each assumption with sources and dates; mark anything unverified as unverified. Deliver the report to `data/<id>/report.md` (with a closing fenced `json` block containing `assumptions[]`, `competitors[]`, and `open_questions[]` for Roast Room) and return the correlated summary or `document` block on the parent channel.
- **PRD and 4-Question Roadmap (PRD mate):** Draft the PRD/BRD and evaluate each initiative against the 4-Question Framework (What is it? Why does it matter? When will it be delivered? How much does it cost?), answering "unknown" with what would settle it whenever evidence is missing. Deliver via `document` (`type: "prd"` or `"brd"`) with the exact request reference; after approval, decompose stories via `story-drafts` quoting exact passages from the approved source ID and revision.
- **Markdown Wireframe (`prototype`):** Produce a structured Markdown wireframe (screens, states, navigation flows, copy, and edge cases) delivered via `document` with `"type": "prototype"`. Do not spin up local dev servers or claim a browser preview opened.

## 6. Governed provider flows (ADO, Jira, Linear, Notion)

- **Amun owns adapters and credentials:** Amun's server owns all provider connections, OAuth tokens, and governed write operations for Azure DevOps, Jira, Linear, and Notion. Firstmate and secondmates never store credentials or write directly to external trackers or wikis.
- **Captain approval is mandatory and scoped:** Every external write requires the captain's explicit approval covering the exact listed records, fields, and destination. A role handoff delegates analysis only and grants no separate delivery write.
- **Never claim completion before Amun confirms:** Never say an item was filed, shown, synced, or published until Amun confirms the operation. Report verified receipts faithfully (destination, external IDs, confirmed outcome, or exact error/refusal).
