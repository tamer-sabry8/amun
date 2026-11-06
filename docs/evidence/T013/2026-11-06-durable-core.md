# T013–T015 durable core acceptance (macOS arm64, 2026-11-06)

Implementation: Drizzle declarations for section 8.6, checksum-ledger SQLite migrations, FTS5, service-owned private WAL storage and a separately staged Electron 45.2.3 SQLite runtime. Node 24.22.1 tests retain their own native binding. All prior schema versions are migrated with seed data; rollback, history corruption, future/downgrade versions, foreign keys, JSON constraints, unique operation markers and Drizzle column parity are covered.

Red evidence: database module absent; workspace opener absent; database runtime rejected by the existing deployment allow-list. Each was followed by the implementation and passing tests. The real upgrade test first caught macOS path canonicalization and a missing test import; corrected to compare real paths.

Validation: `pnpm check` passes, full coverage passes, all nine source Electron E2E tests pass. The new upgrade/restart test also passes against the unsigned packaged Amun. It seeds schema v1, launches the real service to migrate to current schema, closes/relaunches and verifies the original product survives both starts. No personal sessions were restarted or adopted.

T014: exhaustive allowed/forbidden action transitions; 100 generated object-order permutations; strict canonical JSON rejects cycles, sparse arrays, accessors, non-finite values, non-JSON objects and bounded-size/depth violations. Approval binds action identity, approval kind, payload and target revisions. Editing an approved action invalidates its stored approval and stops dispatch. Governance line coverage: 96.72%.

T015: action plus outbox insert and approval/queue changes use SQLite immediate transactions. A connector can claim/reconcile only its registered approval kind. Service startup moves interrupted executions to unknown. Unknown writes reconcile by operation marker; inconclusive/error results remain unknown, and confirmed absence fails the action rather than automatically repeating it. Outbox line coverage: 96.82%.

Real chaos acceptance: a separate Node dispatcher performs an actual HTTP POST. The local HTTP server records the operation and deliberately withholds its response. The harness SIGKILLs that dispatcher, starts a new process against the same SQLite file, and verifies GET reconciliation marks success without another POST. Ten trials: ten records, zero duplicates. This proves the framework's crash boundary; production ADO/GitHub/Notion action adapters remain their respective later tasks, not live write claims here.

M1 remains incomplete: authentication, audit/redaction, backup, tokens, shell, Island, drawers, Requests and command palette still have open gates. R001 release signing/clean-account acceptance remains separately deferred by the user's decision.
