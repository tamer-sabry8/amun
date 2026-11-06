# macOS CI evidence

Run: https://github.com/tamer-sabry8/amun/actions/runs/42012823971

Verified on 2026-11-05: fresh macOS runner installed frozen dependencies, passed lint/typecheck/format and 14 unit tests, built the Electron shell, and executed its sandbox-enabled launch/isolation test (1 passed). This validates the foundation window; it does not establish release signing, Finder launch or performance budgets.
