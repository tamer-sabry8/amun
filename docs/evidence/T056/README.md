# T056 Mac performance

The full packaged shell was measured in three disposable profiles using the T012 budgets. The first launch took 4,875 ms and subsequent launches took 577 and 574 ms. Electron-reported working sets totaled 602, 593 and 592 MiB. Terminal echo took 16, 25 and 25 ms. Startup and memory exceeded their recorded budgets, so T056 remains open.

The measurement includes full-shell startup, warm filesystem caches, other running Mac apps and summed Electron process working sets. Shared memory may be counted more than once. It excludes external worker memory. The initial measurements are in initial-full-shell.json.

The PR diff editor imported Monaco at application startup. Monaco loading has been deferred until a diff is opened, with disposal handling for a view closed before loading finishes. Packaged performance measurements and live diff verification are recorded below and in T054.

After deferring Monaco, the three trials measured startup at 12,149 / 606 / 765 ms, working set at 586 / 585 / 588 MiB and echo at 184 / 80 / 24 ms. The memory cost decreased but remained above 500 MiB. The first launch after rebuilding remained above 3,000 ms. These observations do not pass T056. No budget was changed. Further optimization is required under the retained 500 MiB budget.

With the broad packaged regression complete, another three process-cold, warm-cache launches measured 730 / 726 / 844 ms, memory 588 / 589 / 587 MiB and echo 32 / 25 / 25 ms. Startup and echo pass their budgets in these trials. The 500 MiB summed working-set budget still fails. The earlier deferred-editor measurement overlapped another acceptance check and remains recorded with that load limitation.

A further experiment deferred the PRD editor and terminal modules until opening those tools. It measured 589 / 586 / 591 MiB, which did not materially improve the working set. That experiment was reverted. The diff-only deferred Monaco import remains. The accepted source still fails the current memory budget.

On 10 November the owner explicitly retained the 500 MiB budget. Raising that budget is outside the selected direction. T056 remains incomplete at the measured 587–589 MiB warm-cache working set. The owner subsequently selected T056, T057 and T058 to proceed.

## 10 November: actual module splitting

The earlier lazy-tools experiment used an IIFE build, which bundled the imports into one startup script. An ESM renderer now loads shell, proof and gallery modes separately; PRD, terminal and Monaco modules load when invoked. The preload retains an early service port until the selected renderer has installed its listener. Before that handshake correction, four source Mac checks failed at Connecting; afterward they passed. Six source Mac checks subsequently passed for shell behavior, PRD import/export, stale-head PR refusal, terminal control and scoped folder MCP.

The actual ESM package measured 9,556 / 365 / 329 ms startup, 563 / 554 / 540 MiB memory and 26 / 25 / 25 ms echo. A separate process breakdown measured 554 / 558 / 556 MiB. [ESM trials](esm-full-shell.json), [process breakdown](esm-process-breakdown.json). These are improvements, not a budget pass.

Deferred folder MCP loading measured 526 / 539 / 556 MiB; a standalone main build with deferred GitHub client measured 560 / 553 / 553 MiB. GPU allocation varied materially between trials, so these differences do not prove a memory reduction from either step. [Folder MCP trials](deferred-folder-mcp.json), [isolated main trials](isolated-main.json).

A disposable software-rendering experiment worsened memory to 575 / 619 / 605 MiB and was discarded. Hardware acceleration remains enabled. [Experiment](software-rendering-experiment.json). No process was excluded and no budget was raised.

Deferring the MCP SDK and GitHub client reduced the next full-shell trials to 542 / 532 / 546 MiB. Startup was 11,179 / 386 / 314 ms and terminal echo 24 / 26 / 24 ms. Memory and the first launch still fail. [Deferred connector trials](deferred-connectors-full-shell.json). The harness now emits per-process working sets and an explicit all-budgets result, exiting unsuccessfully when any trial exceeds its budget.

The source module-loading check verifies evaluated scripts through the renderer debugger: no proof, gallery, PRD, Monaco or terminal tool module is evaluated at shell startup; PRD and terminal modules appear when opened. It was added after implementation as a characterization check. The original performance measurements supply the failing budget evidence; the earlier handshake failure supplies the observed connection regression. Resource Timing was unsuitable for file URLs, so that test-only observation was replaced with debugger script events. The corrected check passed on the Mac.

Source-map inspection then identified the Azure SDK's broad API graph in the service startup bundle. Loading the SDK only when a scoped transport request is invoked reduced the service entry from approximately 1.4 MB to 311 KB. Nineteen focused Azure transport/health checks passed, and all 513 unit tests, lint, typecheck and formatting passed. Its packaged memory measurement is pending; a smaller bundle alone is not a memory-budget pass.
