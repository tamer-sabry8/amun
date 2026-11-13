# Amun agent instructions

## Firstmate homes

Amun-managed Firstmate homes must be real Git worktrees backed by an Amun-owned Git repository. The user explicitly confirmed this requirement on 2026-11-06 for all future Amun work.

Provision and validate Git worktree identity before Firstmate seeding, dispatch, supervision or reattachment. A copied source directory or packaged snapshot alone does not satisfy the home requirement. Keep the packaged pinned runtime distinct from writable operational worktrees.

Preserve personal Firstmate/Herdr/Pi checkouts, homes, active sessions, locks and configurations. Never repair Amun's worktree setup by switching the user's checkout branch, resetting it, or adopting a personal worktree. Use isolated Amun-owned repository/worktree state and record real acceptance evidence.

The owner grants standing folder trust for disposable Amun-owned Git worktrees. Verify the worktree and repository identities and apply trust in the Amun test profile without asking again. Scope trust to the individual worktree. For every user, automatically accept the corresponding Firstmate and secondmate hook prompts in that disposable scope. Verify the hook definitions and executable sources against the selected Firstmate revision and reviewed overlay. Keep real repositories, persistent worktrees, personal profiles and unrelated hooks outside this policy.

## External tool updates

The user revised this policy on 2026-11-06: keep Claude 2.1.319 and allow supported updates of external apps/CLIs used by Amun. Do not impose blanket updater-disable flags or automatically restore an older launcher. Use supported updater mechanisms; preserve personal configurations, credentials, working directories, locks and running sessions. Do not restart active workers to apply an update.

Treat installed versions as discoverable capabilities, not fixed assumptions. Record versions before and after acceptance; test the changed integration with the installed release and report incompatibility explicitly. Existing worker processes may still run an older executable; launcher updates do not prove those processes changed version. A version string or successful sign-in alone is not authenticated inference evidence.

Bundled Pi/Firstmate/native dependencies remain reproducibly pinned and checksum-verified. Update those through reviewed dependency changes and relevant source/packaged acceptance; do not silently replace packaged resources. Permission to support updates does not expand M0 or authorize unrelated bulk upgrades.

### Firstmate candidate, approval and rollback

Resolve upstream Firstmate main to an exact commit for each requested update. Fetch into a disposable Amun-owned Git worktree, reapply the selected backend, crew dispatch, permission policy and skills overlay, and record conflicts. Run Pi RPC replay, the actual amun-bridge approval-gate suite, and a real Codex and Claude dispatch and recovery smoke in an isolated named Herdr session. This Herdr test is specific to the candidate. Preserve the user's personal fleet and verify the same workers after restart without spawning replacements.

Report the commit, checksum, changes, overlay results and every gate. A missing or failed gate blocks promotion. Only explicit approval of the tested candidate can change the bundled pin. Retain the previous verified revision and checksum for one-click rollback. Never run the upstream update skill on an operational home or apply an update automatically.

## Sharing destinations

The user selected Notion as Amun's R1 default for sharing conversations, PRDs, decisions and stakeholder updates (ADR-010). Disable Pi's native `/share`; never fall back to GitHub gist or Radius. Share to Notion requires an Amun connection, a user-chosen parent section, secret removal and exact-content review before a new page is published. Keep publishing blocked when prerequisites are missing. Transfrm.ai (GitHub/Cloudflare-hosted HTML/PDF) is R2 reference only.

## Connector authentication

The user selected browser sign-in through each provider's official hosted MCP server as the preferred connection route on 2026-11-06. Investigate this route first for Amun connectors whenever the provider supports it. Azure DevOps is explicitly excepted: preserve its supported API/MCP authentication path and company Edge requirements; do not substitute browser-session or cookie extraction.

For Notion, replace the manual integration-token onboarding with official hosted MCP OAuth in an external browser. Respect the user's browser choice and company restrictions (Microsoft Edge for company sign-ins; Edge or Dia for Notion). Do not introduce a manual-token alternative merely because a reference proposal includes one. If hosted MCP browser authentication is unavailable or incompatible, verify and explain the supported alternatives before changing the connection approach; never invent support or silently fall back.

