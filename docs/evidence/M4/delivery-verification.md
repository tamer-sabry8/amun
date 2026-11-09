# M4 delivery verification

## Story delegation (T041)

On macOS, the test initialized a real Git repository, reviewed an immutable commit and created a separate branch and worktree. Reopening the run retained its edits. An unrelated origin was refused. A second test drove the approved story through a worker blocker, a PM decision and a resumed delivery. It accepted the PR report only when its source branch and head matched both the worktree and the provider response. The delivery and provider in that second test were local substitutes. A restricted worker publishing a PR on a pilot host is outstanding.

## Prototype feedback (T042)

A real Claude Designer worker in a disposable Firstmate crew accepted a bounded synthetic PRD brief through its durable inbox. The Mac app opened the returned design in an isolated browser. The test pinned feedback to one element, reviewed the resulting proposal and applied it. The PRD became draft v2. The test granted one-time reads for the named brief and output in the disposable run directory. The shared worker profile retained its existing permission settings.

The local Electron acceptance ran in 2.3 minutes. The packaged arm64 run passed in 2.7 minutes and separately reapproved v2, then read the exact feedback text and approved revision from SQLite. The preview server also passed its tests for selected-product scope, element identity, script escaping and origin-limited submissions.

## Pull request review (T044)

The Octokit adapter read the merged public M3 PR on GitHub. It returned 43 changed files, the head and source branch, a completed check, and the added verification document's before and after content. The merged PR offered no vote actions. The packaged Apple silicon application also opened an Azure PR and displayed its edited file in the read-only Monaco comparison against a disposable local TLS service. On a designated temporary GitHub repository, the packaged app loaded the PR list, computed the Monaco diff, submitted a native TEST comment, prepared and approved the exact head and merged into a dedicated TEST target. A separate GitHub read confirmed the comment on the reviewed commit and the merge commit on the TEST target. The packaged workflow passed in 29 seconds. Live Azure review remains outstanding because the project sign-in was rejected.

## Merge and acceptance (T045 and T046)

The packaged Mac application prepared and approved a merge. The fixture advanced the source branch before execution. The app displayed the stale-head refusal and the server observed zero writes. The PM then reviewed the new revision, approved it and executed it. The fixture required the expected head and checked that the completion request disabled policy bypass. The server observed one merge write. Database readback showed zero delivery decisions immediately after merge.

The same test used a staged story-to-PR relationship. The PM selected all three checklist entries, then submitted Blocked, Rejected and Accepted with distinct rationales. The app displayed each decision against the linked story. SQLite retained all three in order and the provider write count stayed at one. This packaged acceptance run passed in 2.3 seconds. Independent data tests verify that a different story, wrong revision or incomplete checklist cannot be accepted and replaying the identical submission stores it once.

Reproduction uses the packaged app with `tests/e2e/m4-pull-review.spec.ts`. This is fixture evidence for the Azure interaction. Server rejection of a worker merge and force-push and the live end-to-end delivery still require restricted worker sign-ins. The Azure reviewer also needs an authenticated connection to the designated project.

A second live GitHub TEST PR advanced by one commit after approval. The production delivery review service on the Mac re-read the live head and rejected execution before calling the merge writer. SQLite showed the original approval was invalidated. GitHub confirmed the PR remained open and the target commit was unchanged. This run used the authenticated CLI for the provider read. Repeating the packaged UI flow for this second PR stalled at macOS Keychain lookup. The first live PR exercised the packaged UI through merge.

The general packaged Apple silicon regression run took six minutes. All 44 executed tests passed. Sixteen conditional tests were skipped in that run. The live pilot and Designer runs above were invoked separately.
