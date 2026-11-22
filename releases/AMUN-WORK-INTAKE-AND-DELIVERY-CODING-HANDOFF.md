# Implement Amun’s Product, Project and Initiative workflow

This is the next coding assignment after the “Password anywhere” Lavish review on 22 November 2026. Start from the latest GitHub `main` in a separate branch and worktree. The review used an example name and created no live work. The repo inspection used `696f836` as its baseline. Recheck the code and live evidence before changing either Amun or Firstmate.

- [Amun rules](https://github.com/tamer-sabry8/amun/blob/main/Amun_rules.md) and [rebuild handoff](https://github.com/tamer-sabry8/amun/blob/main/docs/rebuild/HANDOFF.md)
- [Delivery implementation and evidence from PR #51](https://github.com/tamer-sabry8/amun/blob/main/releases/AMUN-STORIES-BACKLOG-SPRINTS-CLAUDE-PROMPT.md)
- [Lavish walkthrough](http://127.0.0.1:4387/session/a209c64e85f499ea) and its local source `/Users/tamersabry/Documents/ChatGPT/Amun/.lavish/password-anywhere-flow/index.html`

## Ownership and approvals

Amun is the workspace and keeps the work records, chats, drafts and receipts. The captain talks to Firstmate through Pi. Firstmate delegates to registered roles in the selected operational home. Paseo hosts and transports. Existing provider review and exact-scope gates apply separately to document approval, backlog publication, sprint commitment, code review, merge and release. A name or a chat message authorizing creation of a local area cannot authorize provider writes.

The captain’s review requested the chat routing, Project interview, lightweight Initiative tracking, explicit tracker and board selection, sprint location and chats, and delivery and launch evidence described below. The captain directly requested the Product Manager problem-statement and PRD coverage changes. The launch UI, Project checklist and other new visual treatments below are proposals. Use the existing approval process for those visuals and keep coding and verification moving on independent items. The review authorizes no live write or deployment.

## 1. Implement intake and reuse the right chat

- For explicit named creation, use the active or sole eligible group. Work and Personal are examples of configured scopes. Ask once when the scope remains ambiguous. Keep group boundaries. Create or open the named work area and deliver the original message once in its first chat. For a same-group duplicate, ask whether to use the existing work or explicitly create another. Preserve ordinary chats and their drafts. Ask before moving a chat or reassigning selected unfinished requests. Keep request identity, delivery receipts and original chat links through moves, retries and restart.
- Product owns an ongoing outcome, discovery, roadmap, and releases. Keep the interview, PRD version and approval in its originating chat with the document in Library. Link a bounded Project if it implements the Product and the captain authorizes the association.
- Project starts with a scoped interview in its own chat. Establish the client or sponsor where applicable, delivery outcome, due date, deliverables, tasks, dependencies, owner and who accepts the work. Reuse an existing brief or linked Product facts. Ask one unresolved material question at a time. Small projects can track next actions and completion in the Project work area and chat. Preview any proposed dedicated checklist. Use board and sprint workflows only where the scope calls for them. Record acceptance and handover.
- Initiative is the user-facing label for a standalone task under rule 31. Extend named intake and visible labels while preserving the stored `task` type and legacy input compatibility. Project, Product and story tasks keep their terminology. For small Initiatives use the Initiative work area and chat to retain the outcome, next action, optional deadline, reminder and completion evidence. Use existing Portfolio visibility. If work grows, offer explicit in-place conversion to Project and preserve ID, chat, history, links and group. A Product represents a separate ongoing ownership decision.
- Start in `packages/domain/src/work/model.ts` (`newWorkNamed`, `routeNewWork`), `packages/amun-ui/src/rebuild/app.tsx`, `home.tsx`, `sidebar.tsx`, and the work-store `convert-task` command. Verify work areas opened from Home and existing chats. Verify file intake and preservation of existing behavior. The named Home fast path sets priority and due date. The fallback Project intake can parse “for client X”. Carry the explicit client through both paths and ask only if the project needs a client or sponsor and it is still unknown. `screens.tsx` filters Sprints to Product and Project.

## 2. Update the existing Product Manager through Firstmate

Locate the live registered `prd` secondmate in the selected operational home via Firstmate. The local roster snapshot in `/Users/tamersabry/Projects/firstmate/data/secondmates.md` lists `prd` and `researcher`. Verify both against the active roster and scope. Ask Firstmate to install or update the PRD guidance through its native ownership path and return the persisted change and verification. Use the approved isolated home for testing. Keep Amun-owned briefing and integration code in Amun. Preserve upstream Firstmate, the operational home ownership boundary and the existing reviewer challenge, document delivery and register conventions.

Send Firstmate this instruction, scoped to the existing Product Manager charter or its supported workflow guidance:

> In every PRD interview, establish the customer’s real pain before settling the solution. Review supplied sources and existing answers first. Run at least three distinct why probes. Establish why the pain occurs in the current workflow, why the suspected cause or limitation persists, and why its impact matters to the customer and business. Resolve probes from available evidence where possible and bring consequential unknowns to me via Firstmate, one question at a time, with choices, your recommendation and a custom answer. Summarize the evidence and conclusions in the PRD. Label assumptions, conflicting evidence and validation needs. Keep claims such as causes, frequencies, customer quotes and baselines traceable to evidence or identified as unknown.
>
> Finish discovery with one clear problem statement in a single format from the list below. Choose the best fit and say why. Keep the statement about customer pain and the desired outcome. If the specific user, real pain, impact or evidence remains materially unclear, keep it in discovery or visibly provisional and record what would validate it. A working draft can still progress.
>
> For missing market, competitive or technical evidence, give Firstmate a bounded research question, scope, authorized sources and a return request. Firstmate should delegate to the registered Research secondmate and return findings with sources, uncertainty and limitations to Product Manager. Product Manager owns synthesis, the captain interview and the brief. Firstmate stays the captain-facing channel. Preserve the reviewer challenge and record how substantive issues were resolved or escalated before the PRD is ready.

### Choose exactly one final problem-statement format

| Format                         | Required content                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence-led 5W+H, the default | Specific segment, desired outcome, when and where the failure occurs, evidenced cause or current limitation, customer and business impact. Quantify only with a source or label the measurement pending. |
| Jobs to Be Done                | Trigger, specific customer, desired progress, obstacle, current workaround and cost, delay or risk. Useful when motivation and switching behavior matter.                                                |
| Outcome–Evidence–Scope         | Segment, context and supported cause, source-backed evidence, customer and business impact, measurable desired change and explicit non-goals. Useful for stakeholder alignment.                          |

### PRD interview coverage

Maintain a checklist in the brief or its interview notes. Mark each topic evidenced, captain-confirmed, assumption, open or not applicable with a reason. Reuse answers already in authorized sources. Ask one question only when the missing answer changes a decision. Affected readiness decisions wait for material gaps. The PRD should cover most applicable topics substantively. An open issue or assumption is visible and cannot count as a confirmed answer.

| #   | What the Product Manager establishes                                                              |
| --- | ------------------------------------------------------------------------------------------------- |
| 1   | Specific customer and boundaries with adjacent segments                                           |
| 2   | Customer job and desired outcome                                                                  |
| 3   | Current workflow and handoffs                                                                     |
| 4   | Painful step, frequency and consequence                                                           |
| 5   | Alternatives, workarounds or doing nothing                                                        |
| 6   | Sources that establish the pain and confidence in those sources                                   |
| 7   | Customer-visible improvement when it works                                                        |
| 8   | Ideal end-to-end experience                                                                       |
| 9   | Smallest valuable scope                                                                           |
| 10  | Core capabilities needed                                                                          |
| 11  | Launch must-haves and non-goals                                                                   |
| 12  | Business objective and why it matters                                                             |
| 13  | Primary success measure, baseline and target where known, guardrails                              |
| 14  | Demand, reachable market and willingness to pay where relevant                                    |
| 15  | Alternatives on value, price, speed, quality and switching cost where relevant                    |
| 16  | Decision makers, approvers, contributors and affected stakeholders                                |
| 17  | Functional and nonfunctional requirements, edge cases, permissions, data, integrations and errors |
| 18  | Technical, privacy, security, legal, operational and third-party constraints                      |
| 19  | Risks, contradictions, assumptions, open decisions and owners                                     |
| 20  | Delivery sequence, dependencies, deferred scope and launch prerequisites                          |

Default to a PRD for product build requirements. Reuse the structured interview for a PR/FAQ if the requested decision is about the customer proposition or market opportunity, or a BRD if it is about business process, stakeholders and constraints. Keep exact approved versions and show the review decision in the original chat and Library. For the “Password anywhere” example, the name establishes only identity. A first interview question can ask who has the pain. The sample cannot establish any real customer segment, pain, or metric.

## 3. Convert an approved PRD to backlog and sprint work

- Default to capability and outcome decomposition. Validate the result with story mapping and slice a usable first release. Use a lifecycle map when the work primarily moves an object through states. Trace PRD outcome and requirement to epic, story and testable acceptance criteria. Show gap, duplicate and non-goal decisions. Keep stories independently valuable and include essential security, privacy and permissions where the slice requires them.
- Read the selected tool and verified connection, then resolve the exact workspace or collection, project, team, board or backlog and sprint or iteration. Reuse configured eligible destinations and ask only when ambiguous. Keep separate provider and work-area identities. If the board lacks a verified type, mapping or permission, explain the limitation and keep a local draft. Show the exact destination and reviewed hierarchy before publishing. Read back provider IDs, parent links and membership. Reconcile partial or uncertain writes using the original request before retrying.
- In **Sprints**, select the Product or Project and show its sprint Summary and Planning views. Its sprint chat lives under the work area. Link planning outcomes back to the exact request. Keep work-area context when viewing a shared team sprint. Draft the goal, dates, capacity, story scope and owner suggestions. Verify creating a new sprint as its own operation, including team visibility and read-back. Committing reviewed membership and assignments is a separate action.
- Build on `screens.tsx`, `sprint-azure.ts`, `sprint-binding.ts`, `packages/domain/src/work/planning.ts`, `packages/work-store/src/ado-*` and `packages/server/src/server/amun/delivery-sync.ts`. PR #51 records controlled Azure evidence and the live test scope still to verify. Confirm live evidence at execution time. Extend other providers only within the existing approved integration scope.

## 4. Track delivery and launch

- Reuse Sprints for scoped stories and blockers, the work-area chat for decisions and results, Activity for action receipts and Portfolio for progress. Link stories to provider status, dependencies, owners, QA evidence and PRs where available. Display stale or unknown evidence. Firstmate delegates actual delivery and QA to registered roles using native worktrees. Review code changes before opening a PR. Merge approval and green checks belong to the exact head.
- Prepare a production release design in Lavish that links the work area, Roadmap and originating chat. Track environment, release owner, exact artifact or commit, readiness evidence, approval, deployment ID and state, smoke checks, rollback and post-launch metrics. Distinguish readiness, scheduled, deploying, verified live, failed and rolled back. When there is no verified deployment adapter, start with read-only pipeline status plus a release-owner receipt. Require evidence of the exact live version and smoke result to show verified live. Repo inspection did not establish a general automated production workflow. Link an existing pipeline via its authorized integration if one is available.

## Implementation order and acceptance

1. Land Initiative naming and intake behavior in the existing work-area flow. Test all three request forms, known and ambiguous scope, same-group duplicates, retry, chat identity, legacy records and in-place conversion.
2. Have Firstmate relay and verify the Product Manager update. Run a controlled discovery with missing evidence, a contradiction and a research follow-up. Verify three meaningful why probes, no invented facts, no duplicate question, one selected format, traceable interview coverage, reviewer feedback, exact approval and Library recovery across reopening.
3. Prove PRD-to-story-to-existing-sprint with the authorized test scope and independent read-back. Verify multiple eligible tools, unverified board, stale data, possible duplicate, partial publication, exact request navigation, and team versus work-area context. Verify new sprint creation separately before claiming it works.
4. Show delivery and launch tracking visuals for approval. Prove the pipeline or manual receipt path using controlled data first. Include cancellation, stale artifact, failed smoke check, partial evidence and rollback in acceptance. Run GitHub CI and distinguish automated, isolated Mac and authorized live evidence.

Report what worked and what remains unverified. Keep the review artifacts and this handoff available to the next agent.
