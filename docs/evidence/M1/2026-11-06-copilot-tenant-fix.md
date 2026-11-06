# M1 Copilot company-tenant sign-in correction

2026-11-06. T016 remains open pending live authorization and inference. This change follows tested baseline `417fd3c`; the containing fix commit identifies the tested implementation.

The reported UI permitted entering a GitHub Enterprise Server repository host but did not explain the failure. Its Continue button also incorrectly refused an empty optional text answer. Separately, Amun’s browser allowlist accepted only github.com for Copilot, so a successful company GHE.com device response would have been rejected. Read-only inspection of the existing Pi configuration confirmed a different GHE.com tenant; no credentials were printed or imported.

The pinned Pi flow prompts for the host before requesting a device code. Amun now validates github.com or a single tenant.ghe.com host before that request, binds browser handoff to that exact selected tenant across worker/service/main, permits an empty optional text answer, and displays a bounded safe failure notice. Other tenants, lookalike domains, credentials, non-HTTPS URLs and non-default ports remain rejected. Secret/manual-code inputs still require a value. Provider server errors are not exposed to the renderer.

## Verification

- Meaningful RED: the optional-text test failed with the helper missing; the tenant test failed because `copilotHost` did not exist. Logs: `/tmp/amun-optional-red.log`, `/tmp/amun-enterprise-red.log`.
- GREEN: `pnpm check` passes, 264 tests across 61 files, including tenant mismatch and pre-request rejection tests; lint, types and formatting pass.
- Source Electron: both real Pi UI tests pass. Packaged Electron: both pass (12.6 seconds total). They establish optional text submission, wrong-host refusal and safe notice, and private API-key canary storage/readiness. They do not establish live Copilot inference.
- Package rebuilt using unchanged staged pinned runtimes/native dependencies. The separate M1 profile was reopened with the company tenant for official human authorization. Device codes remain only in the Amun/provider windows.
- Prior CI run 42229072158 reports failure with its unit job cancelled and no failed-step log returned. It is not counted as passing CI; the new pushed commit needs fresh CI.

No personal sessions or credential stores were changed. M2 and automatic merge remain out of scope.

## Follow-up: successful company authorization and feedback correction

The user completed company Copilot authorization in Microsoft Edge on 2026-11-06. The running packaged UI reported configured. A bounded packaged RPC request using only the new M1 acceptance profile completed successfully with gpt-5.4-nano: exact expected reply, three stream deltas, successful assistant stop and settled agent, with empty PATH and tools disabled. This proves live access; it does not rely on personal Pi credentials. The diagnostic reused the M0 proof harness with the auth directory changed to the persistent M1 profile; its inherited temporary-credential cleanup label is inapplicable (only its disposable working directory was removed).

The full packaged UI also reached the device-code notice in a separate disposable profile. Explicit Chrome selection conflicted with the user's company Edge requirement. Authentication handoff now explicitly selects Microsoft Edge, validated by unit tests and an actual successful Edge launch. The user authorized this browser change.

T016a regressions: duplicate sign-in remained enabled during an attempt (real source UI RED); missing repository/cloud-host explanation (real source UI RED); successful auth retained a stale error (bridge unit RED). Implemented duplicate-operation disabling, explanatory prompt text, and notice clearing on success/new attempt/cancel while retaining current failure feedback. Final package auth tests: 2 passed (14.3s). All unit/lint/type/format checks pass (266 tests). No device codes or credentials are recorded here.

T016 still needs OpenRouter live UI authorization. T022a is the user's explicit new M1 slash-command scope and remains open. CI at f42e29a failed visual baselines due different viewport/control dimensions on the runner; those failures remain to be resolved, not waived.

OpenRouter follow-up: the final Edge-enabled packaged UI completed official OpenRouter OAuth in the same private M1 profile. A bounded packaged no-tool openai/gpt-4.1-mini request returned the exact expected response with three stream deltas, successful assistant stop and settled agent. Copilot readiness persisted across the app restart. T016's live provider gate now passes; this does not complete the newly expanded M1.
