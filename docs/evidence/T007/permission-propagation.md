# Bundled Firstmate permission propagation

The live unpatched propagation function changed Claude to auto but left Codex bypass in a disposable child home. This is recorded in permission-live-red.log. An explicit Amun-only patch adds codex-permission-mode to the upstream inheritance list. Staging first verifies the pinned archive, containment and exact source-file SHA-256 e76b7896b018ee6e31e564f3660e5698b7a135dabbe28b730c62690dc3fc0f0a. Unknown, repeated or already-patched anchors fail closed. No personal installation is patched or upgraded.

Source and packaged scripts/firstmate-permissions-proof.ts call the actual upstream propagation function with deliberately wrong child values; both now return claude=auto, codex=restricted, propagated=true. Tests use private disposable directories and launch zero workers. This proves home-to-home permission configuration convergence, not actual worker launch flags or approval behavior. Those live gates remain open.
