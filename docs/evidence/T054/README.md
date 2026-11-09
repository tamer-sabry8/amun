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
