# M0: establish Electron contracts, service recovery and Pi runtime proof

Amun now has a macOS foundation window that connects to an isolated service and recovers after that service crashes. Shared contracts reject malformed events and unsafe inline approvals. The pinned Pi runtime has an isolated live RPC probe.

## Scope

M0 only; M1–M6 remain locked. No product workflows or external write capabilities are presented as working.

## Changes

- Pinned Electron/TypeScript workspace, macOS CI and evidence-backed milestone tracker.
- Six shared entity schemas plus health RPC, with strict rejection and round-trip tests.
- Sandboxed preload transfers MessagePorts; service validates health requests; UI validates correlated replies and displays Reconnecting on crash.
- Bounded restart delays; app shutdown cancels retries and stops the child.
- Pi 1.4.0 pinned, bounded JSONL parser and live isolated state/model-discovery probe.
- Unsigned Forge packaging includes deployed production Pi; packaged Electron-as-Node proof uses an empty PATH and rejects links escaping the artifact. Regression tests verify the copied runtime remains usable after its build source is removed.
- Pinned, checksum-verified Firstmate distribution included in the app. Isolated probes verify watcher loading and missing-ownership refusal over RPC, including in the packaged runtime.
- Managed homes force Claude auto and Codex restricted, refuse unsafe imports/overwrites, and preserve a synthetic personal-home tree. Operational watcher and worker integration remain open.

- Read-only existing-Pi discovery and state separation protect the first installer’s Herdr → Pi → Firstmate setup. Matching versions still require a protocol probe; runtime reuse and attachment remain pending.

- Removed the implicit Herdr backend. Amun-managed homes reject Herdr and require explicit tmux selection for the startup proof; operational worker integration remains an M0 gate. The user’s existing Herdr session is preserved, not controlled by Amun.

- Private tmux socket scope and explicit launch-environment allowlist; live macOS probe for same-named session isolation using the pinned Firstmate adapter. Worker dispatch/recovery remains disabled.

- Pi transport now correlates concurrent commands, delivers streaming events, bounds pending work, and validates explicit select/confirm responses. Live source and packaged discovery probes use the client; renderer dialog and authenticated-provider integration remain open.

## Validation

- 102 local unit tests pass, with recorded failing tests before implementation.
- macOS CI run 42013744485 passed 45 unit tests and two real Electron E2E tests, including service kill and recovery within five seconds.
- Live Pi get_state and get_available_models commands succeeded without provider credentials in an isolated config directory.
- macOS run 42147118853 passed all 72 unit tests, unsigned packaging, contained bundled-Pi execution with empty PATH, source and packaged Firstmate startup/refusal proofs, and both packaged launch/isolation and crash-recovery tests.

- macOS run 42150376823 passed all 90 unit tests, live tmux socket isolation through the pinned adapter, and source/packaged startup and recovery checks.

## Remaining M0 gates

Packaged Pi and provider sign-in, managed Firstmate homes, worker reattachment, live Azure DevOps, browser/terminal proofs, release signing and performance budgets. M0 remains incomplete. Test credentials must use secure settings, never chat or repository files.
