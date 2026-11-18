# Amun PM playbook

> **Status: reference only, not installed.** Amun never writes this (or any rule) into your Firstmate home.
> It was drafted when each Product Space had its own home; Amun now uses your single existing home.
> If you want the First Mate to adopt parts of it, tell the First Mate in chat and it decides where the rules go
> (`data/captain.md`, `data/captain-shared.md`, a mate's home, or ai-memory).

Amun overlay for this vendored Firstmate. It adds product-management work shapes; it changes no Firstmate rule.
`AGENTS.md` wins on any conflict: you still never write to `projects/`, never merge or publish without the captain's word, never tear down unlanded work, crewmates still report only to you, and you report outcomes faithfully with evidence.

The captain works in Amun. Each Amun Product Space is one Firstmate home (`FM_HOME=~/.amun/homes/<space>`).
Amun reads your fleet through `bin/fm-fleet-snapshot.sh --json` and your backlog through `data/backlog.md`, so the board moves when your normal lifecycle moves it.
Nothing below needs a new script: use `bin/fm-brief.sh`, `bin/fm-spawn.sh`, `bin/fm-tasks-axi.sh`, `bin/fm-captain-hold.sh` and `bin/fm-teardown.sh` as `AGENTS.md` describes.

## Backlog kinds Amun's board understands

File every PM item through `bin/fm-tasks-axi.sh add <id> "<title>" --kind <kind>` before dispatch.

| Kind | Board column while queued | Use for |
| --- | --- | --- |
| `scout` | Discovery | research, evidence, assumption checks |
| `prd`, `spec`, `story` | Spec / Prototype | PRDs, user stories, initiative evaluations |
| `prototype` | Spec / Prototype | clickable prototypes and wireframes |
| `sync` | Backlog | delivery-system work routed to the delivery secondmate |

In flight shows as In Progress, In flight with a PR link or a captain hold shows as Review, and Done shows as Done.
A decision for the captain is a task held with `bin/fm-captain-hold.sh hold <id> --reason "<question>"`; Amun shows it in its decision bar and relays the captain's answer to you as a message.

## 1. Discovery and Market Scout

- Brief: `bin/fm-brief.sh <id> <repo> --scout`; spawn: `bin/fm-spawn.sh <id> projects/<repo> --scout`.
- Firstmate spec: research the captain's question; for every product assumption in the ask, state the evidence for and against, with sources and dates; mark anything unverified as unverified.
- Deliverable: the scout report at `data/<id>/report.md`. Put structured findings in a fenced `json` block at the end with keys `assumptions[]` (`claim`, `verdict` = `supported|weak|refuted|unverified`, `evidence[]`), `competitors[]` and `open_questions[]`. Amun's Roast Room evidence desk reads that block.

## 2. Wireframe and Prototype crewmate

- Brief: `bin/fm-brief.sh <id> <repo> --mode local-only` (or the delivery mode the captain chose); spawn with the matching `--mode` and `--yolo`.
- Firstmate spec: build a self-contained clickable prototype (HTML with Tailwind or React, no external services) inside the leased treehouse worktree, under `prototypes/<id>/`.
- Handback: the `done:` status line names the entry file, for example `done: prototype prototypes/<id>/index.html`. If a dev server is needed, name its local URL instead. Amun's browser preview opens what the handback names; the captain never has to touch code.

## 3. PRD and 4-Question Roadmap crewmate

- Brief and spawn as a ship task in the captain's chosen mode.
- Firstmate spec: draft the PRD and user stories, and evaluate every initiative against the 4-Question Framework, each answered in one short paragraph with its evidence:
  1. What is it?
  2. Why does it matter?
  3. When will it be delivered?
  4. How much does it cost?
- A question with no evidence is answered "unknown" with what would settle it, never guessed.
- Deliverable: `docs/prd/<id>.md` with a closing fenced `json` block `{"what":..., "why":..., "when":..., "cost":...}`, which Amun stores on the initiative.

## 4. Linear and Jira Delivery secondmate

- Persistent home: `bin/fm-brief.sh <id> --secondmate --no-projects`, then `bin/fm-spawn.sh <id> --secondmate`. Its charter scope: syncing approved stories and sprints with Linear and Jira Cloud.
- Amun's server owns the API adapters and the credentials. The secondmate asks Amun to sync through its normal report-back; it never stores tokens in its home.
- Any write to Linear or Jira is an external, outward-facing change: it needs the captain's explicit word for that exact payload and destination (hard rule 2), recorded through `bin/fm-captain-hold.sh`.
