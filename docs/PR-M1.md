# M1: durable core and application shell

Continue from merged main at 0b8b3bd. Implement only T013–T022, including T021a/T021b, with test-first behavior, real integration/packaged acceptance where mocks are insufficient, and at least 90% domain/governance line coverage.

T013–T015 pass: source/packaged SQLite upgrade persistence, approval binding/invalidation (96.72% governance line coverage), and ten real HTTP write/SIGKILL/restart trials with zero duplicates (96.82% outbox line coverage).

Acceptance remains open for independent Keychain/Pi connections, redacted audit/export, encrypted workspace restore, three accessible persisted themes, complete keyboard-accessible shell/Focus restore, Island and Requests consistency, and timed/pinned overlay drawers. No item is complete merely because a helper exists.

M2 is not started. Existing personal sessions and configurations are preserved. M0 release gate R001 remains open and separate. This PR is draft; no merge is authorized by the M1 start request.

Theme decision (user, 2026-11-06): use Appendix A’s dark default, with Navy Gold and Navy Cyan alternatives.
