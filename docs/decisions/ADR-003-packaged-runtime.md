# ADR-003: Package Pi as a production resource; use Electron as Node

Status: foundation proof; release signing and authenticated providers pending
Milestone: M0 (T006, T007, T012)

## Decision

Stage the pinned Pi workspace's production dependencies with pnpm deploy and include the self-contained tree as `Resources/pi`. Electron executes the bundled RPC entry with ELECTRON_RUN_AS_NODE=1. This avoids depending on a global Pi or developer Node installation. The proof harness runs from the checkout, but its child uses the actual packaged executable and resource path with an empty PATH.

App code is bundled by Vite, so Forge excludes development node_modules and disables its dependency-pruning traversal. This avoids traversing pnpm development symlinks. The separately deployed Pi tree supplies runtime dependencies. Forge requires an explicit pnpm publicHoistPattern; pnpm 11 reads that setting from pnpm-workspace.yaml. Legacy deploy modifies workspace dependency-check metadata, so staging restores development install metadata afterward.

## Validation and limits

Linux package creation passed. Packaged Electron ran get_state and get_available_models from the bundled Pi tree with an empty PATH. Linux UI launch is unavailable in this environment; macOS CI runs both shell isolation and real service-crash recovery against the packaged app. These are unsigned development artifacts; notarization, Finder launch, native-module signing, provider authentication and performance budgets remain open.

Electron's run-as-Node capability is intentional in this architecture. Do not disable that fuse without replacing and revalidating the runtime launch strategy. No app-facing command-execution API was added.

## Firstmate home boundary

The pinned Firstmate configuration reference explicitly defaults absent Claude permission mode to bypass. Amun's managed-home writer always creates `config/claude-permission-mode` with `auto`, refuses overwriting existing homes and imports only operational configuration. Skills and extensions remain outside this import path until their trust/approval proof exists. Do not infer that this prepares a working Firstmate installation.
