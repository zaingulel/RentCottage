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
command -v node >/dev/null 2>&1 || { echo "Stop gate: node is not on PATH, so the lint observation is unavailable." >&2; exit 0; }
command -v npm >/dev/null 2>&1 || { echo "Stop gate: npm is not on PATH, so the lint observation is unavailable." >&2; exit 0; }
package_check=$(node -e 'try { const lint = require("./package.json")?.scripts?.lint; process.exit(typeof lint === "string" && lint.trim() ? 0 : 1); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(2); }' 2>&1)
package_status=$?
case "$package_status" in
  0) ;;
  1)
    echo "Stop gate: package.json has no declared lint script, so the lint observation is unavailable." >&2
    exit 0
    ;;
  *)
    printf 'Stop gate: package.json could not be read, so lint cannot be trusted.\n%s\n' "$package_check" >&2
    exit 2
    ;;
esac

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
    printf 'Stop gate: lint failed with exit %s. Fix the lint configuration or runtime failure before finishing.\n%s\n' "$lint_status" "$out" >&2
    exit 2
    ;;
esac
