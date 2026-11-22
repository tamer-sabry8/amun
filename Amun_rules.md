# Amun rules

## Firstmate and crew

- **Captain → Firstmate → crew.** The captain talks to one Firstmate per home through Pi. Firstmate delegates substantive work to the crew, supervises it, and reports results in plain language. Amun does not act as a second orchestrator.
- **Role routing.** Use existing registered specialists by role and remit. Creating a product, project, or chat does not create or assign a crew member. The UI must not send prompts or commands directly to crew terminals.
- **Crew visibility.** Show the real roster, reported status, and a read-only Watch view. Send crew creation, editing, or retirement requests through Firstmate. Save a retiring crewmate’s work before teardown.
- **Firstmate owns its home.** Relay the captain’s rules and decisions. Firstmate decides where to file them. Amun must not edit its charters, dispatch configuration, memory, backlog, state, wake queue, or vendored source.
- **Worktree isolation.** An Amun-managed home must be a real Git worktree backed by an Amun-owned repository. Firstmate owns crew worktrees. Do not take over, reset, switch, or interrupt personal Firstmate, Herdr, or Pi checkouts, sessions, or locks.
- **Worktree trust.** Reuse standing folder trust and reviewed hook acceptance only for verified, disposable Amun-owned worktrees in the test profile. Keep persistent and personal repos and unrelated hooks outside that scope.

## Pi, Paseo and external tools

- **Pi runtime.** Run Firstmate headlessly through Pi RPC in its selected home. Keep native startup, turn-end guard, watcher and wake behavior. Test on the Mac and tell the captain before changing to the Pi SDK fallback.
- **Paseo boundary.** Use Paseo to host Pi, carry messages, and support read-only tools and heartbeats to Firstmate. Do not use Paseo to spawn, message, kill, schedule, assign or provision Firstmate crew or worktrees.
- **Upstream and bundled updates.** Keep vendored Firstmate pristine and bundled runtimes pinned and checksum-verified. Test each exact update with native gates, isolated Codex and Claude dispatch and recovery. Require approval before changing the pin and keep the last verified build for rollback.
- **Installed CLIs and sign-in.** Use supported external updaters without blanket disabling or restarting active workers. Preserve personal settings and credentials. Use Pi’s own sign-in for Claude Pro/Max, ChatGPT and Copilot. Verify actual inference when accepting a runtime change.
- **Council exception.** Keep upstream Roast Room’s flow. The Chair runs through Claude Code, asks for missing facts, recommends a council, and waits for confirmation before running it. Do not use this exception to start Firstmate crew.

## Chats, decisions and interface

- **One chat context at a time.** Use ordinary chats inside General and work folders. Sprint chats live under their product or project or Initiative. Each message carries its chat identity. Never create another Firstmate or Pi session per chat or swap Firstmate’s memory.
- **Filing and reassignment.** File explicit new work using the existing routing rules. Ask on duplicate names or topic drift. Never move a chat without consent or silently reassign its open requests. Confirm reassignments individually through Firstmate.
- **Send and recover.** Keep drafts across navigation and restart. Clear the submitted draft when accepted and preserve any new text. Allow unrelated conversations and messages while work runs. Retry only confirmed undelivered work without duplicate effects and use a follow-up to correct accepted messages.
- **Request identity and progress.** Use the same request reference across messages, retries, moves and reports. Match by confirmed reference. Never guess from timing or wording. Unmatched reports stay visible and an unavailable snapshot means status is unknown.
- **Replies and attention.** Return results and decisions to the originating chat as they arrive. Show genuine blockers or questions in the Island and store answers in the original chat. Suppress duplicate and no-change background messages. Preserve unread and reading position.
- **Ask only when needed.** Ask one material question at a time with choices, a recommendation and room for a custom answer. Reuse the captain’s approvals across retry and restart within their approved scope. Continue independent work while a dependency waits.
- **Use the approved design.** Use Impeccable and show current and proposed UI in a reviewable before-and-after preview. Wait for approval of the actual visual change. Use plain copy and existing patterns. Keep text readable, preserve approved animations, and keep the composer clear of new controls apart from the approved model picker. Get approval before revisiting a declined or deferred design.
- **Interaction scope.** Send substantive actions to Firstmate with the affected record and originating request. Keep typing and planning gestures local until submission. For the approved delivery flow, navigation read intents go to Activity only and never authorize a write.

## PRDs, planning and provider actions

- **PRD intake and drafting.** Firstmate delegates discovery and PRD work to Product Manager with any relevant specialists. Use the authorized source and version, read it in full when asked, ask only consequential questions, and return a concise editable brief to the original request.
- **Document ownership and approval.** Link accessible uploads and crew deliverables to their original chat and Library, with one logical document and version history. Historical replies open their exact version. Approval applies only to that version. Ask to attach or relink sources that cannot be opened.
- **Planning from the PRD.** Compare against the project’s selected backlog first. Draft locally if access is missing. Expose epics, stories, acceptance criteria and sprint assumptions in the review views. A local draft must not publish or commit a sprint.
- **Review and delivery authority.** Keep brief, backlog publication, sprint commitments, PR merge and external sending within their own authorized scope. Preserve the existing provider flows. Preview affected records and destination where the workflow calls for it. Reconcile uncertain writes before retrying.
- **Connected services and data.** Prefer official hosted MCP browser sign-in. Use the approved Azure DevOps PAT/API and company Edge path. Notion uses hosted MCP OAuth with the chosen browser. Verify saved connections with read-only checks. Never type the user’s credentials, extract cookies or expose secrets.
- **Isolation and sharing.** Keep groups isolated unless the captain authorizes sharing. Use the selected Notion parent for R1 sharing and remove secrets. Preserve stable Keychain entries and avoid repeated access prompts. Do not enable native Pi /share, fall back to gist or Radius, or send /stow to Firstmate.
- **Outputs and cleanup.** Keep delivered artifacts and dependencies outside disposable worktrees, linked from chat and Library. Verify recovery before cleanup. Preserve ignored, untracked, local-only or uncertain work and ask about specific unresolved items before destructive action.

## Engineering, measurements and release

- **Git and CI.** Work in a separate branch and worktree. Never reset another checkout or reopen PR #10. Merge only with authorization and green checks on the final head. Keep changes reversible and report exactly what was verified.
- **Installed size.** Keep the installed Amun.app around 538 MB. The recorded Finder baseline is 537,733,552 bytes. Measure the installed app the same way each build and report the difference. Track DMG download size separately.
- **Memory and timing.** Keep packaged working set within 500 MiB across all measured Amun processes at the first screen and Home. Record startup and PRD timing separately. The historical startup gate is 3 seconds. The current full 504-line PRD-read goal is 10 seconds. Measure on the Mac without changing the test to claim a pass.
- **Release and verification.** Verify what ships in an isolated Mac profile and report any untested behavior. Do not present ad-hoc builds as Developer ID signed or notarized. The current unsigned manual release was explicitly authorized. Do not assume it changes the standing signing policy.

## Terminology

- **Rule 31 · Initiatives.** Call standalone tasks **Initiatives**. Use the usual task terminology for tasks within projects, products, or stories.
