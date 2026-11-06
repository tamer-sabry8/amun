# T007 — Managed operational-home increment

Source contract inspected at Firstmate commit `4a67799d8a8670d6ea1a55250b67d8474b070a09`, docs/configuration.md: FM_HOME, runtime backend, Claude permission mode, secondmate harness, crew dispatch profiles.

Red: six failures / six passes against stubs. Green: all 12 home tests pass; workspace total is 63. Tests use temporary directories, never personal Firstmate state.

Implemented: a bounded allowlist of operational config imports; auto permission mode forced even if imported as bypass; default Herdr/Codex choices; exclusive new-home creation; 0700 directories and 0600 files; rejection of traversal, unknown files, malformed dispatch JSON and symlink ancestry; no overwrite of an existing home. Dispatch contents are only checked for valid JSON-object shape; Firstmate's semantic resolver remains authoritative. A failure during creation can leave a partial home, which subsequent calls refuse rather than overwriting.

Not implemented or claimed: pinned distribution installation, skills import/approval, extension trust, watcher startup, Firstmate live RPC compatibility or worker dispatch. This helper is not wired to a product flow. T007 remains open.

## Pinned distribution and startup increment

The manifest pins the full upstream commit and archive SHA-256; staging verifies bytes before extraction and checks all extracted symlinks. `distribution-red.log` records five failed / one passed integrity tests before verification was implemented. `codex-mode-red.log` records the two failures that exposed the missing restricted Codex override. `firstmate-green.log` records 72 passing Amun-owned tests after implementation. Vendor tests in staged distributions are excluded from Amun's suite; no upstream test results are claimed.

`live-startup.log` and `packaged-startup.log` record real Pi/Firstmate responses: watcher command registration, loaded marker matching the child PID, missing-ownership refusal over RPC, auto/restricted worker modes, and an unchanged synthetic personal-home tree. The packaged proof uses the copied Firstmate distribution, copied Pi dependency tree and actual Electron executable. No model turn or worker dispatch is performed.

The earlier distribution/trust/extension-loading gaps above are now covered by this narrow proof. Personal skill import, an owned/armed watcher, full operational supervision, worker approval handling and real dispatch remain unverified. See ADR-004-firstmate-rpc.md; T007 remains open.
