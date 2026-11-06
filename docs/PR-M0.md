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
- Managed Firstmate home helper forces auto permissions and refuses unsafe imports or overwrites; live Firstmate integration remains open.

## Validation

- 66 local unit tests pass, with recorded failing tests before implementation.
- macOS CI run 42013744485 passed 45 unit tests and two real Electron E2E tests, including service kill and recovery within five seconds.
- Live Pi get_state and get_available_models commands succeeded without provider credentials in an isolated config directory.
- macOS run 42145190729 passed all 66 unit tests, unsigned packaging, contained bundled-Pi execution with empty PATH, and both packaged launch/isolation and crash-recovery tests.

## Remaining M0 gates

Packaged Pi and provider sign-in, managed Firstmate homes, worker reattachment, live Azure DevOps, browser/terminal proofs, release signing and performance budgets. M0 remains incomplete. Test credentials must use secure settings, never chat or repository files.
