# T054 keyboard and accessibility

The Mac test seeds a disposable product with an approved PRD and linked backlog drafts. It reaches controls using Tab and activates them with the keyboard. The test covers the primary routes, the local stakeholder draft, exact-content review and PDF export, browser inspector, terminal dock and portfolio switcher in the default, Navy Gold and Navy Cyan themes.

The populated-screen scan found a serious axe violation in all three themes. The inspector tab list included the Close button as a direct child. Moving Close beside the tab list retained keyboard access and cleared the violation. All three source-app runs passed. The existing development gallery and three-theme packaged drawer checks also passed.

These tests cover local navigation and export. The full section 6 keyboard golden path, including governed publication, sprint commitment, crew reattachment, PR merge, acceptance and Notion publication in sequence, remains open.

The rebuilt packaged Mac app also passed all three theme journeys with zero serious or critical axe findings on the 16 scanned views per theme. The separate packaged reminder restart check passed alongside them. The workspace check passed lint, type checking, 506 unit tests and formatting.

## Golden path through the first external approval

On the packaged arm64 Mac, the acceptance run used Tab traversal, keyboard text entry, control activation and the native macOS file chooser. It created the synthetic Team onboarding product, imported three Markdown documents, mapped the pilot Azure source, and answered Firstmate's interview. It saved and approved the product understanding, wrote three successive PRD versions, approved v3, and generated six stories and fourteen child tasks using a local model. The expiry decision was confirmed at 168 hours and resolved. SQLite verified the imported documents and generated drafts. The passing run took 59.4 seconds. An earlier run referenced a port on which the test model had failed to start. The successful run used its own verified loopback listener, which was stopped after authoring.

At the publication checkpoint, the packaged UI selected the Azure project using the keyboard and requested teams. It remained at Loading during the timed run. A macOS Keychain Allow prompt was observed during the request. Independent read-only API discovery verified the pilot team and process schema. The production review service prepared the six parent stories at the project root in the same disposable workspace. All six ledger entries are pending approval. No Azure work item was written or assigned. The complete field-and-marker preview stays local. On resume, load the held review and verify its exact binding in the packaged app before any approved execution. T054 remains open across publication, network-loss reconciliation, sprint planning, crew reattachment, PR review, merge, acceptance and Notion sharing.

## Approved publication on the Mac

The owner approved the held six-story preview. The packaged app loaded it by keyboard and the test compared every displayed step and the destination with the saved batch, then verified the full approval binding. One keyboard activation published all six. The app reported six verified items. Independent Azure reads matched six distinct receipt IDs at revision one, the reviewed title, root area and root iteration, and an empty assignee. The durable ledger recorded one successful attempt per story. The live run passed in 27.9 seconds.

This live run had uninterrupted connectivity. The separate lost-response regression exercises reconciliation after the third write. The in-sequence network interruption remains unverified. Read-only sprint discovery returned the team's targets. Sprint selection and manual assignment are pending owner input.

## Sprint commitment preview

The owner selected a team sprint and named themselves as assignee for all six published stories. Read-only Azure discovery matched the authenticated identity ID to its canonical assignment name. The packaged Mac test traversed the sprint form by keyboard, selected all six items and opened the exact commitment review. It matched the displayed destination, IDs, revision guards and both field changes against the saved batch. All six entries were pending approval with zero attempts. The passing test took 25.7 seconds. The full binding and payload are in the private owner review. Live commitment and the requested post-test deletion await review and execution.

## Approved commitment and cleanup

The owner approved the held commitment binding and deletion of the six test IDs after verification. The packaged keyboard run compared the exact held preview, activated execution once, and passed in 27.1 seconds. Independent Azure reads confirmed all six receipts succeeded with advanced revisions, the selected sprint and the identity-matched assignee. The private profile retains the verification receipt.

After commitment verification, cleanup validated each item's project, title, sprint, assignee and publication marker against the approved fixture. All six were deleted through Azure's supported work-item deletion API. Each live read returned 404 and each recycle-bin receipt matched its ID. These were recoverable deletions. The private profile retains per-ID cleanup receipts. The remaining golden-path stages are open.

## Implementation repository checkpoint

After the approved Azure cleanup, the packaged app reopened the preserved acceptance profile. SQLite verified all six local stories still have their committed state. The keyboard-only run opened Backlog, reached the third parent story, Revoke Invitation, and activated Ask Firstmate to implement. It then reached the implementation repository selector. The service requested a repository and local checkout, the selector contained only its placeholder, and Preview implementation scope was disabled. The test passed in 1.2 seconds. Type checking and scoped lint passed.

This checkpoint verifies the resumed local story and the implementation entry point. The synthetic product currently maps three documents and the Azure source, with no implementation repository. Owner selection of the repository and checkout is needed before the exact commit, TEST branch and worktree can be previewed. The third generated story is used as the continuation candidate. Worker dispatch, restart and reattachment, PR head-change rejection and merge, acceptance, and final Notion sharing remain open. The uninterrupted live publication's network-loss limitation remains recorded above. T054 and M6 remain open.

## Isolated TEST implementation scope

