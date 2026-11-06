# T001 — Local tooling evidence

Environment: Debian 13, Node 24.22.1, pnpm 11.25.0, TypeScript 6.0.2.

`checks.log` records `pnpm check`: lint, strict typecheck, 14 unit tests and format check pass (exit 0). `pnpm peers check` reports no peer issues. Dependencies are pinned in manifests and pnpm-lock.yaml. Hosted macOS CI and a clean Mac clone remain unverified; T001 is open.
