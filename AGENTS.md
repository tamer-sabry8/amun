# Amun agent instructions

## Firstmate homes

Amun-managed Firstmate homes must be real Git worktrees backed by an Amun-owned Git repository. The user explicitly confirmed this requirement on 2026-11-06 for all future Amun work.

Provision and validate Git worktree identity before Firstmate seeding, dispatch, supervision or reattachment. A copied source directory or packaged snapshot alone does not satisfy the home requirement. Keep the packaged pinned runtime distinct from writable operational worktrees.

Preserve personal Firstmate/Herdr/Pi checkouts, homes, active sessions, locks and configurations. Never repair Amun's worktree setup by switching the user's checkout branch, resetting it, or adopting a personal worktree. Use isolated Amun-owned repository/worktree state and record real acceptance evidence.

## External tool updates

The user revised this policy on 2026-11-06: keep Claude 2.1.319 and allow supported updates of external apps/CLIs used by Amun. Do not impose blanket updater-disable flags or automatically restore an older launcher. Use supported updater mechanisms; preserve personal configurations, credentials, working directories, locks and running sessions. Do not restart active workers to apply an update.

Treat installed versions as discoverable capabilities, not fixed assumptions. Record versions before and after acceptance; test the changed integration with the installed release and report incompatibility explicitly. Existing worker processes may still run an older executable; launcher updates do not prove those processes changed version. A version string or successful sign-in alone is not authenticated inference evidence.

Bundled Pi/Firstmate/native dependencies remain reproducibly pinned and checksum-verified. Update those through reviewed dependency changes and relevant source/packaged acceptance; do not silently replace packaged resources. Permission to support updates does not expand M0 or authorize unrelated bulk upgrades.

## Sharing destinations

The user selected Notion as Amun's R1 default for sharing conversations, PRDs, decisions and stakeholder updates (ADR-010). Disable Pi's native `/share`; never fall back to GitHub gist or Radius. Share to Notion requires an Amun connection, a user-chosen parent section, secret removal and exact-content review before a new page is published. Keep publishing blocked when prerequisites are missing. Transfrm.ai (GitHub/Cloudflare-hosted HTML/PDF) is R2 reference only.

## Connector authentication

The user selected browser sign-in through each provider's official hosted MCP server as the preferred connection route on 2026-11-06. Investigate this route first for Amun connectors whenever the provider supports it. Azure DevOps is explicitly excepted: preserve its supported API/MCP authentication path and company Edge requirements; do not substitute browser-session or cookie extraction.

For Notion, replace the manual integration-token onboarding with official hosted MCP OAuth in an external browser. Respect the user's browser choice and company restrictions (Microsoft Edge for company sign-ins; Edge or Dia for Notion). Do not introduce a manual-token alternative merely because a reference proposal includes one. If hosted MCP browser authentication is unavailable or incompatible, verify and explain the supported alternatives before changing the connection approach; never invent support or silently fall back.

Keep credentials in Amun's protected service-owned storage, never in renderer state, logs or exports. Authentication does not authorize publication: preserve governed writes, exact-content review, destination binding and uncertain-write reconciliation. This preference does not expand milestone scope or prove a connector's live acceptance.

## Public hosting

Every workspace owner chooses a hosting provider and hostname before hosted publication. Use `https://amun.transfrm.ai` only for Tamer’s own setup. The user owns the parent zone in Cloudflare. Use Cloudflare's hosted API MCP with Code Mode for the hosting acceptance test. Inspect existing records, bind each proposed operation to the intended zone and hostname, and verify DNS and HTTPS after deployment. Track the GitHub web callback separately from device sign-in.

## Interface redesign approval

The user requires explicit approval before starting T022c (neumorphic interface redesign). Keep the task recorded but do not begin design or implementation until asking and receiving approval. The provided HTML is reference only; its colors are not selected. Continue independent M1 work while this task awaits approval.
