# M4 delivery verification

## Story delegation (T041)

On macOS, the test initialized a real Git repository, reviewed an immutable commit and created a separate branch and worktree. Reopening the run retained its edits. An unrelated origin was refused. A second test drove the approved story through a worker blocker, a PM decision and a resumed delivery. It accepted the PR report only when its source branch and head matched both the worktree and the provider response. The delivery and provider in that second test were local substitutes. A restricted worker publishing a PR on a pilot host is outstanding.

## Pull request review (T044)

The Octokit adapter read the merged public M3 PR on GitHub. It returned 43 changed files, the head and source branch, a completed check, and the added verification document's before and after content. The merged PR offered no vote actions. The packaged Apple silicon application also opened an Azure PR and displayed its edited file in the read-only Monaco comparison against a disposable local TLS service. Review submissions on the live pilot hosts remain outstanding.

## Merge and acceptance (T045 and T046)

The packaged Mac application prepared and approved a merge. The fixture advanced the source branch before execution. The app displayed the stale-head refusal and the server observed zero writes. The PM then reviewed the new revision, approved it and executed it. The fixture required the expected head and checked that the completion request disabled policy bypass. The server observed one merge write. Database readback showed zero delivery decisions immediately after merge.

The same test used a staged story-to-PR relationship. The PM selected all three checklist entries and recorded a Blocked decision with a rationale. The app displayed the story, decision and rationale, and SQLite retained the verdict. Independent data tests verify that a different story, wrong revision or incomplete checklist cannot be accepted and replaying the identical submission stores it once.

Reproduction uses the packaged app with `tests/e2e/m4-pull-review.spec.ts`. This is fixture evidence for the Azure interaction. Server rejection of a worker merge and force-push and the live end-to-end delivery still require designated pilot branches and worker sign-ins.
