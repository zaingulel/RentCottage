// unsafe-git.mjs — the pure decision logic behind .claude/hooks/block-unsafe-git.mjs and
// .codex/hooks/block-unsafe-git.mjs (the PreToolUse(Bash) guards). Extracted so the rules get unit
// test coverage; each hook stays a thin stdin/stderr/exit-code shell around blockReason().
//
// Six plain rules, judged on the actual command segments of an agent's shell call:
//   git commit --no-verify   -> skips the pre-commit gates
//   git push --no-verify     -> skips the lint pre-push hook
//   git push --force / -f    -> unsafe overwrite (--force-with-lease is ALLOWED)
//   git filter-branch        -> history rewrite
//   gh pr create (no --draft)-> skips the draft review before the metered suite
//   gh pr merge (no --auto)  -> an admin token merges regardless of checks; --auto lets GitHub
//                                merge only once the required test check is green
//   git commit / checkout / switch / branch <new> / merge (not --ff-only) / cherry-pick / revert /
//   rebase / am in the root checkout
//                            -> the root is the integration checkout: it stays on main and
//                                nothing is branched, switched, or committed there; a job runs in
//                                a linked worktree. Judged only when the hook passes
//                                `checkout` ({ cwd, isRootCheckout(dir) }, resolved by git in
//                                scripts/lib/checkout-context.mjs); `git switch main`,
//                                `git branch -d`, pulls, and worktree upkeep stay allowed
//
// Quoted spans and heredoc bodies are data, not invocations, and are blanked before the rules look,
// so a commit message or pull request body that mentions `--force` or `--draft` trips nothing. The
// guard reads the command text with regular expressions and does not tokenise it, and it does not
// look inside a shell wrapper, a command substitution, or an `env -S` string: it is an
// accident-catcher for an agent's own plainly written tool calls, not a security boundary.
// Server-side branch protection is the boundary, and a manual command in your own terminal is not
// a tool call, so your escape hatch survives.
// Executable names (git, gh) are matched case-insensitively: this repository lives on a
// case-insensitive volume, so `Git push --force` runs the real binary. Only the name is widened;
// subcommands and flags stay exact (`git COMMIT` is not a command, `-F` is not `-f`), and `cd` stays
// lowercase because a capitalised `CD` runs /usr/bin/cd in a child process and moves nothing.
import { resolve } from 'node:path';

