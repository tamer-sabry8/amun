# ADR-006: Firstmate backend support versus Amun enablement

Status: non-Herdr requirement accepted; tmux is the M0 proof candidate, not a completed worker integration.

The user clarified that Amun must not use Herdr. Their personal Herdr → Pi → Firstmate setup remains a coexistence test case, not an Amun architecture dependency. This supersedes the attached plan's AD-6 and Herdr-specific milestone gates.

## Three separate choices

| Layer           | Responsibility                          | Examples                                  |
| --------------- | --------------------------------------- | ----------------------------------------- |
| Session backend | Creates and supervises worker sessions  | tmux, Herdr, Zellij                       |
| Worker harness  | Runs the coding agent in the session    | Pi, Codex, Claude Code                    |
| Model provider  | Supplies model inference to the harness | OpenRouter and other configured providers |

Amun supplies the desktop interface and integration. It does not yet implement a replacement session backend. Removing Herdr does not by itself implement process supervision or recovery.

## Version-aware inventory

Checked 2026-11-06:

- [Amun's pinned Firstmate README](https://github.com/kunchenguid/firstmate/blob/4a67799d8a8670d6ea1a55250b67d8474b070a09/README.md) lists tmux plus eight alternatives: Herdr, Zellij, Orca, cmux, Paseo, Rex, T3 Code and tern. Nine total.
- [Upstream main README](https://github.com/kunchenguid/firstmate/blob/main/README.md), observed alongside main commit `8b1618a49511d67b247f5f8091868b812bfcae2d`, additionally lists hc (herdr-core): ten total.
- Both identify tmux as the reference default. The pinned [tmux guide](https://github.com/kunchenguid/firstmate/blob/4a67799d8a8670d6ea1a55250b67d8474b070a09/docs/tmux-backend.md) describes explicit selection overriding runtime auto-detection.
- `codex-app` is documented as a blocked boundary, not an available runtime backend.

Upstream support does not imply Amun validation. We do not update the pinned distribution or enable experimental backends simply because they appear on main.

## Current implementation and next gate

Managed-home creation accepts explicit tmux only, refuses an absent selection and rejects Herdr before writing directories. The Pi/Firstmate startup probe explicitly uses that setting. This is an internal M0 constraint, not a user-facing promise of completed tmux support.

Before enabling workers, prove isolated backend/session ownership, Codex and Claude dispatch, permission propagation, observation and recovery without duplicate agents. In particular, the pinned tmux guide says a primary outside tmux can reuse a detached session named `firstmate`; Amun must demonstrate a separate namespace/server so it cannot collide with an existing personal tmux setup. Do not enable dispatch until this isolation is verified.

The user's existing Pi/Firstmate tools remain candidates for compatibility-tested reuse. Their Herdr state and sessions remain outside Amun's control path.
