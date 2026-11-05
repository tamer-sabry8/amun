# M0: bootstrap Electron workspace and tested desktop boundaries

Amun needs a macOS desktop foundation before product features. This change follows the user's confirmed Electron/TypeScript stack, establishes a pinned workspace, and adds a minimal isolated shell plus validated health RPC contracts.

## Scope and user benefit

M0 only. M1–M6 remain locked. The shell is explicitly a foundation preview with no connected services or approval actions. A strict CSP, sandbox and disabled Node integration keep the initial renderer unprivileged; the service bridge remains T005.

## Changes

- pnpm workspace, strict TypeScript, lint/format, Vitest, Playwright and pinned macOS CI actions.
- Versioned health contract rejects malformed/unknown requests and preserves reconnecting state.
- Electron/Forge/Vite shell with denied permissions, popup/navigation blocking and no preload.
- Preserved product plan, 59-task tracker, architecture decision and evidence templates.

## Validation

- 14 unit tests pass; health tests recorded 10 expected red failures and policy tests recorded 2 expected red failures before implementation.
- Lint, strict typecheck, formatting and Vite build pass locally on Linux.
- Electron launch E2E is not yet verified. macOS CI, packaged launch, signing, live integrations and performance are unverified.
- No milestone or full T002/T004 acceptance gate is claimed complete.

## Remaining work

Complete entity contracts, MessagePort service and runtime/live proofs in M0. GitHub API access is denied, so PR creation and CI status cannot be verified from this environment. Test credentials and signing materials must use secure settings, never repository files or chat.
