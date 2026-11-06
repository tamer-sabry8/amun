# Amun

A macOS product workspace for directing an AI crew from intent through delivery, with explicit human decisions. Built with Electron and strict TypeScript per the approved R1 plan.

## Development

Use Node **24.22.1** and pnpm **11.25.0**. Install with `pnpm install --frozen-lockfile`, install the desktop binary with `pnpm --filter @amun/desktop exec install-electron`, then run `pnpm check` (lint, typecheck, unit tests and format checks). Run `pnpm build` to compile the desktop main process.

On a Mac, run `pnpm --filter @amun/desktop start` for the foundation window and `pnpm test:e2e` for the launch/isolation smoke test. `pnpm package` stages pinned Pi production dependencies and creates an unsigned development package; release signing/notarization remain T012. On macOS, `pnpm test:packaged` checks the bundled Pi runtime (empty PATH), app launch/isolation and service recovery. Electron's binary installer requires network access and checksum verification remains enabled.

This is an M0 foundation, not a working product. No runtime connections or approval actions are available. The shell has a minimal sandboxed preload that transfers a service MessagePort. Its only RPC method is health; the renderer has no direct network capabilities. Service failure shows Reconnecting and restarts with bounded backoff.

## Delivery

[Milestones and task status](docs/TASKS.md) · [Product plan](docs/plans/product-and-r1-plan.md) · [Architecture decision](docs/decisions/ADR-001-desktop-stack.md) · [TDD evidence rules](docs/evidence/README.md)

Only M0 is active. Keep later milestones locked until its acceptance gates pass. Write a failing behavior test before implementation and record red/green evidence. Unit, live integration, packaged Mac, accessibility and performance results are separate gates.

In managed environments with an HTTP proxy, prefix the Electron installer with `NODE_USE_ENV_PROXY=1` so Node uses the configured proxy. Retain the injected CA trust and checksum verification.
