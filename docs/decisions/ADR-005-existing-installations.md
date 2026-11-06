# ADR-005: Coexist with an existing Herdr → Pi → Firstmate setup

Status: accepted direction; discovery foundation implemented; launch integration pending.

## Context

The first installer already uses Herdr to start Pi, which automatically loads Firstmate. Amun must benefit from those installed tools without disrupting their sessions, changing personal configuration or creating a competing Firstmate captain. Exact local paths are not yet known.

## Decision

Inventory is read-only. Resolve user-selected candidate executable links and inspect bounded package metadata without executing binaries or shell/profile scripts. Recognise the tested official Pi package identity; unknown installations remain unresolved. A matching version is not proof of RPC compatibility. The inventory currently accepts candidate paths from its caller; automatic Mac path selection and onboarding UI remain pending.

Keep Amun state separate from existing Pi code/configuration and Firstmate code/home. Check both nesting directions after resolving symlinks, and repeat validation immediately before eventual creation/launch. These checks are not a defence against concurrent malicious filesystem changes. No existing files are upgraded, downgraded, deleted or migrated by inventory.

A Firstmate lock PID is only evidence that a process may be running, not verified session identity. Missing, stale or malformed locks never authorise takeover. Reject lock-file symlinks and state directories redirected outside the home. Do not attach to an existing Pi session until a supported transport and ownership protocol are proven. Current inventory explicitly reports attachment unsupported.

Prefer compatible installed tools for a separate Amun session after an isolated protocol probe. Firstmate code reuse must account for upstream self-updates: evaluate a verified private snapshot before launch. Amun must not start another captain in the personal home. The pinned bundled runtime remains an explicit fallback and must not replace the user's installation.

Personal Pi authentication is excluded from inventory. Configuration/skills import and authentication reuse require a visible selection and preview; never silently copy credential files. The existing managed-home permission restrictions continue to apply.

## Acceptance checklist

- [x] Read-only Pi package discovery through executable symlinks; duplicate paths collapse.
- [x] Unknown versions remain unverified; shell wrappers are never executed.
- [x] State-path overlap and symlink aliases are rejected.
- [x] Lock evidence is sanitised; credential canaries and personal locks remain unchanged in fixtures.
- [ ] Mac onboarding detects common paths and supports browsing; shows installed versus bundled choices.
- [ ] Probe selected Pi RPC and Firstmate extension compatibility in isolated state before launch.
- [ ] Implement explicit configuration/skills and authentication choices.
- [ ] Prove Herdr observation/reattachment with a supported endpoint and ownership checks (T008).
- [ ] On the first installer's Mac, compare personal configuration and locks before/after onboarding, app exit and upgrade; verify their existing Herdr session continues working.

## Evidence and limits

See `docs/evidence/T007/coexistence.md`. Unit tests establish library behaviour, not installed-app interoperability. The library is not yet wired into onboarding or runtime launch. M0 T006–T008 remain open; onboarding UI belongs to the later milestone.
