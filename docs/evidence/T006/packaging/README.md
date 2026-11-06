# Packaged Pi portability proof

The initial artifact passed the RPC probe only because Node cp had rewritten symlinks to absolute build paths. The added containment check exposed this. Red evidence records two failing portability assertions before repair. Green evidence records 66 workspace tests passing, including source-deletion portability, rejection of escaped dependencies and constrained removal of pnpm's development self-reference.

The rebuilt Linux package contains 374 symlinks, all resolved inside its own Pi tree. Its packaged Electron executable answered get_state and get_available_models with an empty PATH; see rpc.log. This does not imply authenticated models or a working Firstmate crew. The latest macOS CI runs both packaged GUI tests plus the contained-runtime probe.

The package is unsigned and not notarized. Finder installation and performance budgets remain T012 gates.
