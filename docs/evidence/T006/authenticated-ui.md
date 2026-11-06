# Authenticated Pi service/UI acceptance — macOS 2026-11-06

Pi 1.4.0 is launched by the bundled Electron binary with an empty PATH. Explicit provider buttons select only OpenRouter or GitHub Copilot credentials through Pi's public `readStoredCredential` API. The selected fields are validated and written into a private temporary Amun config; personal MCPs, skills, tools and configuration are not loaded. This is compatibility-tested reuse, not a general sign-in broker.

Both source and packaged UI runs listed models, streamed the exact AMUN_OK reply, and observed successful assistant stop plus agent-settled. Neither available-model metadata nor prompt acknowledgement counted as authenticated inference. Personal Pi auth-file hashes were unchanged. The final packaged rerun includes cleanup on service pipe closure. GitHub Copilot here means GitHub Copilot through Pi, not Microsoft Copilot.

The installed Pi OpenRouter OAuth implementation returns a non-expiring API key with empty refresh and MAX_SAFE_INTEGER expiry. A failing test established that the original API-key-only selector rejected this real supported shape; the selector now accepts exactly that shape and rejects executable/indirect key values. Unknown credential/model fields never reach renderer IPC.

TDD: model readiness/projection and stored-credential tests failed before implementation; executable-key and OpenRouter OAuth cases failed before their fixes. The live service-SIGKILL test initially timed out while its private-config canary remained. The app-authored Pi cleanup extension now removes that exclusive directory on stdin closure or normal shutdown. Invalid roots are unit-tested. Both source and packaged crash tests pass. Whole-machine failure or simultaneous hard-kill of service and Pi is not covered by that cleanup proof.

Validation for the commit containing this evidence: 166 unit tests, lint, typecheck and formatting; six source and six packaged Electron E2E tests; final packaged live UI inference for both providers. Adjacent logs contain sanitized results. A local browser fixture intermittently failed in earlier runs; diagnostic-only state capture was added, and final source/package runs passed without retries. Its cause is not established. T010 authentication remains blocked separately.

The M0 Pi proof is implemented, but T006 stays open pending a final acceptance audit against the complete fixture and credential-lifecycle requirements. No broader onboarding/auth broker or finished product UI is claimed.
