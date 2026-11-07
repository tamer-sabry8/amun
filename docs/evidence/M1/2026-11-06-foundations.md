# M1 foundation progress — 2026-11-06

Tested code commit: `b0eb52edb5510041b9f4e8edb4a74588263ee7bb`.

`pnpm check`: 254 tests passed, lint/typecheck/format passed. Full configured coverage passed: governance 96.72% lines, attention domain 95.45%, outbox 96.82%, shared redaction 94.87%. Source Electron database upgrade, sandbox and service-restart checks passed (3/3). The previous durable-core commit `1a8f238` passed both GitHub runs 42217332841 and 42217325517.

## Implemented, with remaining acceptance explicitly open

- **T016:** workspace-scoped Keychain adapter, independent statuses, credential replacement race protection, proper-lockfile refresh serialization, strict auth IPC, supported Pi SDK login worker, bounded prompt correlation/cancellation and provider-host browser allow-list. Real native macOS Keychain roundtrip passed using a random Amun-only entry; entry deleted afterward. The worker transport test is a real child process with a fake provider, not live sign-in evidence. Sign-in/settings UI and live Copilot/OpenRouter acceptance remain open.
- **T017:** pino and shared redaction, SQLite audit writer and export, provenance-required memory writer and update writer. Canary tests cover raw, URL/base64/Basic encoding, sensitive fields, exceptions, cycles and getters. Service startup is audited. Full shell/export integration remains open.
- **T018:** AES-256-GCM/scrypt export of a SQLite backup plus registered bounded artifacts; excludes credential stores, refuses symlinks/traversal/detected secrets, authenticates ciphertext and refuses existing restore targets. Restore tests use real SQLite and artifacts. Restored approvals are invalidated; uncertain writes never replay; restored workspace identity changes so it cannot reuse the original Keychain namespace. Snapshot compaction removes deleted pages. UI and packaged restore acceptance remain open.
- **T019:** DTCG tokens and Style Dictionary generation for the user's chosen Appendix A dark default, Navy Gold and Navy Cyan. Shared safety tokens cannot be overridden. Text ≥4.5:1 and interactive borders ≥3:1 pass. Appendix A's #53627A is only about 2.7:1 on card surfaces; interactive borders use #64748B (≥3.4:1). Semantic red/blue mark states, not small text on cards. Inter and JetBrains Mono 5.3.0 are OFL-1.1. Component/theme persistence visual acceptance remains open.
- **T020–T022:** tested exact Focus layout restoration, one pinned/hover drawer state machine, strict shared snapshots/preferences, durable attention store, snooze/wake, priority query, guarded resolution, and FTS synchronization migration. Inline answers persist as decisions in the same transaction as resolution. Governed actions cannot resolve through generic Island/review commands. React shell, full gallery, keyboard/axe and packaged UI gates remain open.

## Evidence-backed interface choices

Pinned Pi 1.4.0 CLI help supports `auth check --json` but no `auth login`. Its public `ModelRuntime.login` API supports provider-owned auth interaction and storage; Amun uses that API rather than inventing CLI flags. Credentials stay in Amun's private Pi directory. Availability metadata remains distinct from real inference.

Read-only connector probes follow [GitHub authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user), [Notion bot identity](https://developers.notion.com/reference/get-self) and [Notion versioning](https://developers.notion.com/reference/versioning). Azure connectionData follows the installed official azure-devops-node-api WebApi implementation. No browser integration, cookie copying, live external writes or additional app sign-ins were performed for these probes.

M1 is not complete. M2 has not started. Personal sessions and configuration remain untouched. PR #2 remains draft and is not authorized for merge.
