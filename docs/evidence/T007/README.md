# T007 — Managed operational-home increment

Source contract inspected at Firstmate commit `4a67799d8a8670d6ea1a55250b67d8474b070a09`, docs/configuration.md: FM_HOME, runtime backend, Claude permission mode, secondmate harness, crew dispatch profiles.

Red: six failures / six passes against stubs. Green: all 12 home tests pass; workspace total is 63. Tests use temporary directories, never personal Firstmate state.

Implemented: a bounded allowlist of operational config imports; auto permission mode forced even if imported as bypass; default Herdr/Codex choices; exclusive new-home creation; 0700 directories and 0600 files; rejection of traversal, unknown files, malformed dispatch JSON and symlink ancestry; no overwrite of an existing home. Dispatch contents are only checked for valid JSON-object shape; Firstmate's semantic resolver remains authoritative. A failure during creation can leave a partial home, which subsequent calls refuse rather than overwriting.

Not implemented or claimed: pinned distribution installation, skills import/approval, extension trust, watcher startup, Firstmate live RPC compatibility or worker dispatch. This helper is not wired to a product flow. T007 remains open.
