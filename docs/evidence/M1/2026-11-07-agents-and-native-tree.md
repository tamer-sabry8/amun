# M1 worker reattachment and native Pi sessions

Tested code revision `d6f4b0e`, including worker recovery at `4a019a5`. Source and separately packaged arm64 Amun ran on the acceptance Mac using the ordinary Agents and Conversations screens.

## Agents

- The initial test failed because the Agents screen had no worker observation control. A separate regression reproduced a newer observation request being dropped while another read was pending.
- Agents lists validated private workspace receipt IDs. Selecting a worker rechecks the actual Firstmate record, socket and tmux endpoint. A service disconnect invalidates the visible observation. The replacement port automatically reobserves the selected task.
- The source and packaged tests each restarted the isolated Amun service ten times. Both Codex and Claude retained their original process IDs, start times, panes and windows. Every trial compared the live worker inventory and observed zero duplicates. A missing receipt produced an unknown endpoint. No worker launch was performed by recovery.
- The parent and both secondmate homes were Git worktrees. The corresponding permission settings matched in the parent and each child. Targeted process checks confirmed Codex used workspace-write with on-request approval and Claude used auto permission mode. Only booleans were recorded.
- These workers had already been dispatched and had existing receipts. Persistent worker launch and initial receipt issuance through the normal Amun interface are separate from this recovery test. Worker task completion is unknown from endpoint observation alone.

## Conversations

- A typed `/tree` originally had no executable native action in the composer. The composer now routes the supported built-ins to their native controls. A single slash opens the chooser. Unknown commands cannot become model requests. Session import uses the native file picker.
- The source and packaged UI tests resumed a real Pi 1.4.0 session containing sibling branches, displayed both siblings at the correct level, marked the current entry, navigated the tree and exercised fork. Unit cases reject orphaned, duplicate and cyclic entries.
- A separate test package originally picked up a previous desktop build directory and failed during packaging. The packaging configuration now excludes prior output. The final package was built in a separate directory and both live suites passed.
- Lint, type checking, formatting and 412 unit tests passed. Domain line coverage was 97.24%, including 96.72% for governance.

## Persistent crew home

The normal Agents screen now opens one persistent crew home per workspace. It prepares a primary and two linked worker checkouts from the selected verified archive. Opening the home again validates the original Git registrations. A full application restart and a rollback of the revision for new checkouts preserved the original crew. The source and packaged Mac journeys passed in 18.2 and 22.6 seconds after reproducing the missing control. This verifies provisioning and reuse. Initial dispatch and endpoint issuance remain open.

## Full quit and worker recovery

The owner chose to pause primary supervision on full application quit. Both the source app and a fresh arm64 package quit completely with the two existing disposable workers present. The previous Amun service PID exited. Reopening Agents verified the same Codex and Claude endpoints and original worker process identities. Each build also completed ten service restarts with zero duplicate workers. The test did not launch a persistent primary model turn. Its pause/resume acceptance belongs with normal dispatch.
