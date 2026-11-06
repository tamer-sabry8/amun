# ADR-004: Pinned Firstmate loading through Pi RPC

Status: accepted for startup proof; operational supervision and worker approval gates remain open
Milestone: M0, T007

## Distribution and trust

Pin Firstmate commit 4a67799d8a8670d6ea1a55250b67d8474b070a09 and the SHA-256 of its GitHub source archive in runtime/firstmate/manifest.json. The stage command verifies the archive before extracting or executing it, checks extracted symlink containment, and preserves the MIT licence. An upstream archive-byte change fails closed; never automatically update the expected digest.

The unsigned development package includes the verified distribution as Resources/firstmate and repairs copied dependency links to remain inside that directory. The proof grants process-local project trust (`--approve`) to this pinned distribution only. It does not save global project trust or install user-selected extensions.

## Observed RPC behavior

With Pi 1.4.0, a temporary Amun-managed FM_HOME and private Pi config directory:

- Firstmate's fm-watch-arm-pi command registers over get_commands.
- The watcher writes its loaded marker under the managed state directory, identifying the live process.
- Invoking the registered command with no live ownership lock emits the expected warning via extension_ui_request/notify and returns a handled response, without starting a model turn.
- A synthetic personal HOME tree and its settings remain unchanged.
- Both source-mode and packaged Electron/Pi/Firstmate probes pass on Linux. macOS CI repeats the source and packaged proofs.

These observations prove extension loading and missing-ownership refusal. They do not prove that the watcher is armed, delivers wakes, survives restart or supervises workers. No credentials, model calls or worker dispatches are used.

## Permission override discovered in the pinned distribution

Firstmate defaults both Claude and Codex to bypass when their mode files are absent. Amun creates `claude-permission-mode=auto` and `codex-permission-mode=restricted`, even when imported values request bypass. Restricted Codex uses workspace-write/on-request; writes outside the worktree and network/Git operations can require operator approval. Do not weaken these settings to make a live proof pass.

Firstmate does not inherit the Codex mode into secondmate homes automatically. Every Amun-created home gets the override, but upstream-created secondmates still need a verified policy propagation and approval path before delegation is enabled. This is an open worker-integration gate.

## TUI limitation and fallback

Pi's installed RPC extension-UI documentation states that custom() returns undefined even though hasUI is true. The pinned Firstmate supervision-model picker uses custom rendering only in TUI mode and otherwise falls back to ctx.ui.select. Pi supports select over RPC, so Amun should implement and test that dialog adapter before considering a terminal fallback. The picker path has been inspected, not exercised live; do not expose it as working yet. No tested behavior in this increment requires a terminal fallback.

## Next live gates

Acquire a real Firstmate ownership lock using its supported lifecycle, prove watcher wake/recovery, provide an operator approval flow for restricted workers, and dispatch/reconnect one Codex and one Claude Code worker via Herdr. These require runtime and sign-in prerequisites still absent here. T007 and T008 remain open.
