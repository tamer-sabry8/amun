# Firstmate avatar and workflow regressions

Observed in the macOS latency test build on November 22, 2026. Use the screenshots and the trace export locally for reproduction. This tracking document contains sanitized observations and keeps implementation isolated from the latency branch.

## Firstmate avatar

Use [Agent Avatar](https://github.com/jamesalmeida/agent-avatars), an MIT-licensed React component. Match the requested squircle, `#dca818` soft gradient, tall white eyes, pointer following and focus following. Verify the published version supports all six requested moods and gestures before pinning the dependency. The playground and the indexed README expose different mood lists.

Use the avatar in the chat reply header, the Dynamic Island's Firstmate card, and its unread chats control. Preview those placements in Amun at their actual sizes and in the app themes. Use a shared component, retain text status, and honor reduced motion. Play gestures once on entry into a verified state. Historical replies and unread indicators can use a static pose. Only use agreement when the application has an explicit agreement signal.

| Firstmate state                   | Avatar mood | Gesture  |
| --------------------------------- | ----------- | -------- |
| Waiting or sleeping               | `asleep`    | None     |
| Thinking or working               | `working`   | `spin`   |
| Searching                         | `searching` | `nod`    |
| Asking a question                 | `confused`  | `jump`   |
| Agreeing                          | `surprised` | `nod`    |
| Blocked or encountering a problem | `dizzy`     | `wiggle` |

Get owner approval on an annotated current and proposed UI preview before changing the app. Keep the avatar integration in its own commit so it can be reverted independently.

## Workflow regressions

- [ ] **Azure reports conflicting connection states.** Settings shows a saved Azure configuration while chat asks the user to connect it. Run the existing read-only connection check automatically when a connection is saved or a workflow needs to use an unverified connection. Coalesce concurrent checks. Use the same authoritative status in chat and Settings, clear obsolete connect cards after success, and surface a user-actionable failure only when needed. Verify success, missing configuration, unavailable server, and expired credentials. Keep publishing under its existing approval flow.
- [ ] **Dynamic Island titles overflow.** A long chat title runs through the edge of the unread reply card. Wrap long titles and unbroken strings within the card at minimum sidebar width and larger text sizes. Keep the reply preview and Open reply button visible.
- [ ] **Dynamic Island replies lack a visible history entry.** The trace records a hold answer RPC followed by chat traffic. Confirm the response can be found in Amun after sending. Show the user's exact response once in the originating conversation, with its question association and timestamp. Opening the question or reply from another chat must reach that conversation. Verify reload, question with missing origin, and retry without duplicate messages or cross-chat routing.
- [ ] **Sent text remains in the composer.** The document approval already appears in a user bubble while the same text remains editable and sendable. Clear the submitted draft when Amun accepts it, including when Firstmate is busy. Preserve any new text typed after submission and restore the submitted draft on a rejected send when the editor is still empty. Test ordinary and document-prefilled messages, navigation, and reload.
- [ ] **Document card purpose and approval state are unclear.** The transcript renders up to four output records at its end. Selecting a card opens the associated document beside the conversation. The card is tied to the output in the conversation context, so closing the pane or sending a chat message does not remove it; the card stops rendering when the output is no longer among the displayed records. Explain that behavior in the preview and make the document's status reflect the recorded approval for that exact version. The screenshot shows the brief still marked Draft after Firstmate said PRD recorded approval. A newer version needs its own state. The brief, backlog, sprint plan and provider publication have separate approval scopes.
- [ ] **The Library is empty beside the PRD draft.** The chat-scoped Library filters registered items by linked document ID. The result in the screenshot is a local Markdown path in chat, and the attachment card is visible separately. Trace the missing registration and linkage. Verify both the uploaded brief and the delivered draft appear in This chat, open beside the conversation, and survive reload. Deduplicate repeated deliveries and respect chat and work-area visibility. Keep unrelated paths and unverified file references out of the Library.
- [ ] **The sprint plan and backlog are delivered as a Markdown path.** PRD reported 14 epics and 47 stories and produced a local Markdown draft. When asked to show those records, Firstmate proposed a second transfer as another document. Make Firstmate's completed plan available for review as structured local drafts in Amun's existing epic, backlog and sprint workflows. Chat should open the relevant review directly. Keep the Markdown as source evidence, preserve hierarchy and estimate assumptions, and verify complete, deduplicated import before offering provider publication. A draft schedule is distinct from committed team capacity.
- [ ] **Background updates and PRD status disagree with delivered work.** One update said PRD was still reading after its report appeared. The later screenshots show repeated completion summaries, a no-change background message in the unread stream, and “Working on 1 thing” beside completed output. Test the active chat without reopening it. The correlated report should arrive live, progress should settle for the completed request while genuine work stays active, and a no-change or outdated wake should not create a new unread reply or mark completed work active.

## Local verification already completed

- The exported trace has the Island hold-answer RPC and subsequent chat traffic. It does not establish whether the answer was rendered in the originating chat.
- The PRD status export records the generated draft and the brief approval. The reported Markdown file exists locally and is about 22 KB. The export does not establish that Amun imported it as a document or structured backlog.
- Prior latency benchmark evidence remains on the latency branch. Repeat the full 504-line read with Computer Use when fixing the live refresh and wake regressions, and compare against the prior 20.8-second run and 10-second target.
