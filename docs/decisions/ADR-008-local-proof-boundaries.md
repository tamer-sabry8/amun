# ADR-008: Local Mac proof boundaries and performance baseline

Status: accepted implementation boundary; current M0 acceptance addendum below.

## Runtime and credentials

Firstmate sessions must use Pi’s documented CLI entry with --mode rpc, because the RPC-only entry’s pi-rpc title failed actual ownership identity verification. Source and packaged CLI-entry ownership plus fresh live watcher checks pass. Keep the bundled runtimes pinned and preserve personal homes; supported external-tool updates follow the user-revised AGENTS.md policy.

Provider reuse is selected and provider-specific. OpenRouter uses Pi’s documented non-refreshing credential export captured in memory and the supported environment key in a disposable runtime with empty PATH. GitHub Copilot must retain OAuth metadata and use Pi’s own OAuth handling; plain-token export failed and is rejected by the adapter. Its selected credential is read through Pi’s public SDK, validated, placed alone in a temporary 0600 auth.json under a 0700 directory, and removed after the test. Refresh is confined to that disposable store. The personal auth file is hash-compared before/after without logging contents or hashes. This is a proof adapter, not completed onboarding/auth-broker UI.

Azure DevOps access is API-only. Company browser access to that service is restricted to Edge; do not use Azure DevOps for embedded-browser acceptance or copy Edge/Chrome cookies. The user authorised ICV test PBI/task API writes with the exact test naming in T009 evidence.

## Performance baseline

Three process-cold packaged launches on this Mac, with warm filesystem caches and other apps running: 713/502/324 ms to Connected; total Electron-reported working set 481/481/480 MiB across five processes; terminal echo 16/22/13 ms including automation scheduling. Shared pages may be double-counted in summed working sets. These figures are from the pre-output-cap package tested during this increment; final release measurement remains required.

Provisional engineering budgets: 3000 ms process startup, 500 MiB summed working set for this foundation shell, 200 ms proof-terminal echo. They are recorded targets, not product-owner release approval. No editor exists yet, so editor latency is not measured. Clean-account installation, Finder launch, signing and notarization remain open; no notarized DMG exists. See docs/evidence/T012/local-baseline.json.

## Current M0 baseline and explicit release deferral — 2026-11-06

Final foundation package trials: startup 341/365/330 ms, working set 485/485/485 MiB across five Electron processes, terminal echo 19/13/13 ms. All meet the recorded 3000 ms / 500 MiB / 200 ms engineering budgets. Warm caches, shared-page double counting, other running apps and absent editor remain limitations. See `evidence/T012/m0-final-performance.json`. Finder terminal acceptance is now user-confirmed.

The user explicitly moved clean-account release installation, signing/notarization and notarized DMG acceptance to release gate R001 (open). T012 M0 now requires the unsigned package and measured baseline; this does not establish release readiness. See ADR-009.
