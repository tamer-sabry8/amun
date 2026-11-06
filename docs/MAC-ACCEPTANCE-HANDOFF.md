# Local Mac acceptance handoff

## Execution boundary

The current task executes on Linux in `/workspace/amun`. Direct checks found none of the `/Users/tamersabry/...` paths below, and no local Mac execution tool is attached. The Codex desktop UI and this task's execution host are different. The user's screenshot and reported paths establish setup context, not a completed local inspection.

Run the next credentialed acceptance work in a local Codex task opened in the Amun checkout on the user's Mac. Fetch branch `feat/m0-electron-foundations` from `tamer-sabry8/amun`; inspect working-tree changes before switching. Do not reset or overwrite local work. Draft PR: https://github.com/tamer-sabry8/amun/pull/1.

## User-supplied installation locations

- Firstmate checkout: `/Users/tamersabry/Projects/firstmate`
- Pi launcher: `/Users/tamersabry/.pi/agent/bin/pi`
- Alternate Pi launcher: `/Users/tamersabry/.local/bin/pi` (reported to resolve to the same file)
- Pi package: `/Users/tamersabry/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent`
- Installed releases reported: 1.3.0 and 1.4.0; active session reports 1.4.0.
- Codex CLI and Claude Code CLI are installed and signed in, per the user; paths and readiness still need local verification.
- Herdr currently hosts personal Pi/Firstmate sessions. Preserve those sessions.

## Local agent instructions

Continue M0 only, using TDD and the milestone tracker. Read repository instructions first. Inspect the Firstmate checkout read-only: git revision/status, backend documentation and package metadata. Resolve the supplied Pi links without running shell startup scripts. Do not dump auth files, MCP environment secrets, browser cookies, or process environments.

Inventory supported CLI/MCP integration configuration with redaction, and identify what can be reused through supported APIs. The user's authorisation is to run acceptance tests using existing sign-ins; never silently migrate or overwrite their personal configuration. Amun's credential-reuse adapter and user-facing selection are not implemented yet.

Before any real worker run, finish and test isolated session ownership, persisted reconnect and permission propagation. Existing probes use synthetic homes and do not prove credential reuse or authenticated worker dispatch. Do not point the existing home-creation/probe scripts at the user's personal home as a shortcut.

For Azure DevOps, use an existing authorised API/MCP connection if compatible. Otherwise arrange secure PAT entry locally; do not request its value in chat. Identify the test organisation/project and permitted test writes before creating records. Edge sign-in alone is insufficient.

Unsigned development tests may run without Apple sign-in. Record the missing release-signing/notarization setup as an open T012 gate. Never mark M0 complete using synthetic evidence for live acceptance requirements.

See `docs/evidence/M0-acceptance-prerequisites.md`, `docs/TASKS.md` and ADR-007 for scope and remaining gates.
