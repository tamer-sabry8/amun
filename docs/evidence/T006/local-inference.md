# T006 — authenticated packaged Pi inference

2026-11-06 on the user’s Mac; code is in the containing commit. Pi 1.4.0 executes from the unsigned packaged app with empty PATH, private HOME/config, no tools, no extensions/MCP/skills, no saved session and automatic retries disabled. The prompt requests the exact fixed reply AMUN_OK. Available-model metadata and prompt acknowledgement are not accepted as completion: the proof requires text deltas, successful assistant stop and non-aborted agent_settled.

- OpenRouter / openai/gpt-4.1-mini: 401 available models, three text deltas, expected reply, successful stop and settled. Credential captured through Pi’s supported auth export without refresh and supplied only to this child in memory.
- GitHub Copilot / gpt-5.4-nano: 26 available models, three text deltas, expected reply, successful stop and settled. This is GitHub Copilot through Pi, not Microsoft Copilot.
- The original plain-token reuse failed HTTP 401. Preserving the selected OAuth metadata through Pi’s public SDK and isolated credential store fixed the authentication path. The old gpt-4.1 model then failed HTTP 400 because it was absent from the current offered models; selecting the offered gpt-5.4-nano passed. Model listing alone was not treated as authenticated inference.
- Only the selected OAuth credential is temporarily placed in a 0600 file within a 0700 isolated directory and removed in cleanup. Pi may refresh that disposable copy. The personal credential file was hash-compared before/after and remained unchanged; contents and hashes were not logged.

Unit tests reject malformed credentials, unsupported token reuse, failed/aborted output, oversized output and acknowledgement-only completion. Red evidence is adjacent. This proves packaged inference and compatible selected reuse. Service/UI streaming and extension dialogs, selection/onboarding UI and full T006 acceptance remain open.
