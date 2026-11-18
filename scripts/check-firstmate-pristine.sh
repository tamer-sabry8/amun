#!/usr/bin/env bash
# Fails if vendor/firstmate differs from the last upstream subtree squash.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
squash=$(git log -1 --format=%H --grep='^git-subtree-dir: vendor/firstmate$' --grep='^Squashed .vendor/firstmate/. content' --all-match)
if [ -z "$squash" ]; then
  echo "No subtree squash commit for vendor/firstmate found." >&2
  exit 1
fi
expected=$(git rev-parse "$squash^{tree}")
actual=$(git rev-parse HEAD:vendor/firstmate)
if [ "$expected" != "$actual" ]; then
  echo "vendor/firstmate was edited after the upstream subtree squash:" >&2
  git diff --stat "$expected" "$actual" >&2
  exit 1
fi
if ! git diff --quiet HEAD -- vendor/firstmate || [ -n "$(git status --porcelain -- vendor/firstmate)" ]; then
  echo "vendor/firstmate has uncommitted edits." >&2
  git status --short -- vendor/firstmate >&2
  exit 1
fi
