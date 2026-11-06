# Amun agent instructions

## Firstmate homes

Amun-managed Firstmate homes must be real Git worktrees backed by an Amun-owned Git repository. The user explicitly confirmed this requirement on 2026-11-06 for all future Amun work.

Provision and validate Git worktree identity before Firstmate seeding, dispatch, supervision or reattachment. A copied source directory or packaged snapshot alone does not satisfy the home requirement. Keep the packaged pinned runtime distinct from writable operational worktrees.

Preserve personal Firstmate/Herdr/Pi checkouts, homes, active sessions, locks and installed versions. Never repair Amun's worktree setup by switching the user's checkout branch, resetting it, or adopting a personal worktree. Use isolated Amun-owned repository/worktree state and record real acceptance evidence.
