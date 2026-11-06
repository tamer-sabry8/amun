# Separate worker sign-in acceptance — 2026-11-06

Codex 0.163.0's official browser login completed in Chrome and `codex login status` reported ChatGPT authentication in the separate Amun profile. The profile has its own HOME and CODEX_HOME, file credential storage, read-only sandbox and on-request approval. Personal CLI configuration and sessions were not changed.

A real `codex exec --ephemeral --sandbox read-only --skip-git-repo-check --json` run in that profile returned the exact requested AMUN_CODEX_OK agent message and a `turn.completed` event with exit 0. The prompt prohibited tool use. Raw events, credentials and OAuth URLs were withheld. This proves authenticated CLI inference, not Firstmate dispatch, operational supervision or reattachment.

An earlier exploratory selected-access-token import was rejected by `codex login --with-access-token`. The CLI's agent-identity token format is not established as compatible with cached ordinary ChatGPT access tokens. `scripts/codex-access-proof.ts` is retained only as a failed compatibility diagnostic, not wired into the application; its positive acceptance gate remains false. No refresh token was copied, and the personal credential file hash was unchanged. Do not reuse this route as an onboarding adapter.

Claude 2.1.311's separate profile reported loggedIn=false. Its first headless official login timed out without a confirmed browser launch. A visible Terminal retry using the same isolated profile and Chrome was opened for the user; completion remains unverified. No credentials or verification codes should enter chat or evidence logs.

## Successful Claude retry and browser opening fix

The user completed Claude login after restoring normal HOME while retaining the separate CLAUDE_CONFIG_DIR. A direct non-secret diagnostic established that `security default-keychain -d user` fails with the synthetic HOME and succeeds with normal HOME. The problem was this launch environment, not evidence that the user's Keychain was locked. Claude's official documentation confirms that CLAUDE_CONFIG_DIR selects a separate Keychain entry: https://code.claude.com/docs/en/authentication. No Keychain contents were printed or copied.

The separate profile now reports loggedIn=true. A real Claude print-mode inference with safe-mode, strict MCP configuration, no tools, auto permissions and no session persistence returned AMUN_CLAUDE_OK with a successful result and exit 0.

The earlier login helper omitted the actual claude.com authorization host, so it failed to open the emitted URL. The committed visible-Terminal helper `node scripts/worker-login.ts claude` recognizes the exact official authorization host/path and opens Chrome with argument-array execution. Tests reject lookalikes, credential-bearing URLs, alternate ports/paths and excessive input; split output waits for a complete URL and opens only once. Official codes remain local Terminal input. The helper's URL-opening callback is unit-tested; a fresh live OAuth round-trip has not been repeated after the already successful login.
