# Separate worker sign-in acceptance — 2026-11-06

Codex 0.163.0's official browser login completed in Chrome and `codex login status` reported ChatGPT authentication in the separate Amun profile. The profile has its own HOME and CODEX_HOME, file credential storage, read-only sandbox and on-request approval. Personal CLI configuration and sessions were not changed.

A real `codex exec --ephemeral --sandbox read-only --skip-git-repo-check --json` run in that profile returned the exact requested AMUN_CODEX_OK agent message and a `turn.completed` event with exit 0. The prompt prohibited tool use. Raw events, credentials and OAuth URLs were withheld. This proves authenticated CLI inference, not Firstmate dispatch, operational supervision or reattachment.

An earlier exploratory selected-access-token import was rejected by `codex login --with-access-token`. The CLI's agent-identity token format is not established as compatible with cached ordinary ChatGPT access tokens. `scripts/codex-access-proof.ts` is retained only as a failed compatibility diagnostic, not wired into the application; its positive acceptance gate remains false. No refresh token was copied, and the personal credential file hash was unchanged. Do not reuse this route as an onboarding adapter.

Claude 2.1.311's separate profile reported loggedIn=false. Its first headless official login timed out without a confirmed browser launch. A visible Terminal retry using the same isolated profile and Chrome was opened for the user; completion remains unverified. No credentials or verification codes should enter chat or evidence logs.

## Successful Claude retry and browser opening fix

The user completed Claude login after restoring normal HOME while retaining the separate CLAUDE_CONFIG_DIR. A direct non-secret diagnostic established that `security default-keychain -d user` fails with the synthetic HOME and succeeds with normal HOME. The problem was this launch environment, not evidence that the user's Keychain was locked. Claude's official documentation confirms that CLAUDE_CONFIG_DIR selects a separate Keychain entry: https://code.claude.com/docs/en/authentication. No Keychain contents were printed or copied.

The separate profile now reports loggedIn=true. A real Claude print-mode inference with safe-mode, strict MCP configuration, no tools, auto permissions and no session persistence returned AMUN_CLAUDE_OK with a successful result and exit 0.

The earlier login helper omitted the actual claude.com authorization host, so it failed to open the emitted URL. The committed visible-Terminal helper `node scripts/worker-login.ts claude` recognizes the exact official authorization host/path and opens Chrome with argument-array execution. Tests reject lookalikes, credential-bearing URLs, alternate ports/paths and excessive input; split output waits for a complete URL and opens only once. Official codes remain local Terminal input. The helper's URL-opening callback is unit-tested; a fresh live OAuth round-trip has not been repeated after the already successful login.

## Unintended CLI update and correction

The first real Claude worker was launched without disabling its updater. During acceptance the shared ~/.local/bin/claude symlink changed from retained 2.1.311 to 2.1.319. This violated the intended version-preservation boundary and was disclosed to the user. Restoration of that shared launcher was requested explicitly and remains pending; no automatic rollback was performed. Existing worker processes remain on their originally launched executable.

Amun's own worker environment and separate Claude profile now set DISABLE_UPDATES=1 and DISABLE_AUTOUPDATER=1; tests require these flags. The canonical AGENTS.md records that launchers must disable updates before execution and verify installed versions. The documented flags are at https://code.claude.com/docs/en/env-vars. Amun-owned profiles also disable account-linked Claude MCP servers for this bounded proof.

## User-approved update policy — 2026-11-06

The user explicitly chose to keep Claude 2.1.319 and allow supported external-tool updates. This supersedes the temporary updater prohibition and pending restoration request above. The launcher was not reverted. Removed updater-disable flags from Amun's worker environment and only its separate Claude profile; personal configuration and active sessions were preserved. The regression test first failed on the old disable flags, then passed after removal. AGENTS.md now requires compatibility verification of changed integrations, preserves running sessions, and distinguishes external updates from reproducibly pinned packaged runtimes.

A fresh no-tool, strict-MCP, safe-mode inference in the existing Amun Claude profile completed successfully with the exact expected reply. The CLI reported 2.1.319 before and after. This verifies updated authentication/inference compatibility; existing long-lived Firstmate workers remain on their previously launched executable. It does not claim dispatch/reconnect acceptance was repeated with new 2.1.319 workers or that every future release will be compatible.
