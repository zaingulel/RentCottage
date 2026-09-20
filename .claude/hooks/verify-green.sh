#!/bin/sh
# Stop hook — turn-end lint gate for pending application source.
# It resolves the actual linked worktree first, avoids recursive Stop events, and
# runs lint only when src/ has pending changes. Product/database/browser convergence
# remains the coordinator's explicit verification step.
input=$(cat)
case "$input" in *'"stop_hook_active"'*true*) exit 0 ;; esac

root=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$root" ] || root="$CLAUDE_PROJECT_DIR"
if [ -z "$root" ]; then
  echo "Stop gate: no Git work tree here and CLAUDE_PROJECT_DIR is empty, so no project root resolved." >&2
  exit 0
fi
cd "$root" 2>/dev/null || { echo "Stop gate: cannot enter project root ($root), so no project root resolved." >&2; exit 0; }
if ! pending=$(git status --porcelain -- src 2>/dev/null); then
  echo "Stop gate: git could not inspect the resolved project root, so the pending-source lint check could not run." >&2
  exit 0
fi
[ -n "$pending" ] || exit 0
command -v node >/dev/null 2>&1 || { echo "Stop gate: node is not on PATH, so the pending-source lint check could not run." >&2; exit 0; }
if ! out=$(npm run lint 2>&1); then
  printf 'Stop gate: npm run lint failed. Fix before finishing.\n%s\n' "$out" >&2
  exit 2
fi
exit 0