The owner selected the Amun repository and canonical main checkout as the source for the synthetic story. The packaged keyboard flow mapped that repository, opened Revoke Invitation, selected Test branch purpose, entered the source checkout and prepared the exact implementation review. The run passed in 4.0 seconds. It checked the story identity and displayed source head, branch and worktree against the pending approval payload.

The test then called the production worktree materializer to fulfill the authorized branch preparation. Git verified a clean TEST branch at the selected source commit, backed by a separate bare repository in the disposable profile. The canonical checkout remains clean on main. This worktree creation was performed by the test harness after the keyboard preview. The app's start action, worker dispatch and reattachment remain untested in this sequence. Type checking and scoped lint passed. The private owner review contains the full commit, TEST branch, worktree and approval binding. The next app checkpoint is approval of that implementation scope before Firstmate receives the story brief.

## Approved Firstmate start and restart

The owner approved the held TEST scope. The packaged keyboard run checked the stored binding, activated Approve scope and start run, and verified the saved run was running with its expected branch and worktree. It loaded the worker's protected endpoint receipt, verified the owned tmux endpoint and saved its process start identity. After closing and relaunching Amun, it reopened the story by keyboard and found Check worker report and resume. The run identity, pane reference, worktree, branch, receipt and process start identity matched across restart. The test passed in 1.2 minutes. A separate process inspection confirmed a real Codex native process under the saved pane.

The delivery message remained in the worker inbox while its terminal notification awaited submission. A direct Enter to the scoped, verified tmux pane released it. Codex then reported stale shell snapshot environment values pointing to an older acceptance workspace. The same worker received explicit recovery paths through the packaged terminal. No implementation report has passed verification yet.

Terminal control testing found that Tab stayed inside xterm after taking control. A failing keyboard run exposed the inability to return to the terminal controls. Shift+Tab now returns focus to the first terminal control while ordinary Tab remains available to the terminal application. Packaged re-verification is pending.

The rebuilt packaged run passed in 4.4 seconds. It compared the actual native Codex descendant PID and process start time across another Amun restart, in addition to the pane identity, saved receipt and run. By keyboard it opened the verified worker terminal, took control, submitted the scoped fixture test permission, used Shift+Tab to focus the toolbar and returned to read only. Initial terminal attachment can focus xterm, so the keyboard test also uses Shift+Tab before reaching Take control.

The synthetic worker recovered after receiving explicit absolute paths. A stale shell snapshot had overridden its inbox and current-directory context. Recovery instructions constrained its implementation to a TEST-prefixed local fixture and tests in the approved delivery worktree. This recovery used the same worker. The full Mac check passed lint, type checking and 506 unit tests. Formatting was corrected and rechecked. The remaining in-sequence PR review, merge, acceptance and Notion publication are open.

## Worker implementation and publication blocker

The same worker produced a synthetic invitation fixture and three Node HTTP tests in the approved TEST worktree. Independent Mac execution passed all three, covering admin revocation, recipient denial after revocation, unauthorized requests, repeated revocation, unknown tokens and unrelated routes. The fixture was committed locally. Its three files are confined to the TEST fixture directory. The source checkout remains outside the delivery repository.

The packaged keyboard report check passed in 2.3 seconds. It opened Check worker report and resume, displayed the Engineer decision request and verified the durable run transitioned to blocked. The report identifies the missing approved restricted publishing identity. No remote fixture branch or PR has been created. Automatic approval review separately rejected captain-account publication of the fixture branch and an isolated TEST base, citing missing authorization for that remote write. The command was rejected before execution. The owner can approve those exact TEST publications using the captain account or supply an approved worker identity. The M4 worker-permission-check waiver remains recorded. PR head-change refusal, reviewed TEST merge, acceptance and final Notion publication remain open.

## Approved TEST PR and approval reuse

The owner approved captain-account publication of the exact fixture and an isolated TEST base, then gave Firstmate and secondmates standing approval to continue this acceptance journey. The fixture branch and TEST base were published and TEST PR #9 was opened against that base. The hosted check initially failed on formatting of the two fixture modules. A formatting-only repair was pushed. The packaged keyboard reviewer loaded the live PR and diff, and correctly left Prepare merge disabled while its checks were failing.

The owner also requested reuse of approvals. AGENTS.md now records that approvals carry through Firstmate, secondmates, retries and restarts within their reviewed scope. A regression test first failed when the same action was approved twice. ActionStore now reuses an existing valid approval for an unchanged approved, executing, unknown or completed action without inserting another approval or resetting its outbox attempt. A separate test rejects reuse after target revisions change. All 508 local unit tests, lint and type checking passed. Formatting passed before the subsequent PR-link continuation edits, whose final check is pending. Live changed-head refusal and TEST merge remain open.

The packaged keyboard continuation resolved the publishing decision with the owner's captain-account authorization. The captain's independently verified publication result was supplied as a report, preserving the original worker's blocked report privately. This was a captain-produced report. Check worker report and resume then re-read TEST PR #9 through Amun's GitHub connection, matched its live branch and head to the delivery worktree and linked the PR to the story. The run passed in 29.0 seconds after the owner unlocked the Mac Keychain dialog. The report-link ledger now records the completed run and verified PR revision.
