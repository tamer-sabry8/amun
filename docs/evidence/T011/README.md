# T011 — native terminal proof

Real local Mac source and packaged Electron tests pass for node-pty 1.1.0 in the utilityProcess service and xterm.js 6.0.0 in the sandboxed renderer. The native module is explicitly rebuilt with @electron/rebuild 4.2.1 against Electron 45.2.3. It is deployed as a contained production resource, with only the verified pnpm development self-reference removed and copied links repaired. No global node-pty or interactive-shell PATH is required.

TDD failures are in session-red.log, e2e-red.log, flood-red.log and package-red.log. Tests cover duplicate open, read-only input refusal, explicit take-control/release, size/input validation, cleanup, spawn failure and bounded output. A proof shell launches /bin/bash --noprofile --norc with its own temporary HOME, /usr/bin:/bin PATH and no inherited secrets/startup hooks. Commands are sent over validated service MessagePorts, not browser IPC. Output is bounded to 1 Mi characters per proof session, 64 Ki-character messages, a 64 Ki-character diagnostic tail, and xterm scrollback of 1000 lines; exceeding the session budget closes that proof shell as unavailable.

The real Electron test denies typing until control is acknowledged, proves PTY_OK echo, verifies stty size changes from 24×80 to 30×100, and closes its own terminal. The packaged test launches with a minimal environment. This is **not Finder/LaunchServices evidence**, and this is an isolated proof shell, **not attachment to a Firstmate worker**. Worker attachment remains blocked on T008 verified endpoint ownership; the UI labels that limitation. T011 remains unchecked.

## Visible output and service loss

The source E2E now checks the actual xterm screen dimensions and rendered PTY_OK text, in addition to the diagnostic buffer; it passes. A new real service-kill test first demonstrated stale Pi dialogs/terminal control, then passed after the renderer revokes input, clears dialogs and marks both dependent views unavailable. Commands and approvals are not replayed on reconnect.

A separate Finder launch reached the packaged app and terminal control, but full native UI echo verification could not finish: computer-use inspection returned ScreenCaptureKit/noWindowsAvailable and later cgWindowNotFound errors, with long tool timeouts. This attempt is NOT a Finder terminal acceptance pass. No personal session was stopped. Finder and backend-attachment gates remain open.

Final local validation for this increment: 159 unit tests, lint, typecheck and formatting; six source and six packaged Electron tests. The first final-package local-browser fixture timed out before navigation; the test now waits for renderer/service Connected readiness before interacting, and the full packaged suite passes. No authenticated browser retry was performed.