// Returns a reason string when `cmd` should be blocked, or "" when it's allowed. `checkout` is the
// hook's working-directory context, `{ cwd, isRootCheckout(dir) }`; without it the root-checkout rule
// is not judged, and every other rule is unchanged.
export function blockReason(cmd, checkout) {
  cmd = cmd ?? "";
  // Widen each letter of a name to its own class rather than using a regex `i` flag, which would
  // also loosen every option match in the same expression (`-F` for `-f`, `-D` for `-d`).
  const ci = (name) => [...name].map((ch) => (/[a-z]/.test(ch) ? `[${ch.toUpperCase()}${ch}]` : ch)).join('');
  // deheredoc — replace each heredoc operator with `<<HEREDOC` and drop its body, nothing else.
  // A body starts after the next UNQUOTED newline (POSIX XCU 2.7.4), so words after `<<WORD` on the
  // operator line are argv and survive; a `<<WORD` inside quotes is prose and opens no pairing; `<<<`
  // is a here-string and opens none either. The scan carries shell quote state and skips body text,
  // so an apostrophe in a body cannot poison it, and it queues the operators on one line so
  // `cat <<A <<B` consumes A's body then B's. The terminator test tolerates surrounding blanks and a
  // trailing \r, because a body left visible is the false-block this pass exists to prevent.
  // Not modelled, named rather than hidden: a backslash-continued operator line, a `<<\EOF`
  // delimiter, shell arithmetic (`$((1 << 3))` opens a pairing on `3`), a shell comment, and a
  // heredoc inside "$(…)", which the shell re-parses and this scan does not re-enter.
  const HEREDOC_OPERATOR = /^<<-?[ \t]*(['"]?)(\w+)\1/;
  const deheredoc = (() => {
    let out = '';
    let index = 0;
    let inSingle = false;
    let inDouble = false;
    let pending = [];
    while (index < cmd.length) {
      const ch = cmd[index];
      if (ch === "'" && !inDouble) { inSingle = !inSingle; out += ch; index += 1; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; out += ch; index += 1; continue; }
      if (
        ch === '<' && cmd[index + 1] === '<'
        && cmd[index + 2] !== '<' && cmd[index - 1] !== '<'
        && !inSingle && !inDouble
      ) {
        const operator = HEREDOC_OPERATOR.exec(cmd.slice(index));
        if (operator) {
          pending.push(operator[2]);
          out += '<<HEREDOC';
          index += operator[0].length;
          continue;
        }
      }
      out += ch;
      index += 1;
      if (ch === '\n' && !inSingle && !inDouble && pending.length) {
        for (const word of pending) {
          const hit = new RegExp('^[ \\t]*' + word + '[ \\t]*\\r?$', 'm').exec(cmd.slice(index));
          if (!hit) break;
          index += hit.index + hit[0].length;
        }
        pending = [];
      }
    }
    return out;
  })();
  // Blank every quoted span ONCE, before any splitting or matching. A quoted mention is data
  // (`git commit -m "mentions --no-verify"`, a PR body citing `--draft`), and blanking a quoted
  // newline keeps a multi-line body from stranding a later `--draft` in its own segment. `[^"]` and
  // `[^']` match newlines, so a multi-line span is blanked whole. A quoted path after `cd` or `-C` is
  // a relocation the root-checkout walk below must follow, and this checkout's own directory carries
  // a space, so it is blanked to a whitespace-free ␀<n>␀ placeholder instead of `""` and kept aside
  // for relocate(). Planted inside the one pass so quote pairing stays the blanker's own: a separate
  // scan once paired an apostrophe inside a double-quoted span with a later single quote and
  // swallowed live argv (pinned by test).
  const quotedPaths = [];
  const sanitized = deheredoc.replace(/'[^']*'|"[^"]*"/g, (span, offset, whole) => (
    /(?:^|[\s;&|(])(?:cd|-C)[ \t]+$/.test(whole.slice(0, offset)) && /^(?:[\s;&|)]|$)/.test(whole.slice(offset + span.length))
      ? `␀${quotedPaths.push(span.slice(1, -1)) - 1}␀`
      : '""'
  ));
  // Every rule anchors on the git or gh invocation, path-qualified or bare, after any leading
  // variable assignments (`GIT_AUTHOR_NAME=x git commit`, `GH_TOKEN=x gh pr merge`).
  const EXEC_PATH = String.raw`(?:\S*\/)?`;
  const GIT_OPT_WITH_ARG = String.raw`(?:-C|-c|--git-dir|--work-tree|--namespace|--config-env)\s+\S+\s+`;
  const GIT_EXEC = String.raw`${EXEC_PATH}${ci('git')}`;
  const GIT_INVOCATION_PREFIX = String.raw`^${GIT_EXEC}\s+(?:${GIT_OPT_WITH_ARG}|-\S+\s+)*`;
  const GIT_COMMIT = new RegExp(String.raw`${GIT_INVOCATION_PREFIX}commit\b`);
  const GIT_PUSH = new RegExp(String.raw`${GIT_INVOCATION_PREFIX}push\b`);
  const GIT_FILTER_BRANCH = new RegExp(String.raw`${GIT_INVOCATION_PREFIX}filter-branch\b`);
  // -R/--repo is inherited by `gh pr`, so it is valid before `pr` or before the subcommand.
  const GH_REPO_OPT = String.raw`(?:-R\S+|--repo=\S+|(?:-R|--repo)\s+\S+)\s+`;
  const GH_EXEC = String.raw`${EXEC_PATH}${ci('gh')}`;
  const GH_PR_MERGE = new RegExp(String.raw`^${GH_EXEC}\s+(?:${GH_REPO_OPT})*pr\s+(?:${GH_REPO_OPT})*merge\b`);
  const GH_PR_CREATE = new RegExp(String.raw`^${GH_EXEC}\s+(?:${GH_REPO_OPT})*pr\s+(?:${GH_REPO_OPT})*create\b`);
  const NO_VERIFY = /(?:^|\s)--no-verify(?:\s|=|$)/;
  const ruleReason = (s) => {
    if (GIT_COMMIT.test(s) && NO_VERIFY.test(s)) {
      return "git commit --no-verify skips the pre-commit gates";
    }
    if (GIT_PUSH.test(s) && NO_VERIFY.test(s)) {
      return "git push --no-verify skips the lint pre-push gate";
    }
    if (GIT_PUSH.test(s) && /(?:^|\s)(?:--force(?!-with-lease)|-f)(?:\s|$)/.test(s)) {
      return "git push --force is unsafe (use --force-with-lease for a rebase)";
    }
    if (GIT_FILTER_BRANCH.test(s)) {
      return "git filter-branch rewrites history";
    }
    if (GH_PR_CREATE.test(s) && !/(?:^|\s)(?:--draft|-d)(?:\s|$)/.test(s)) {
      return "gh pr create without --draft skips the draft review: open it as a draft (--draft/-d) so Greptile reviews it before CI runs";
    }
    // Auto-merge is GitHub's own wait-for-green: the agent's owner-authorised merge is queued, never forced.
    if (GH_PR_MERGE.test(s) && !/(?:^|\s)--auto(?:\s|=|$)/.test(s)) {
      return "gh pr merge without --auto merges whatever the checks say (an admin token is not bound by branch protection); use `gh pr merge --auto --squash <pr>` so GitHub merges only once the required test check is green";
    }
    return '';
  };
  // Integration-checkout rule. The root checkout (the main working tree, never a linked worktree)
  // stays on main and nothing is branched, switched, or committed there: two sessions sharing it
  // collided twice while prose alone said so. Where a command runs is a fact only the hook can ask
  // git for, so it passes `checkout` and any caller passing nothing is not judged. The walk carries a
  // SET of candidate directories across segments, and refuses branch work if any of them is the
  // root: a `cd` chained with `&&` replaces the set (a failed cd stops the chain), one chained with
  // `;`, a newline, or `||` adds to it (a failed cd leaves the shell where it was and the chain runs
  // on), and one behind `|` moves nothing (a pipeline subshell). `git -C <path>` moves one
  // invocation. So `cd <worktree> && git commit` from the root stays allowed, `cd <root> && git
  // commit` from a worktree is refused, and `cd <gone>; git commit` from the root is refused too.
  // Branch work is commit, checkout, switch, a `git branch` that names a branch without deleting
  // or listing, and the other writers of commits onto the current branch: merge (a fast-forward-only
  // merge is the pull's own shape and stays allowed), cherry-pick, revert, rebase, am. The lone
  // switch allowed is to `main`, the only branch the root may hold, which is how closeout and the
  // sweep restore it; `-q`, `--no-guess`, the other read-only switch options, and a redirection
  // around it are decoration, and any other option (`-b`, `--detach`, `--`, …) is not.
  // Fail-OPEN residuals, named: a target the guard cannot resolve (`cd` alone, `cd -`, `~`, a
  // variable, a blanked span) is an unknown candidate the walk cannot judge, though the known ones
  // beside it still are, and --git-dir/--work-tree on the invocation makes the invocation unknown;
  // `pushd` and a backslash-escaped space in a path are not modelled.
  // Fail-CLOSED residuals: a parenthesised `(cd x && …)` never relocates, because nothing would
  // restore the directory when the subshell closes, so the whole command is judged where it started;
  // `cd x || exit 1; git commit` keeps the old directory as a candidate although the exit would have
  // taken it, and so does `cd <root>; cd <worktree>; git commit`, because a `;`-chained cd is never
  // known to have succeeded. All are visible and recoverable: chain with `&&`.
  const CD_SEGMENT = /^cd(?:\s+(\S+))?(?:\s|$)/;
  const GIT_BRANCH_WORK = new RegExp(String.raw`^${GIT_EXEC}\s+((?:${GIT_OPT_WITH_ARG}|-\S+\s+)*)(commit|checkout|switch|branch|merge|cherry-pick|revert|rebase|am)(?=\s|$)(.*)$`);
  const relocate = (from, target) => {
    if (target === undefined) return null;
    const planted = /^␀(\d+)␀$/.exec(target);
    const path = planted ? quotedPaths[Number(planted[1])] : target;
    if (/^[-~]|[$`]/.test(path) || (from === null && !path.startsWith('/'))) return null;
    return resolve(from ?? '', path);
  };
  const isBranchWork = (subcommand, args) => {
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    if (subcommand === 'branch') {
      // A revision-taking listing option (`--merged main`, `--contains <sha>`, `--list 'job/*'`) is
      // a read; only a bare branch name with none of those, and no delete flag, creates or renames.
      return tokens.some((token) => !token.startsWith('-'))
        && !tokens.some((token) => /^(?:-[A-Za-z]*[dD][A-Za-z]*|--delete|-l|--list|--merged|--no-merged|--contains|--no-contains|--points-at)$/.test(token));
    }
    // Backing out of a merge state (`--abort`/`--quit`) is recovery, not branch work, and the
    // allowed `git pull` is how the root gets into one.
    if (tokens.some((token) => token === '--abort' || token === '--quit')) return false;
    if (subcommand === 'merge') return !tokens.includes('--ff-only');
    if (subcommand !== 'checkout' && subcommand !== 'switch') return true;
    const words = args.replace(/\s(?:\d*[<>]{1,2}|&>>?)(?:&\d+|\s*\S+)/g, '').trim().split(/\s+/).filter(Boolean);
    const positional = words.filter((token) => !token.startsWith('-'));
    const options = words.filter((token) => token.startsWith('-'));
    return positional.join(' ') !== 'main'
      || !options.every((token) => /^(?:-q|--quiet|--guess|--no-guess|--progress|--no-progress|--ignore-other-worktrees|--no-ignore-other-worktrees|--recurse-submodules|--no-recurse-submodules)$/.test(token));
  };
  let dirs = [checkout?.cwd ?? null];
  const rootCheckoutReason = (s) => {
    const invocation = checkout ? GIT_BRANCH_WORK.exec(s) : null;
    if (!invocation) return '';
    const [, options, subcommand, args] = invocation;
    if (/(?:^|\s)--(?:git-dir|work-tree)(?:=|\s)/.test(options) || !isBranchWork(subcommand, args)) return '';
    const hops = [...options.matchAll(/(?:^|\s)-C\s+(\S+)/g)].map((hop) => hop[1]);
    const at = dirs.map((dir) => hops.reduce(relocate, dir));
    if (!at.some((dir) => dir !== null && checkout.isRootCheckout(dir))) return '';
    return `git ${subcommand} in the integration checkout: the root stays on main and nothing is branched, switched, or committed there — open a job checkout with git worktree add and run it from there`;
  };
  // The separator AFTER each segment is kept: the integration-checkout walk needs to know whether a
  // `cd` that fails would stop the chain (`&&`) or let it run on where it was (`;`, a newline, `||`),
  // or ran in a pipeline subshell that moved nothing (`|`). First match wins.
  const parts = sanitized.split(/(\|\||&&|[;\n|])/);
  for (let index = 0; index < parts.length; index += 2) {
    const s = parts[index].trim().replace(/^(?:\w+=\S*\s+)+/, '');
    const after = parts[index + 1] ?? '';
    const relocation = CD_SEGMENT.exec(s);
    if (relocation && after !== '|') {
      const moved = dirs.map((dir) => relocate(dir, relocation[1]));
      dirs = [...new Set(after === '&&' ? moved : [...dirs, ...moved])];
    }
    const hit = rootCheckoutReason(s) || ruleReason(s);
    if (hit) return hit;
  }
  return '';
}
