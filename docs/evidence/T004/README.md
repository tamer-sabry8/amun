# T004 — Shell proof in progress

Environment: Debian 13, Node 24.22.1. `red.log` records two failing isolation-policy assertions before implementation. The current `pnpm check` passes all 14 tests including those two assertions. `pnpm build` compiles the Electron main process.

These unit tests verify configuration, not the live Electron security boundary. Electron installation succeeded with the managed proxy (`NODE_USE_ENV_PROXY=1`). `e2e.log` records a launch failure; diagnosis found no X server or DISPLAY on this Linux host. Playwright defaults to disabling Chromium sandboxing; the committed test explicitly enables it and must be run on macOS. A successful macOS launch, actual isolation test and packaged proof are required before closing T004.
