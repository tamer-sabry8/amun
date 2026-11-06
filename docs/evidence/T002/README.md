# T002 — Health contract slice

Environment: Debian 13, Node 24.22.1, pnpm 11.25.0.

`red.log`: permissive schema stubs produced 10 failed assertions and 2 passed tests (exit 1). `green.log`: implementation produced 12 passed tests (exit 0). Command: `pnpm test` at the health-contract implementation stage.

Scope: health method only. This proves schema rejection and round-trip behavior, not transport, authentication or all entity contracts. T002 remains open. Evidence is committed with its implementation.

Entity contract increment: entities-red.log records 14 failed / 7 passed tests against permissive stubs; entities-green.log records 35 total passing tests after implementation. Six strict contracts cover attention, notifications, activity, actions, approvals and runs. Governed actions cannot be inline answers; snooze timestamps must agree with state; unknown execution outcomes remain unknown. These schemas validate data shapes, not approval authenticity or execution authority (M1 governance).
