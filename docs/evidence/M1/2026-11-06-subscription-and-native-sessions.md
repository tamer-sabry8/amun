# Subscription inference and native session lifecycle

2026-11-06, actual macOS development machine. Acceptance uses Amun-owned state, not personal CLI/Pi sessions.

## Subscription evidence

- Codex CLI 0.163.0: official status reports ChatGPT sign-in in the separate `workers/m0-codex` profile. The original one-shot diagnostic left stdin open; it produced no completed response. Closing unused stdin resolves the probe. The repository `scripts/subscription-inference-proof.ts codex` now reports completed turn, exact expected reply, and zero tool items using read-only sandbox and ephemeral execution. No API key substitution or credential import.
- Claude Code 2.1.319: separate `workers/m0-claude` profile reports claude.ai sign-in. Real restricted, no-tools, no-MCP, nonpersistent inference returned the exact expected reply. Normal macOS HOME is retained only for supported Keychain discovery; CLAUDE_CONFIG_DIR remains isolated.
- Pi OpenAI/Codex: user completed official authorization in Edge. The packaged pinned Pi runtime used Amun's private M1 acceptance auth directory, an empty PATH and disabled tools/resources. `openai-codex/gpt-6-luna` returned the exact expected reply in three stream deltas with successful assistant stop and settled agent. Private authorization remains stored for Amun; no personal credential refresh or copying occurred.
- Copilot and OpenRouter inference are recorded separately in the tenant-fix evidence. Configured status alone is never treated as inference acceptance.

Regression: `closed-input.test.ts` initially failed because the transport was absent (`/tmp/amun-closed-input-red.log`). The implementation closes stdin for one-shot commands and bounds execution/output; real subprocess tests cover EOF completion, nonzero exit, oversized output, stalled processes and sanitized failures (`/tmp/amun-closed-input-green.log`). Interactive login uses a separate transport and must not receive this automatic EOF behavior.

## Native session evidence

The native SDK worker now uses AgentSessionRuntime for new/resume/clone/fork and actual tree navigation. Session selection resolves only IDs from the owned directory; path escape, symlinks and foreign working directories are rejected before switching. Personal sessions are not adopted.

Source UI lifecycle acceptance passed in 3.2 seconds. Packaged UI lifecycle acceptance passed in 3.3 seconds (`/tmp/amun-native-lifecycle-packaged.log`): name, new, resume an SDK-created saved fixture, clone at current entry, select a tree entry, fork an earlier user entry. This is real SDK behavior with a synthetic saved conversation, not live model inference or Firstmate supervision evidence. Pi saves empty setup-only sessions after their first conversation message; the UI states that behavior.

T016b remains open for native CLI controls and current worker ownership/permissions/reconnect acceptance. T022a remains open for the other command families and full presentation/interaction requirements. Flat tree-entry selection is not a finished hierarchical session browser. M1 is incomplete and M2 remains locked.

## Native controls follow-up

Native CLI status and inference controls now pass in both source and packaged Electron, using the same isolated official CLI profiles. Codex is launched with the packaged Electron Node mode for its installed JavaScript launcher; Claude uses its native executable. No interactive-shell PATH or API-key substitution is needed. Invalid/missing profiles refuse execution. Unit tests cover subscription-versus-API-key status, completed expected responses and rejected tool activity/incomplete output.

Native clipboard copy validates the bounded text payload and checks the exact shell webContents/main frame; foreign contents/subframes are refused. Source and packaged tests copied a real SDK fixture reply to the system clipboard and restored the prior text. Quit closes only the native Pi session; Amun remains connected. Scope selection persists through Pi's settings API; Previous/Next and Ctrl+P/Shift+Ctrl+P restore that scope before invoking SDK model cycling. Real source SDK acceptance toggled and restored the original model scope and selected a model successfully.

Local checks: 287 tests, lint, types and formatting pass. Source native lifecycle/copy/quit test: 3.5 seconds. Packaged: 9.6 seconds. The first packaged attempt was launched before packaging finalized and failed to launch; it is not acceptance evidence. The recorded pass was rerun after successful finalization. RED/GREEN logs: `/tmp/amun-clipboard-red.log`, `/tmp/amun-clipboard-green.log`, `/tmp/amun-subscription-worker-red.log`, `/tmp/amun-subscription-worker-green.log`, `/tmp/amun-scoped-red.log`, `/tmp/amun-scoped-green.log`, `/tmp/amun-cycle-red.log`, `/tmp/amun-cycle-green.log`. CLI UI live proofs emitted only sanitized success statements.

Packaged scoped-model selection/cycling also passed after successful package finalization. Coverage checks pass, including the domain/governance thresholds. Implementation and verification are committed together; subsequent evidence revisions identify the exact resulting commit.
