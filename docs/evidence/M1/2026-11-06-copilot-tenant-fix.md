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