Keep credentials in Amun's protected service-owned storage, never in renderer state, logs or exports. Authentication does not authorize publication: preserve governed writes, exact-content review, destination binding and uncertain-write reconciliation. This preference does not expand milestone scope or prove a connector's live acceptance.

## Trusted tester beta and release signing

On 2026-11-10 the owner selected an ad-hoc-signed R1 beta for trusted testers on Apple-chip Macs. Developer ID signing and notarization are deferred to the final step of R2. Do not claim Apple verification, notarization or public-release readiness for the beta. Preserve the 500 MiB memory budget and report its actual acceptance result. Keep the proper Developer ID release path separate from the explicit beta mode.

## Public hosting

Every workspace owner chooses a hosting provider and hostname before hosted publication. Use `https://amun.transfrm.ai` only for Tamer’s own setup. The user owns the parent zone in Cloudflare. Use Cloudflare's hosted API MCP with Code Mode for the hosting acceptance test. Inspect existing records, bind each proposed operation to the intended zone and hostname, and verify DNS and HTTPS after deployment. Track the GitHub web callback separately from device sign-in.

## Interface redesign approval

The user requires explicit approval before starting T022c (neumorphic interface redesign). Keep the task recorded but do not begin design or implementation until asking and receiving approval. The provided HTML is reference only; its colors are not selected. Continue independent M1 work while this task awaits approval.

## Local Firstmate memory

Amun runs `/stow` entirely on the Mac. It may read the selected conversation, crew memory files, local backlog and per-home budget. Apply ordinary edits automatically. Show each proposed change to a pinned entry for individual review. Retain the decision in the owned home and reuse it across restarts. Use the existing Firstmate memory files and tier markers. A prior decision settles the same question until its underlying rule or evidence changes.

## Reuse owner approvals

Carry the owner's approval through Firstmate, secondmates, retries and restarts for the same authorized scope. Consult recorded decisions and approval bindings before asking again. Continue routine implementation, recovery and verification within that scope autonomously. A changed payload, destination or source head must pass the corresponding exact review. Describe the changed decision when owner input is required.

For the M6 synthetic keyboard acceptance journey, the owner approved the Firstmate and secondmates, captain-account TEST publication in tamer-sabry8/amun, and continued Mac acceptance through completion or a new owner decision. Use the isolated TEST branches and worktree for the synthetic story. Preserve the recorded M4 worker-check waiver.

## Keychain access lifetime

Normal Amun use should require Keychain authorization once per Mac user and installation. Keep credentials in persistent app-owned entries with stable workspace/connection identities. Update an existing entry during credential rotation. Reuse the same entry across reads, service recovery and app restarts. Preserve a stable signed app/helper identity for release acceptance. Delete credentials when the user explicitly disconnects or removes them.

Acceptance harnesses must retain a temporary real-provider entry throughout the entire reviewed journey, including retries and failures. Remove it after the final verified workflow cleanup. Exercise ordinary persistence with a synthetic credential created by the packaged Amun service, so a Node-created test entry cannot be mistaken for normal app behavior.

## Workflow wiring (13 November 2026 handoff)

The owner's workflow handoff is `Amun-Claude-Code-workflow-handoff.md` in the owner's Amun folder; it takes precedence over older documents that describe a broader rebuild. The work is wiring existing capabilities into the current interface, on branch `claude/amun-workflow-wiring-e0ccc3`.

Every UI change needs the owner's approval before implementation. Show the actual current screen beside the proposed change in an annotatable preview, say which workflow it enables, and wait. Run every UI change through the `/impeccable` skill. Approval of a workflow does not approve its visual design.

Live-test destinations chosen by the owner:

- Azure DevOps: project `TahalufCollection / POCs` only. Stories go to the `POCs Team` board, level `Backlog items`. Repository and wiki tests use the `tamer-test1` repository in that project.
- Notion: child pages under `test for Amun to use`. That page is the publishing-test destination only, not a memory parent unless the owner selects it.

Several agents work in this repository at once, including a crash investigation on other branches. Stay on this branch and its worktree; do not touch other worktrees or branches.
