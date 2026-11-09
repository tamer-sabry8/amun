# R1 acceptance report

Draft. M6 remains open. Product-owner sign-off is pending.

| Feature                           | Evidence                                                                                                                                    | Remaining release condition                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| F01 macOS desktop app             | [Packaged Mac runs](evidence/T054/README.md), [release prerequisites](evidence/T057/README.md)                                              | Developer ID signing, notarized DMG and clean-account install |
| F02 bundled Pi and prerequisites  | [Native Pi and crew](evidence/M1/2026-11-07-agents-and-native-tree.md)                                                                      | T057 release prerequisite acceptance                          |
| F03 models and routing            | [Live model routing](evidence/M4/T039.md)                                                                                                   | Retain documented provider capability limits                  |
| F04 products and portfolio        | [Two-product portfolio](evidence/T047/README.md)                                                                                            | Product-owner review                                          |
| F05 guided onboarding             | [M2 verification](evidence/M2-verification.md), [keyboard journey](evidence/T054/README.md)                                                 | Complete T054                                                 |
| F06 PRD studio                    | [M2 verification](evidence/M2-verification.md), [PRD v3 journey](evidence/T054/README.md)                                                   | Complete T054                                                 |
| F07 backlog management            | [M3 verification](evidence/M3-verification.md)                                                                                              | Product-owner review                                          |
| F08 sprint management             | [Live publication, commitment and cleanup](evidence/T054/README.md)                                                                         | Complete T054                                                 |
| F09 agent crew                    | [Live worker restart and reattachment](evidence/T054/README.md)                                                                             | Complete T054                                                 |
| F10 coding tools                  | [Subscription and native sessions](evidence/M1/2026-11-06-subscription-and-native-sessions.md)                                              | T057 prerequisite acceptance                                  |
| F11 prototypes and implementation | [M4 delivery](evidence/M4/delivery-verification.md), [synthetic TEST implementation](evidence/T054/README.md)                               | Complete T054                                                 |
| F12 PR workspace                  | [M4 provider verification](evidence/M4/delivery-verification.md), [live TEST PR](evidence/T054/README.md)                                   | Complete T054                                                 |
| F13 delivery acceptance           | [M4 acceptance](evidence/M4/delivery-verification.md)                                                                                       | In-sequence T054 acceptance                                   |
| F14 memory                        | [Notion memory sync](evidence/T049/README.md), [publication](evidence/T048/README.md)                                                       | Product-owner review                                          |
| F15 tasks and reminders           | [Reminder acceptance](evidence/T050/README.md), [physical wake](evidence/T053/README.md)                                                    | Product-owner review                                          |
| F16 skills library                | [Install, reject and update](evidence/T051/README.md)                                                                                       | Product-owner review                                          |
| F17 prioritisation                | [M2 RICE verification](evidence/M2-verification.md)                                                                                         | Product-owner review                                          |
| F18 blockers and decisions        | [M3 decisions](evidence/M3-verification.md), [live Engineer decision](evidence/T054/README.md)                                              | Complete T054                                                 |
| F19 stakeholder updates           | [Draft, PDF and live Notion acceptance](evidence/T052/README.md)                                                                            | In-sequence T054 stakeholder publication                      |
| F20 workspace tools               | [MCP and composer](evidence/M1/2026-11-07-mcp-and-composer.md), [terminal keyboard recovery](evidence/T054/README.md)                       | Complete T054                                                 |
| F21 files                         | [Local Mac folder and ingestion](evidence/M1/2026-11-07-mcp-and-composer.md)                                                                | Retain documented folder permissions                          |
| F22 themes and language           | [Approved visual baselines](evidence/T055/README.md), [three-theme accessibility](evidence/T054/README.md)                                  | Product-owner review                                          |
| F23 reliability and governance    | [Chaos suite](evidence/T053/README.md), [durable core](evidence/T013/2026-11-06-durable-core.md), [approval reuse](evidence/T054/README.md) | Complete T054 and T057                                        |

## Current measurements and limitations

The rebuilt packaged Mac regression passed 55 tests with 21 conditional tests skipped. Live Azure publication and commitment, worker dispatch and reattachment, and TEST GitHub PR checks are recorded separately in T054. The broad suite includes three-theme axe and keyboard navigation.

The full shell exceeds the 500 MiB foundation-shell working-set budget. T056 records initial and deferred-editor measurements and remains open. Repeated process-cold launches after the regression suite pass the startup and terminal-echo budgets. The first launches after rebuilding exceeded the startup budget.

The M4 owner waiver covers the live restricted-worker publication and server-denial checks. The T054 synthetic fixture was published by the captain after explicit owner approval. The worker remained restricted. A stale Codex shell snapshot required explicit scoped paths, and a waiting inbox notification needed recovery submission. The same native worker was retained.

The live six-item Azure publication had uninterrupted connectivity. The in-sequence interruption after item three remains unverified. Separate lost-response regression and packaged chaos evidence are linked in T054 and T053.

The M1 redesign remains paused. Live Google and Obsidian acceptance remains in R3. Signing, notarization and clean-account release installation are open. Release and owner sign-off remain pending.
