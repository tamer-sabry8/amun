# M0 local Mac execution — 2026-11-06

Execution verified: Darwin, Apple silicon; initial working directory /Users/tamersabry/Documents/ChatGPT/Amun. The proposed /Users/tamersabry/Projects/amun path did not exist. A clean clone of the existing feature branch was created there; origin is https://github.com/tamer-sabry8/amun.git and the fetched head was f2e726c. PR #1 was verified open, draft and unmerged with its existing check passing. No pre-existing Amun changes were overwritten.

The supplied original plan exists and is byte-identical to docs/plans/product-and-r1-plan.md. The screenshot is available. Current user decisions override the reference plan; no M1/M2 work is authorised by this evidence.

Read-only local inventory: Firstmate exists at /Users/tamersabry/Projects/firstmate, is clean and at pinned revision 4a67799d. Pi releases 1.3.0 and 1.4.0 exist with the official package metadata; .pi/agent/bin/pi and .local/bin/pi resolve to the same file. Codex 0.163.0 and Claude Code 2.1.311 are installed; their supported status commands report logged in (not inference evidence). tmux 3.8 exists at /opt/homebrew/bin/tmux. No personal sessions, locks, credential stores or installation versions were changed.

Existing Node installations did not include required 24.22.1. The official darwin-arm64 archive was downloaded to /tmp, verified against the official SHASUMS256.txt and extracted there; the system/default Node was not changed. Amun uses that explicit PATH and pnpm 11.25.0. Frozen-lockfile install succeeded.

At baseline f2e726c on this Mac: pnpm check (102 tests), test:e2e (2 tests), test:runtime, package, test:tmux, test:firstmate and test:packaged all passed. This establishes local unsigned packaging, source/packaged shell isolation and service recovery, bundled Pi discovery with empty PATH, synthetic private tmux isolation and Firstmate loading/missing-lock refusal. It does not prove actual worker dispatch, authenticated inference, watcher ownership, permission propagation or reattach.

Redacted configuration inventory inspected server names and transport-key presence only in Codex config.toml, Claude .claude.json/settings.json and Pi settings.json. No Azure DevOps server was present in those checked locations. Existing GitHub/ai-memory and computer tooling were not activated or copied. Other uninspected configuration locations may contain connections. No complete environments or secret values were printed.

Open user inputs: Azure collection/project/team and permitted story/task writes; a real authenticated browser site/account; Apple Developer signing/notarization credentials and clean-account acceptance. No PAT belongs in chat. Existing worker sign-ins do not establish portable Pi credentials. All T006–T012 remain open.
