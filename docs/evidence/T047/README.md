# T047 portfolio acceptance

Starting revision aa46a9e, Apple silicon, macOS 27.2, Node 24.22.1 and Electron 45.2.3. The service regression first failed because the workspace snapshot returned no portfolio summary. It passed after implementing the scoped projection and durable dependency confirmation. The full suite passed 496 tests.

The source-built Mac app opened an isolated SQLite workspace with synthetic Atlas and Beacon records. The overview showed one draft for Atlas, one committed story for Beacon, and each product's blocked integration and pending release decision. Both products mapped the same repository. Its inferred dependency required an explicit confirmation. The test closed and relaunched the app and observed Confirmed before switching to Atlas and checking that the portfolio was absent. The journey passed in 2.9 seconds. An initial test setup used incorrect filesystem permissions. The final fixture uses the production workspace initializer.

Progress reflects recorded work-item statuses. Shared repository mappings supply evidence of a possible dependency. Confirmation is bound to the product pair and repository reference. The service rejects confirmation outside portfolio scope and for unknown evidence keys.

Regression tests are in `packages/data/tests/portfolio.test.ts` and `tests/e2e/m5-portfolio.spec.ts`.
