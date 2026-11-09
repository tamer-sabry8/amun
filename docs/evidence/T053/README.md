# T053 chaos acceptance

M6 starts at M5 merge `1b0850b` on the Apple silicon Mac. GitHub enforced head `5c534aa` on [PR #7](https://github.com/tamer-sabry8/amun/pull/7). The fetched merge contains that head and its tree is identical. Node 24.22.1, pnpm 11.25.0 and Electron 45.2.3 were used with disposable workspaces.

## Approval changed before dispatch

A new SQLite regression interleaved an edit after the initial Notion preview check and before the durable approval. The red run returned an unknown connector outcome, showing that dispatch had been reached. The fix checks the supplied review binding while holding the same immediate transaction that records the approval. The regression now observes a rejected review, zero approvals and zero connector calls. The same transactional check is used by the GitHub issue, PR merge and PDF export approval paths.

## Provider and power evidence

The Notion SDK regression forces expiry, runs twenty concurrent reads with one refresh, then rejects the refresh grant. The connection clears the grant and requests reconnect. The Mac's [earlier live provider trial](../M1/2026-11-06-notion-mcp.md) records separate disposable-grant revocation and packaged reconnect guidance. The M6 provider faults use test credentials.

The physical sleep test is opt-in. Run the packaged app journey with `AMUN_T053_SLEEP_NOW=1` only during an owner-coordinated sleep window. It schedules a consequential reminder twenty seconds ahead, collects native suspend and resume events around the deadline, and checks for exactly one missed notification, an outstanding review and no dispatched action. Wake the Mac after at least thirty seconds and within nine minutes. A simulated resume cannot satisfy these assertions.

## Mac process and network faults

A standalone Mac process ran the production Notion review and outbox code against a loopback HTTP receiver. In one run the receiver retained the synthetic record and withheld its response, then the test killed the publisher with SIGKILL. In the other the receiver retained the record and dropped the connection. In both cases the packaged Electron app opened the interrupted workspace and displayed the publication under Unconfirmed. The receiver observed one create with the reviewed marker, and SQLite showed one attempt, unknown action status and a sent-unknown delivery. No request reached a live sharing destination.

A separate packaged test killed the actual Electron utility service while a Pi turn awaited an extension response with terminal control active. The service reconnected, the Pi dialog cleared, terminal control became unavailable and the old runtime fixture was cleaned up. The packaged Azure review test refused the changed head. The reminder resume simulation passed separately from the outstanding physical test.

Run the packaged tests with `AMUN_PACKAGED_PATH` set to the built app executable and `pnpm exec playwright test tests/e2e/m6-publication-chaos.spec.ts tests/e2e/pi.spec.ts tests/e2e/m4-pull-review.spec.ts tests/e2e/m5-reminders.spec.ts`. These six journeys passed locally. The M6 workspace checks passed 506 unit tests.
