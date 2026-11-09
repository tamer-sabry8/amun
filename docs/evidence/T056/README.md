# T056 Mac performance

The full packaged shell was measured in three disposable profiles using the T012 budgets. The first launch took 4,875 ms and subsequent launches took 577 and 574 ms. Electron-reported working sets totaled 602, 593 and 592 MiB. Terminal echo took 16, 25 and 25 ms. Startup and memory exceeded their recorded budgets, so T056 remains open.

The measurement includes full-shell startup, warm filesystem caches, other running Mac apps and summed Electron process working sets. Shared memory may be counted more than once. It excludes external worker memory. The initial measurements are in initial-full-shell.json.

The PR diff editor imported Monaco at application startup. Monaco loading has been deferred until a diff is opened, with disposal handling for a view closed before loading finishes. Packaged performance and live diff re-verification are pending.

After deferring Monaco, the three trials measured startup at 12,149 / 606 / 765 ms, working set at 586 / 585 / 588 MiB and echo at 184 / 80 / 24 ms. The memory cost decreased but remained above 500 MiB. The first launch after rebuilding remained above 3,000 ms. These observations do not pass T056. No budget was changed. Further optimization or an owner-approved revision to the foundation-shell budget is required.

With the broad packaged regression complete, another three process-cold, warm-cache launches measured 730 / 726 / 844 ms, memory 588 / 589 / 587 MiB and echo 32 / 25 / 25 ms. Startup and echo pass their budgets in these trials. The 500 MiB summed working-set budget still fails. The earlier deferred-editor measurement overlapped another acceptance check and remains recorded with that load limitation.

A further experiment deferred the PRD editor and terminal modules until opening those tools. It measured 589 / 586 / 591 MiB, which did not materially improve the working set. That experiment was reverted. The diff-only deferred Monaco import remains. The accepted source still fails the current memory budget.
