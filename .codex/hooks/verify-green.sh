#!/bin/sh
# Stop hook — turn-end lint gate for pending application source.
# It resolves the actual linked worktree, avoids recursive Stop events, and runs
# lint only when src/ has pending changes.
input=$(cat)
case "$input" in *'"stop_hook_active"'*true*) exit 0 ;; esac

if ! root=$(git rev-parse --show-toplevel 2>/dev/null) || [ -z "$root" ]; then
  echo "Stop gate: no Git work tree resolved here." >&2
  exit 0
fi
cd "$root" || { echo "Stop gate: cannot enter repository root $root." >&2; exit 2; }
if ! pending=$(git status --porcelain -- src 2>/dev/null); then
  echo "Stop gate: git could not inspect the resolved repository root, so the pending-source lint check could not run." >&2
  exit 0
fi
[ -n "$pending" ] || exit 0
command -v node >/dev/null 2>&1 || { echo "Stop gate: node is not on PATH, so the pending-source lint check could not run." >&2; exit 0; }
if ! out=$(npm run lint 2>&1); then
  printf 'Stop gate: npm run lint failed. Fix before finishing.\n%s\n' "$out" >&2
  exit 2
fi
exit 0
