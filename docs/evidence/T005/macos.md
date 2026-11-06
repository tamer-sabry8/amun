# macOS service recovery evidence

Run: https://github.com/tamer-sabry8/amun/actions/runs/42013744485
Commit: 8afcf256009dad402cfdc6e9508367a254e1d787

45 unit tests and both Electron E2E tests passed. The recovery test killed the actual Amun utility process, observed Reconnecting via DOM mutation, then required Connected from a fresh health response within five seconds. This verifies service recovery only, not worker reattachment or durable actions.
