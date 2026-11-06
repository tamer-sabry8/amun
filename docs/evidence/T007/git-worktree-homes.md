# Real Git worktree homes — 2026-11-06

The user confirmed that Firstmate operational homes must be real Git worktrees. This standing requirement is in the root AGENTS.md.

A first live attempt seeded a copied snapshot but failed during Firstmate dispatch: Git discovered the enclosing Amun feature branch at the distribution location, and the child lacked a Git worktree for hook installation. No branch-switching advice emitted by that failure was executed. Personal repositories remained unchanged.

`createFirstmateWorktrees` now materializes the already checksum-staged snapshot into an exclusive Amun-owned local Git store, then creates genuine primary and worker worktrees. It uses no global Git config, hooks, credentials or remotes. The local snapshot commit includes the Amun permission patch and must not be represented as the upstream commit. The upstream revision/archive checksum remains recorded by the distribution manifest and staging verification. Existing destination roots are refused, names are validated, and copied links are checked for containment. A failed partial root is retained and not silently reused.

Tests failed before this helper existed; real Git tests now verify `.git` worktree files, top-level identity, common store registration, source preservation, duplicate/unsafe-name rejection and refusal to overwrite an existing root. Full workspace check: 171 tests, lint, strict typecheck and formatting passed.

Live follow-up: pinned Firstmate `fm-home-seed.sh --no-projects` and `fm-spawn.sh --harness codex --backend tmux --secondmate` both returned success in the new private scope. Its actual task record reports approval_mode=restricted, yolo=off, a concrete spawn generation and the intended worktree. The worker paused at Codex's folder-trust screen, which was accepted only for this verified new worktree. Operational completion, supervision, Claude dispatch and service reattachment remain separate open gates. This provisioning helper is not yet wired into a product onboarding flow.
