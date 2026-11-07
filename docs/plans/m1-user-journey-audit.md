# M1 journey and placement audit — 2026-11-07

User correction: sharing a conversation must not live under Settings → Models. This is a functional placement correction, not approval for T022c visual redesign.

| Intent                                        | Location                                                       | Acceptance / remaining work                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Connect Notion or Azure DevOps                | Settings → Connections                                         | Provider setup stays separate from publication; Notion destination verification here is configuration only.              |
| Authorize model providers                     | Settings → Models                                              | Pi provider authorization; distinguish saved credentials from inference success.                                         |
| Sign into Codex/Claude workers                | Settings → Models → CLI subscriptions                          | Separate worker profiles, explicit status and inference actions.                                                         |
| Resume/import/name/navigate a Pi conversation | Overview → Open conversations; command palette → Conversations | Native session tools moved out of Settings. Full native command parity remains T022a.                                    |
| Share selected conversation                   | Conversations → Share to Notion                                | Redacted preview, verified destination, exact review, then explicit publication. No automatic write on navigation.       |
| Review consequential work                     | Requests and contextual review                                 | Island navigates to review; it does not approve governed writes.                                                         |
| Inspect progress or uncertain writes          | Status and Activity drawer                                     | Workspace-scoped publication activity must validate even without a product. Unknown outcomes must not offer blind retry. |
| Browse previews or use terminal               | Existing Browser/Terminal tiles                                | Utility docks remain separate from connection setup and model configuration.                                             |
| Change theme or backup workspace              | Settings → Appearance / Data and backup                        | Preserve existing themes; redesign awaits approval.                                                                      |

Remaining usability gaps are not marked complete: the bounded active-conversation text reader is now implemented, while composing/streaming remains open; new/resume/import must make the active session explicit before sharing; disconnected sharing should navigate directly to connection setup and return to the original conversation; publication now has persistent verified receipt/page links; an explicit recovery path for uncertain outcomes remains open. CLI model inference diagnostics must remain distinguishable from ordinary conversation actions. Later Firstmate composer and product workflows must not be represented as implemented by the M1 Pi session view.

The immediate automated journey test checks that sharing/commands are absent from Models, CLI subscription setup remains there, and conversation sharing is reachable from Overview. This is not a claim that every remaining M1 journey has passed live acceptance.
