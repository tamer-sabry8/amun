# macOS packaged-runtime validation

Run: https://github.com/tamer-sabry8/amun/actions/runs/42145190729
Code commit: aac00a6d0a46d1d13e914ad8ac5f7340d88c6e42

Passed: frozen installation, lint/typecheck/format, 66 unit tests, source Electron launch/isolation and crash recovery, isolated Pi RPC, unsigned Mac packaging, packaged dependency-containment check, packaged Pi RPC with empty PATH, and both Electron tests against the packaged executable.

This closes the portable packaging proof within T006. It does not close T006 overall: authenticated providers, streaming/extension UI and application integration are still pending. Signing, notarization, Finder installation and performance remain T012.
