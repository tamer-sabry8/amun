# M0: establish Amun's native Mac implementation plan and delivery gates

Amun needs a native Mac implementation with test-first delivery and one milestone active at a time. This change preserves the supplied R1 plan, creates a task tracker for all milestones, and records the native-versus-Electron conflict before implementation.

## Scope

- M0 only; M1–M6 remain locked.
- Proposed native-stack mapping preserves product scope and original task IDs.
- TDD evidence and PR templates require meaningful red/green tests, security review and performance evidence.
- Visual guidance retains the reference style and specifies the right icon rail with hover/click drawers.

## Validation

- Documentation task-ID coverage checked against the source plan.
- `git diff --check` passed.
- No application code exists yet; no unit, macOS UI, live integration or performance tests claimed.

## Outstanding

Confirm native stack; provide a macOS execution route; restore GitHub API access for PR/CI. M0 live tests also need authorised test services and signing credentials through secure settings. No milestone is complete.
