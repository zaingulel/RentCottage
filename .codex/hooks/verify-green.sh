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
command -v node >/dev/null 2>&1 || { echo "Stop gate: node is not on PATH, so the lint observation is unavailable." >&2; exit 0; }
command -v npm >/dev/null 2>&1 || { echo "Stop gate: npm is not on PATH, so the lint observation is unavailable." >&2; exit 0; }
if ! node -e 'const lint = require("./package.json")?.scripts?.lint; process.exit(typeof lint === "string" && lint.trim() ? 0 : 1)' >/dev/null 2>&1; then
  echo "Stop gate: package.json has no declared lint script, so the lint observation is unavailable." >&2
  exit 0
fi

eslint_bin=""
eslint_dir=$root
while :; do
  if [ -x "$eslint_dir/node_modules/.bin/eslint" ]; then
    eslint_bin="$eslint_dir/node_modules/.bin/eslint"
    break
  fi
  eslint_parent=$(dirname "$eslint_dir")
  [ "$eslint_parent" = "$eslint_dir" ] && break
  eslint_dir=$eslint_parent
done
if [ -z "$eslint_bin" ]; then
  echo "Stop gate: the installed ESLint executable is unavailable, so the lint observation is unavailable." >&2
  exit 0
fi

out=$(npm run lint 2>&1)
lint_status=$?
case "$lint_status" in
  0) exit 0 ;;
  1)
    printf 'Stop gate: lint completed with findings. Fix before finishing.\n%s\n' "$out" >&2
    exit 2
    ;;
  *)
    printf 'Stop gate: the lint observation is unavailable because npm run lint exited %s.\n%s\n' "$lint_status" "$out" >&2
    exit 0
    ;;
esac
