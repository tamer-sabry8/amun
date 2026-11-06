# Amun agent instructions

## Firstmate homes

Amun-managed Firstmate homes must be real Git worktrees backed by an Amun-owned Git repository. The user explicitly confirmed this requirement on 2026-11-06 for all future Amun work.

Provision and validate Git worktree identity before Firstmate seeding, dispatch, supervision or reattachment. A copied source directory or packaged snapshot alone does not satisfy the home requirement. Keep the packaged pinned runtime distinct from writable operational worktrees.

Preserve personal Firstmate/Herdr/Pi checkouts, homes, active sessions, locks and configurations. Never repair Amun's worktree setup by switching the user's checkout branch, resetting it, or adopting a personal worktree. Use isolated Amun-owned repository/worktree state and record real acceptance evidence.

## External tool updates

The user revised this policy on 2026-11-06: keep Claude 2.1.319 and allow supported updates of external apps/CLIs used by Amun. Do not impose blanket updater-disable flags or automatically restore an older launcher. Use supported updater mechanisms; preserve personal configurations, credentials, working directories, locks and running sessions. Do not restart active workers to apply an update.

Treat installed versions as discoverable capabilities, not fixed assumptions. Record versions before and after acceptance; test the changed integration with the installed release and report incompatibility explicitly. Existing worker processes may still run an older executable; launcher updates do not prove those processes changed version. A version string or successful sign-in alone is not authenticated inference evidence.

Bundled Pi/Firstmate/native dependencies remain reproducibly pinned and checksum-verified. Update those through reviewed dependency changes and relevant source/packaged acceptance; do not silently replace packaged resources. Permission to support updates does not expand M0 or authorize unrelated bulk upgrades.
