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

During the owner-approved sleep window, the packaged app connected and armed the native event recorder and reminder. macOS rejected `pmset sleepnow`. A read-only `pmset -g` then reported system-wide `SleepDisabled 1`. The test exited before observing suspend or resume, so physical wake acceptance remains open. The test closed its disposable app and removed its fixture. No power setting was changed.

In the next owner-approved window, an administrator helper temporarily enabled sleep. The packaged app armed the reminder, but the normal-account sleep request failed. After restoring and checking the original setting, a second run coordinated the armed app with an administrator-issued sleep request. macOS refused it with `Unable to sleep system: error 0xe00002e2 (71)`. Neither attempt established a physical suspend/resume pair. The helper restored the original system setting on both exits, and an independent final `pmset -g` read verified `SleepDisabled 1`. Other power settings were left intact.

With the lid already closed and two external monitors connected, the owner requested the Apple menu path. After temporarily enabling sleep and arming the packaged reminder, System Events opened the Apple menu and read the Sleep item's enabled state. macOS reported the item disabled. No selectable Sleep command or physical suspend/resume was observed. The administrator helper restored the original setting and a separate read verified `SleepDisabled 1`. The opt-in test supports this menu path with `AMUN_T053_APPLE_MENU=1`.

After the owner fixed sleep, the Mac reported `SleepDisabled 0` before and after the retry. No power setting was changed by this run. Apple menu Sleep worked. At 16:14 Dubai time the system log recorded 61 seconds of physical sleep. The packaged app observed native suspend and resume spanning the deadline, but the Playwright window handle closed before the notification could be verified. The test now checks the durable ledger first, then reopens the disposable workspace to check the drawer. On the next attempt the system log recorded one second asleep and a wake attributed to HID activity. The native resume timestamp was before the deadline, so the test correctly failed before checking reminder delivery. T053 remains open.

## Physical wake result

On 9 November, macOS recorded 72 seconds asleep beginning at 16:19:02 Dubai time. The packaged Electron process observed suspend before the 16:19:16 reminder deadline and resume afterward. Before relaunch the durable assertions passed: exactly one missed reminder, the task awaiting review, and zero outbox actions. A separate read of the same SQLite file verified the notification text and its write at 16:20:14. SleepDisabled remained 0 throughout this run.

The combined test then failed during an additional attempt to reopen the same profile. The second instance exited before its DevTools socket attached. The updated harness requests a normal quit and waits for the original process to exit before relaunching. A separate packaged run with an overdue reminder passed that restart and displayed exactly one missed reminder in the drawer. This establishes the physical wake and restart checks in two runs. The revised combined harness has not had a further physical run.
