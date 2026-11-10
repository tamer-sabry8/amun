# R1 beta bug fixes

The owner instructed on 10 November 2026: merge the existing code to main, open a new bug-fix branch/PR, and do not start R2.

## Baseline

- Repository: `tamer-sabry8/amun`.
- Merged PR: [#8](https://github.com/tamer-sabry8/amun/pull/8).
- Main merge commit: `b03b7016ad33c514a7d1bd28c020385c3c22a6cd`, containing M6 head `a21a156d3c6b0aedcb5818e73af362705c5becf0`. Its application tree matches the checked M6 tree.
- Source checkout: `/Users/tamersabry/Projects/amun`, clean on main after fast-forward.
- Branch: `fix/r1-beta-bugs`.
- Managed worktree: `/Users/tamersabry/.codex/worktrees/amun-beta-bugfixes/amun`.
- Delivered beta remains source `7eea589313988756ffe32c378699f413c6c208fd`; merging and branch setup do not replace the installed DMG or claim a new runtime fix.

## Current defect queue

**BF001 / T056: memory exceeds the retained budget.** The corrected beta measured 525–530 MiB against 500 MiB. See [performance proof](evidence/T056/README.md). Keep the measurement scope and limitations explicit. This is still open.

Record other owner-reported or reproduced beta defects as they arrive. Preserve the distinction between a reproduced defect, a proposed repair and a verified repair. T058 and final owner acceptance remain open; merging code is not an acceptance waiver.

## 10 November owner reports

| ID    | Report                        | State                                                      |
| ----- | ----------------------------- | ---------------------------------------------------------- |
| BF002 | PRD and R1                    | Owner report; recommendation pending review                |
| BF003 | Requests                      | Owner report; recommendation pending review                |
| BF004 | Overview shortcuts            | Owner report; recommendation pending review                |
| BF005 | Service connections           | Owner report; recommendation pending review                |
| BF006 | Pi and worker sign-ins        | Owner report; recommendation pending review                |
| BF007 | The six CLI buttons           | Owner report; recommendation pending review                |
| BF008 | Terminal appears stuck        | Owner report; recommendation pending review                |
| BF009 | Provider readiness and status | Owner report; recommendation pending review                |
| BF010 | Slow provider dialogs         | Source optimized; packaged check pending                   |
| BF011 | Copilot host error            | Owner report; recommendation pending review                |
| BF012 | Copilot pairing code          | Owner report; recommendation pending review                |
| BF013 | Settings header               | Owner report; recommendation pending review                |
| BF014 | Browser too small             | Owner report; recommendation pending review                |
| BF015 | Agents and creating a worker  | Owner report; recommendation pending review                |
| BF016 | Empty Conversations           | Owner report; recommendation pending review                |
| BF017 | Commands, Notion and reading  | Owner report; recommendation pending review                |
| BF018 | Logs, timing and failures     | Local MCP and source capture verified; packaged UI pending |
| BF001 | Memory budget                 | Measured; open                                             |

BF010 shares one model-runtime entry across the six Pi sign-in choices. A disposable worker check times first interaction independently from the visible app. Recheck click-to-visible interaction in a future candidate. BF018 adds local measurements in source; packaged coverage and end-user access to diagnostics still require acceptance.

## Validation and boundaries

Use a meaningful failing regression before a runtime fix, then run appropriate source checks and real Mac acceptance. Exercise invalid/stale input and recovery when relevant. Retest the affected packaged behavior before reporting it fixed. Use disposable profiles; do not reset, clean or adopt the owner's newly installed beta data.

R2 T059–T062 are on hold. Keep the M1 redesign paused and live Google/Obsidian checks in R3. Developer ID signing/notarization remains the final R2 step when R2 is explicitly resumed. Reuse settled Firstmate/secondmate approvals for the same scope; changed content, destination or source head retains its exact review. Do not replay the completed Azure, GitHub TEST or Notion publications. Preserve personal sessions and the M4 worker-check waiver.

The initial PR head recorded scope and the owner hold. Subsequent commits add the BF010 candidate and local diagnostics. BF001 remains open.

### Local diagnostic queries

R1 uses only the local SQLite exporter. Its contract admits enumerated event and subject names and a bounded duration. The MCP reader validates stored rows again before returning a report. Raw errors, prompts, filesystem paths, tokens and user content are excluded. R2-DIAG tracks future email delivery; a future Sentry exporter requires explicit opt-in.

Run `node packages/diagnostics-mcp/server.ts` as a local stdio MCP server to query the issue register with `list_beta_issues`. To read measurements, pass an explicit candidate workspace database path as the sole argument. The server opens it read-only. `query_diagnostics` accepts event, subject and limit. No database is opened for issue-register queries. Older builds have audit records but lack the diagnostic table.

The source records native dialog opening to the next visible frame opportunity, sign-in click to its first visible dialog frame, provider error status, renderer errors and unhandled promise rejections. These are frame estimates. It retains the newest 2,000 measurements per workspace. The events carry enumerated subjects and durations only. No credential, input text, browser address, conversation, or device code is accepted. The service also measures worker launch to first prompt and requested browser handoff. Full crash reports, detailed provider error categories and end-to-end cross-process traces remain open.

### BF010 local verification

A source regression failed with the original Pi entry and passed with the model-runtime entry. On this Mac, a fresh Node worker loaded the installed beta's unchanged Pi package with an empty temporary profile for every trial. No browser opened and no credentials were entered. These values measure process start to the first actionable prompt or browser request, one run per provider per entry, original entry first. Filesystem caching, load, and order affect the result. They do not measure the installed UI.

| Provider / method                  | Original entry (ms) | Model-only entry (ms) |
| ---------------------------------- | ------------------: | --------------------: |
| OpenAI API key                     |                2045 |                  2642 |
| GitHub Copilot                     |                1806 |                   637 |
| OpenAI / Codex                     |                4887 |                   321 |
| OpenRouter OAuth (browser handoff) |                2034 |                   319 |
| OpenRouter API key                 |                5098 |                   316 |
| Anthropic API key                  |                3487 |                   332 |

Five choices improved in this run. The OpenAI key prompt was slower in this run and faster in another. Repeat interleaved cold/warm packaged trials before assigning a guarantee. Source diagnostics produced two 11 ms frame measurements in an isolated Chrome dialog, independently from the worker trials. Packaged click-to-visible verification and memory impact remain open.

### BF010 packaged-worker comparison

Four disposable trials per provider and entry used the unchanged installed beta executable in Node mode, its bundled auth worker and its bundled Pi SDK. Alternating the entry order between rounds reduced ordering bias. The table reports median milliseconds to the first actionable prompt or requested browser handoff. No user input or external browser operation was performed. This exercises the real worker without rebuilding or running the app UI. [All 48 measurements](evidence/BF010/worker-timings.csv).

| Provider       | Method  | Original | Candidate |
| -------------- | ------- | -------: | --------: |
| anthropic      | api_key |     1097 |       244 |
| github-copilot | oauth   |     1159 |       247 |
| openai         | api_key |      460 |       249 |
| openai-codex   | oauth   |   2225.5 |       244 |
| openrouter     | api_key |     1538 |     254.5 |
| openrouter     | oauth   |     1407 |     243.5 |
