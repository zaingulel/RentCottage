// unsafe-git.test.mjs — mutation-proof unit tests for the PreToolUse(Bash) guard rules.
// Run: node --test scripts/lib/   (or `npm run test:scripts`)
//
// Every blocked fixture asserts the exact rule reason, never a bare truthy, so a rule that fires for
// the wrong reason reddens a test instead of hiding behind another rule's verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';
import { blockReason } from './unsafe-git.mjs';

const REASON_CREATE = "gh pr create without --draft skips the draft review: open it as a draft (--draft/-d) so Greptile reviews it before CI runs";
const REASON_MERGE = 'gh pr merge without --auto merges whatever the checks say (an admin token is not bound by branch protection); use `gh pr merge --auto --squash <pr>` so GitHub merges only once the required test check is green';
const REASON_COMMIT_NO_VERIFY = 'git commit --no-verify skips the pre-commit gates';
const REASON_PUSH_NO_VERIFY = 'git push --no-verify skips the lint pre-push gate';
const REASON_PUSH_FORCE = 'git push --force is unsafe (use --force-with-lease for a rebase)';
const REASON_FILTER_BRANCH = 'git filter-branch rewrites history';

// ── gh pr create --draft ────────────────────────────────────────────────────

test('gh pr create without --draft is blocked', () => {
  assert.equal(blockReason('gh pr create --title x --body y'), REASON_CREATE);
  // the executable name is matched case-insensitively (a capitalised `GH` runs gh here)
  assert.equal(blockReason('GH pr create --title x --body y'), REASON_CREATE);
});

test('gh pr create --draft is allowed', () => {
  assert.equal(blockReason('gh pr create --draft --title x'), '');
});

test('gh pr create -d is allowed (short flag)', () => {
  assert.equal(blockReason('gh pr create -d --title x'), '');
});

test('echo "gh pr create" (a quoted mention, not a real invocation) is allowed', () => {
  assert.equal(blockReason('echo "gh pr create"'), '');
});

// A `--draft` merely QUOTED inside --title/--body satisfied the flag check with no real flag, so the
// PR slipped through un-drafted and burned CI. Quoted spans are blanked before the rules look, so a
// quoted flag is never a real one.
test('a --draft quoted inside --title is NOT a real flag — still blocked', () => {
  assert.equal(blockReason('gh pr create --title "block it without --draft " --body x'), REASON_CREATE);
});

test('a --draft quoted inside --body is NOT a real flag — still blocked', () => {
  assert.equal(blockReason('gh pr create --body "see --draft docs" --title x'), REASON_CREATE);
});

// A newline inside an earlier quoted --body used to strand a real trailing --draft in a later split
// segment. Agents build multiline bodies constantly, so this fired often and taught the wrong lesson.
test('a real --draft after a MULTILINE quoted --body is allowed', () => {
  assert.equal(blockReason('gh pr create --title x --body "line1\nline2" --draft'), '');
});

// ── gh pr ready ──────────────────────────────────────────────────────────────

// `--undo` sends a PR BACK to draft: the cost-saving direction, and the only remedy when a PR is
// already ready and a post-ready fix would otherwise burn another metered run.
test('gh pr ready --undo (re-draft, the cost-saving direction) is allowed', () => {
  assert.equal(blockReason('gh pr ready --undo 406'), '');
});

// -R/--repo is inherited by `gh pr`, so it is valid before `pr` or before the subcommand. The
// create and merge rules must tolerate it in both positions, or a `gh -R owner/repo pr create`
// slips past ungated (the fail-open this pins).
test('gh pr create and gh pr merge tolerate -R/--repo in both positions', () => {
  assert.equal(blockReason('gh -R owner/repo pr create --title x'), REASON_CREATE);
  assert.equal(blockReason('gh pr -R owner/repo create --title x'), REASON_CREATE);
  assert.equal(blockReason('gh -Rowner/repo pr create --title x'), REASON_CREATE);
  assert.equal(blockReason('gh --repo owner/repo pr merge 406'), REASON_MERGE);
  assert.equal(blockReason('gh pr --repo owner/repo merge 406'), REASON_MERGE);
  assert.equal(blockReason('gh --repo=owner/repo pr merge 406'), REASON_MERGE);
  // the option must not swallow the draft/auto escape
  assert.equal(blockReason('gh -R owner/repo pr create --draft --title x'), '');
  assert.equal(blockReason('gh --repo owner/repo pr merge --auto 406'), '');
});

// ── gh pr merge ─────────────────────────────────────────────────────────────

test('gh pr merge without --auto is blocked, bare, path-qualified, assignment-led, or chained', () => {
  const blocked = [
    'gh pr merge 493 --squash',
    'Gh pr merge 493 --squash',
    'gh pr merge 406',
    'GH_TOKEN=x gh pr merge 493',
    'gh --repo someone/example-repository pr merge 493',
    'gh pr -R someone/example-repository merge 493',
    'gh pr view 493 && gh pr merge 493',
    '/Users/zain/.local/bin/gh pr merge 493 --squash',
    './bin/gh pr merge 493 --squash',
  ];
  for (const command of blocked) assert.equal(blockReason(command), REASON_MERGE, command);

  assert.equal(blockReason('echo "gh pr merge 493"'), '');
  assert.equal(blockReason('git commit -m "use gh pr merge only through the wrapper"'), '');
  assert.equal(blockReason('gh pr view 493'), '');
  assert.equal(blockReason('gh pr checks 493'), '');
  // Auto-merge is the supported form: GitHub merges only when the required check is green.
  assert.equal(blockReason('gh pr merge --auto --squash 493'), '');
  assert.equal(blockReason('gh pr merge 493 --auto --squash --delete-branch'), '');
  assert.equal(blockReason('gh --repo someone/example-repository pr merge --auto 493'), '');
});

// ── git commit / push --no-verify ───────────────────────────────────────────

test('git commit --no-verify is blocked', () => {
  assert.equal(blockReason('git commit --no-verify'), REASON_COMMIT_NO_VERIFY);
  assert.equal(blockReason('Git commit --no-verify'), REASON_COMMIT_NO_VERIFY);
  assert.equal(blockReason('git commit -m x --no-verify'), REASON_COMMIT_NO_VERIFY);
  assert.equal(blockReason('git -C . commit --no-verify -m x'), REASON_COMMIT_NO_VERIFY);
});

test('git commit -m mentioning --no-verify in quoted data is allowed', () => {
  assert.equal(blockReason('git commit -m "mentions --no-verify"'), '');
  assert.equal(blockReason("git commit -m 'never use --no-verify here'"), '');
});

test('git push --no-verify is blocked across direct reordered assignment-led and path-qualified forms', () => {
  const blocked = [
    'git push --no-verify origin HEAD',
    'git push origin HEAD --no-verify',
    'git --no-pager push origin HEAD --no-verify',
    'FOO=1 git push --no-verify origin HEAD',
    '/usr/local/bin/git push --no-verify origin HEAD',
    'git -C . push --no-verify origin HEAD',
    'git --git-dir .git push origin HEAD --no-verify',
  ];
  for (const command of blocked) assert.equal(blockReason(command), REASON_PUSH_NO_VERIFY, command);
});

// ── git push --force ────────────────────────────────────────────────────────

test('git push --force and -f are blocked', () => {
  assert.equal(blockReason('git push --force'), REASON_PUSH_FORCE);
  assert.equal(blockReason('GIT push --force'), REASON_PUSH_FORCE);
  assert.equal(blockReason('git push -f origin main'), REASON_PUSH_FORCE);
  assert.equal(blockReason('git --git-dir .git push --force'), REASON_PUSH_FORCE);
  assert.equal(blockReason('git commit -m "x" && git push --force'), REASON_PUSH_FORCE);
});

test('git push --force-with-lease is allowed', () => {
  assert.equal(blockReason('git push --force-with-lease'), '');
  assert.equal(blockReason('git push --force-with-lease origin HEAD'), '');
  assert.equal(blockReason('git --git-dir .git push --force-with-lease origin HEAD'), '');
});

test('a quoted span that only mentions a flag is still data', () => {
  assert.equal(blockReason('git commit -m "--force is not for us"'), '');
  assert.equal(blockReason('echo git push --no-verify'), '');
  assert.equal(blockReason('grep -n "git push --no-verify" docs/GUIDE.md'), '');
  assert.equal(blockReason('git commit -m "docs: explain why git push --no-verify is blocked"'), '');
  assert.equal(blockReason('echo "git -C . push --no-verify origin HEAD"'), '');
  assert.equal(blockReason('git commit -m "document git -C . push --no-verify"'), '');
});

// The quote blanker pairs quotes in one left-to-right pass together with the cd/-C path placeholder,
// so a stray apostrophe inside a double-quoted message cannot pair with a later single quote and
// swallow live argv (a separate scan once re-opened the --no-verify and --force rules this way).
test('a stray apostrophe in a message cannot hide a gated flag', () => {
  assert.equal(blockReason(`git commit -m "x -C 'a" --no-verify -m '  x'`), REASON_COMMIT_NO_VERIFY);
  assert.equal(blockReason(`git commit -m "x cd 'a" --no-verify -m ' x'`), REASON_COMMIT_NO_VERIFY);
  assert.equal(blockReason(`git push -m "x -C 'a" --force ' x'`), REASON_PUSH_FORCE);
});

// ── git filter-branch ───────────────────────────────────────────────────────

test('git filter-branch is blocked', () => {
  assert.equal(blockReason('git filter-branch --tree-filter x'), REASON_FILTER_BRANCH);
  assert.equal(blockReason('Git filter-branch --tree-filter x'), REASON_FILTER_BRANCH);
  assert.equal(blockReason('git -C . filter-branch --tree-filter x'), REASON_FILTER_BRANCH);
});

// ── plain and allowed forms ─────────────────────────────────────────────────

test('ordinary git and gh commands pass', () => {
  for (const command of [
    'git status',
    'git -C . status',
    'git -C . push origin HEAD',
    'git push origin HEAD',
    'git -c color.ui=false push origin HEAD',
    'GIT_AUTHOR_NAME=Someone git push origin HEAD',
    'gh pr list',
    'gh pr view 493 --json state',
  ]) assert.equal(blockReason(command), '', command);
});

// A leading variable assignment is part of how a plain command is written, so the rules anchor past
// it; without that, `GH_HOST=x gh pr create` matched no `^gh` rule and slipped through.
test('an assignment prefix does not smuggle a gated invocation past its rule', () => {
  assert.equal(blockReason('GH_HOST=github.com gh pr create --title x'), REASON_CREATE);
  assert.equal(blockReason('GH_TOKEN=abc gh pr merge 406'), REASON_MERGE);
  assert.equal(blockReason('GH_HOST=github.com gh pr create --draft --title x'), '');
});

// A path-qualified executable is what a PATH lookup resolves to, so every rule anchors on it.
test('a path-qualified git or gh anchors every rule', () => {
  assert.equal(blockReason('/usr/local/bin/gh pr merge 406'), REASON_MERGE);
  assert.equal(blockReason('/opt/homebrew/bin/gh pr create --title x'), REASON_CREATE);
  assert.equal(blockReason('/usr/bin/git push --force'), REASON_PUSH_FORCE);
  assert.equal(blockReason('/usr/local/bin/git filter-branch --tree-filter x'), REASON_FILTER_BRANCH);
  assert.equal(blockReason('/usr/local/bin/gh pr create --draft --title x'), '');
  assert.equal(blockReason('/usr/local/bin/gh pr merge --auto 406'), '');
  assert.equal(blockReason('echo "/usr/bin/env gh pr merge 1"'), '');
});

// The guard reads only plainly written commands: a gh api call whose jq filter carries an escaped
// quote is ordinary work and passes. This is a command the guard once refused, its names made neutral, and
// refusing it retired the escaped-quote layer; the fixture uses String.raw because a cooked '\"' contains no
// backslash and asserts nothing.
test('ANTI-REGRESSION: the gh api command the escaped-quote layer once refused passes', () => {
  const command = String.raw`cd "/Users/someone/Developer/Claude Code/example-repository/.claude/worktrees/1198" && git branch -m worktree-1198 job/1198 && git log --oneline -1 && (ls node_modules >/dev/null 2>&1 && echo "node_modules present" || echo "need npm ci") && echo "--- board add" && PROJECT_ID=$(gh api graphql -f query='{ user(login:"someone") { projectsV2(first:10) { nodes { id title number } } } }' --jq '.data.user.projectsV2.nodes[] | select(.title | test("Example")) | .id') && echo "project $PROJECT_ID" && ISSUE_ID=$(gh api graphql -f query='{ repository(owner:"someone", name:"example-repository") { issue(number:1198) { id } } }' --jq '.data.repository.issue.id') && gh api graphql -f query="mutation { addProjectV2ItemById(input:{projectId:\"$PROJECT_ID\", contentId:\"$ISSUE_ID\"}) { item { id } } }" --jq '.data.addProjectV2ItemById.item.id' && node scripts/board-move.mjs 1198 Building`;
  assert.equal(blockReason(command), '');
  assert.equal(blockReason(String.raw`gh api graphql -f query='{ viewer { login } }' --jq '.data.viewer.login | "\"" + . + "\""'`), '');
  assert.equal(blockReason(String.raw`git commit -m "quote a \"word\" in the message"`), '');
});

// ── executable names are matched case-insensitively ─────────────────────────
// This Mac's volume is case-insensitive, so `Git` and `GH` run the real binary. Only the name is
// widened: subcommands and flags stay exact (`git COMMIT` and `gh PR` are not commands, `-F` is not
// `-f`). `cd` stays lowercase on purpose: a capitalised `CD` runs /usr/bin/cd in a child process
// and moves nothing, so treating it as a relocation would be the fail-open direction.

test('a capitalised git or gh name is refused exactly as the lowercase form', () => {
  const twins = [
    ['git commit --no-verify', 'GIT commit --no-verify'],
    ['git push --no-verify', 'Git push --no-verify'],
    ['git push --force', 'gIt push --force'],
    ['git push -f', 'Git push -f'],
    ['git filter-branch --tree-filter x', 'GIT filter-branch --tree-filter x'],
    ['gh pr create --title x', 'GH pr create --title x'],
    ['gh pr merge 493', 'Gh pr merge 493'],
    ['/usr/bin/git push --force', '/usr/bin/Git push --force'],
  ];
  for (const [lower, upper] of twins) {
    const reason = blockReason(lower);
    assert.ok(reason, lower);
    assert.equal(blockReason(upper), reason, upper);
  }
  // the escape flags are matched exactly as before: a capitalised name does not loosen them
  assert.equal(blockReason('Git push --force-with-lease'), '');
  assert.equal(blockReason('GH pr create --draft --title x'), '');
  assert.equal(blockReason('GH pr merge --auto 493'), '');
  // the root-checkout rule anchors on the same name; `CD` is not a relocation, so the walk stays put
  const inRoot = { cwd: '/root', isRootCheckout: (dir) => dir === '/root', platform: process.platform };
  assert.equal(blockReason('Git checkout -b job/1188', inRoot), blockReason('git checkout -b job/1188', inRoot));
  assert.ok(blockReason('CD /job && git commit -m wip', inRoot));
  assert.equal(blockReason('cd /job && git commit -m wip', inRoot), '');
});

test('a quoted or prose mention of Git or GH is still data', () => {
  for (const command of [
    'echo "Git push --force"',
    'git commit -m "Git push --force was refused"',
    "grep -rn 'GH pr merge' docs",
    'echo GIT',
  ]) assert.equal(blockReason(command), '', command);
});

// ── heredoc bodies are DATA ──────────────────────────────────────────────────
// Found live: the force-push rule blocked the commit message that documented it. A commit body
// describing `git push --force`, or quoting `--draft`, is prose, not an invocation. A guard that
// fires on writing about itself is friction, not safety.

test('a heredoc commit body mentioning a force push is allowed', () => {
  assert.equal(blockReason("git commit -F - <<'EOF'\nfix: git push --force was allowed\nEOF"), '');
  assert.equal(blockReason("cat <<'EOF'\ngit push --no-verify skips local gates\nEOF"), '');
});

test('a heredoc PR body mentioning --draft does not satisfy the create rule', () => {
  assert.equal(blockReason("gh pr create --title x --body \"$(cat <<'EOF'\nwe now require --draft on every PR\nEOF\n)\""), REASON_CREATE);
});

test('a real invocation AFTER a heredoc is still blocked', () => {
  assert.equal(blockReason("git commit -F - <<'EOF'\nsome message\nEOF\ngit push --force"), REASON_PUSH_FORCE);
});

// deheredoc removes only a real heredoc body: a body starts after the NEXT unquoted newline (POSIX
// XCU 2.7.4), so words after `<<WORD` on the operator line are argv, and a `<<WORD` mention inside
// quoted prose opens no pairing with a later bare `WORD` line.
test('deheredoc removes only a real heredoc body', () => {
  // Same-line argv after the operator survives to the rules.
  const sameLineArgv = [
    ['git commit <<EOF -m x --no-verify\nbody\nEOF', REASON_COMMIT_NO_VERIFY],
    ['git push <<EOF --force\nbody\nEOF', REASON_PUSH_FORCE],
    ['gh pr create <<EOF --title x\nbody mentions --draft\nEOF', REASON_CREATE],
    ["git commit <<'EOF' -m x --no-verify\nbody\nEOF", REASON_COMMIT_NO_VERIFY],
    ['git commit <<-EOF -m x --no-verify\n\tbody\n\tEOF', REASON_COMMIT_NO_VERIFY],
  ];
  for (const [command, reason] of sameLineArgv) assert.equal(blockReason(command), reason, command);

  // A `<<WORD` inside quoted prose opens no pairing, so the live command between the mention and a
  // later bare terminator line reaches the rules.
  const quotedProse = [
    ['echo "docs mention <<EOF"\ngit push --force\nEOF', REASON_PUSH_FORCE],
    ["echo 'docs <<EOF'\ngit push --force\nEOF", REASON_PUSH_FORCE],
    ['echo "line1\n<<EOF"\ngit push --force\nEOF', REASON_PUSH_FORCE],
    // `<<<` is a here-STRING, not a here-document, and opens no pairing either.
    ['cat <<<"EOF"\ngit push --force\nEOF', REASON_PUSH_FORCE],
  ];
  for (const [command, reason] of quotedProse) assert.equal(blockReason(command), reason, command);

  // The body starts at the next UNQUOTED newline. A newline INSIDE a quoted argument on the operator
  // line is argv text, not the end of the operator line, so the flags after it survive to the rules
  // (real bash keeps the --no-verify live here).
  const quotedNewlineArgv = [
    ['git commit <<EOF -m "first\nsecond" --no-verify\nbody\nEOF', REASON_COMMIT_NO_VERIFY],
    ["git commit <<EOF -m 'first\nsecond' --no-verify\nbody\nEOF", REASON_COMMIT_NO_VERIFY],
  ];
  for (const [command, reason] of quotedNewlineArgv) assert.equal(blockReason(command), reason, command);

  // Pinned residual: the operator recogniser does not know shell arithmetic, so `$((1 << 3))` opens
  // a pairing on `3` and a later bare `3` line strips everything between. Pinned as the CURRENT
  // over-strip ALLOW so a future narrowing shows up here as a red test.
  assert.equal(blockReason('echo $((1 << 3))\ngit push --force\n3'), '');
  // Without that terminator line nothing is stripped and the live command still blocks.
  assert.equal(blockReason('echo $((1 << 3))\ngit push --force'), REASON_PUSH_FORCE);

  // Operator-line argv is live: a real `--draft` after the operator satisfies the create rule, and a
  // real `--undo` after it is the ready rule's escape.
  assert.equal(blockReason('gh pr create --title x <<EOF --draft\nbody\nEOF'), '');
  assert.equal(blockReason('gh pr ready 1 <<EOF --undo\nbody\nEOF'), '');
  // Two heredocs on one line: A's body then B's, both inert, even when body B is a bare gated command.
  assert.equal(blockReason('cat <<A <<B\nprose\nA\ngit push --force\nB'), '');

  // Legitimate-heredoc preservation: every shape below is ALLOW and must stay ALLOW.
  const preserved = [
    // unquoted <<EOF prose body
    'cat <<EOF\ngit push --no-verify skips local gates\nEOF',
    // tab-indented <<-EOF
    'git commit -F - <<-EOF\n\tprose --no-verify\n\tEOF',
    // PR body via command substitution
    `gh pr create --draft --title x --body "$(cat <<'EOF'\nwe now require --draft\nEOF\n)"`,
    // heredoc redirected to a file
    "cat > /tmp/x <<'EOF'\ngit push --force\nEOF",
    // operator line with a quoted argument after it
    "git commit -F - <<'EOF' -m 'x'\nprose git push --force\nEOF",
    // apostrophe inside a quoted span before the operator cannot poison quote state
    'echo "it\'s fine" && cat <<EOF\ngit push --force\nEOF',
    // prose mention AND a real heredoc in one command
    'echo "mentions <<EOF" ; git commit -F - <<\'EOF\'\nprose about git push --force\nEOF',
    // two heredocs on one line, both prose
    'cat <<A <<B\nprose git push --force\nA\nprose git push --force\nB',
    // body whose text merely resembles the terminator
    "git commit -F - <<'EOF'\nEOF is the word\nEOF",
    // CRLF line endings still terminate the body (the \\r? tolerance)
    "git commit -F - <<'EOF'\r\nprose git push --force\r\nEOF\r\n",
    // unterminated heredoc strips nothing and stays fail-open on the allowed side
    'cat <<EOF\ngit status',
    // a quoted newline in the message plus a real heredoc: the message is data, the body inert
    "git commit -m \"line1\nline2\" -F - <<'EOF'\nprose about --no-verify\nEOF",
    // a body quoting an escaped quote and a force push is prose
    String.raw`git commit -F - <<'EOF'
prose quoting a \" escape and a git push --force mention
EOF`,
  ];
  for (const command of preserved) assert.equal(blockReason(command), '', command);
});

// ── integration checkout ─────────────────────────────────────────────────────
// The root checkout stays on main; branch work there is refused when the hook says the command
// runs in it. The resolver is injected: git's own answer is exercised in checkout-context.test.mjs.
// Mutation: delete rootCheckoutReason from the segment walk and every refusal below returns ''.
// The walk resolves each hop with node:path, which on Windows yields a drive-letter, backslashed
// path, so the fixture paths are built the same way to match on every platform.

const ROOT = resolve('/Users/z/Claude Code/repo');
const WORKTREES = join(ROOT, '.claude', 'worktrees');
const JOB = join(WORKTREES, '1170');
const isRootCheckout = (dir) => dir === ROOT || (dir.startsWith(`${ROOT}${sep}`) && !dir.startsWith(`${WORKTREES}${sep}`));
const inRoot = { cwd: ROOT, isRootCheckout, platform: process.platform };
const inJob = { cwd: JOB, isRootCheckout, platform: process.platform };
const rootReason = (subcommand) => `git ${subcommand} in the integration checkout: the root stays on main and nothing is branched, switched, or committed there — open a job checkout with git worktree add and run it from there`;

test('ANTI-REGRESSION: branch work in the root checkout is refused; the same call in a worktree passes', () => {
  const branchWork = {
    'git commit -m "wip"': 'commit',
    'Git commit -m "wip"': 'commit',
    'git checkout -b job/1170': 'checkout',
    'git checkout feature': 'checkout',
    'git checkout -- docs/GUIDE.md': 'checkout',
    'git switch -c job/1170': 'switch',
    'git switch feature': 'switch',
    'git branch job/1170': 'branch',
    'git branch -m old new': 'branch',
    'GIT_AUTHOR_NAME=x git commit -m "wip"': 'commit',
    '/usr/bin/git commit -m "wip"': 'commit',
    'npm test && git commit -m "green"': 'commit',
    'git -C src commit -m "wip"': 'commit',
    'cd src && git commit -m "wip"': 'commit',
    'git switch --detach main': 'switch',
    'git checkout -B main origin/main': 'checkout',
    'git checkout main -- docs/GUIDE.md': 'checkout',
    'git merge job/1170': 'merge',
    'git cherry-pick abc123': 'cherry-pick',
    'git revert HEAD': 'revert',
    'git rebase job/1170': 'rebase',
    'git am patch.mbox': 'am',
  };
  for (const [command, subcommand] of Object.entries(branchWork)) {
    assert.equal(blockReason(command, inRoot), rootReason(subcommand), command);
    assert.equal(blockReason(command, inJob), '', command);
  }
  // The rule sits in front of the others, not in place of them.
  assert.equal(blockReason('git commit --no-verify', inJob), REASON_COMMIT_NO_VERIFY);
});

test('pulling main forward, deleting branches, worktree upkeep, and reads pass in the root checkout', () => {
  for (const command of [
    'git pull',
    'git pull --ff-only',
    'git pull --ff-only origin main',
    'git fetch origin',
    'git merge --ff-only origin/main',
    'git switch main',
    'git checkout main',
    'git switch -q main',
    'git checkout -q main',
    'git switch main 2>/dev/null',
    'git checkout main 2>&1',
    'git switch main > /dev/null 2>&1',
    'git switch main &> /dev/null',
    'git switch --no-guess main',
    'git checkout --ignore-other-worktrees main',
    'git switch main && git pull --ff-only',
    'git branch --merged main',
    'git branch --no-merged main',
    'git branch --contains abc123',
    'git branch --list "job/*"',
    'git merge --abort',
    'git rebase --abort',
    'git cherry-pick --quit',
    'git merge-base HEAD main',
    'git merge-base --is-ancestor job/1170 main',
    'git reset --hard origin/main',
    'git branch -d job/1170',
    'git branch -D job/1170',
    'git branch --delete job/1170',
    'git branch',
    'git branch -a',
    'git branch --show-current',
    'git worktree add ../repo.job-1171 -b job/1171',
    'git worktree remove ../repo.job-1170',
    'git worktree prune',
    'git worktree list',
    'git status',
    'git log --oneline -5',
    'git diff',
    'git rev-parse HEAD',
    'echo "git commit -m wip"',
    'grep -rn "git checkout -b" docs',
  ]) {
    assert.equal(blockReason(command, inRoot), '', command);
  }
});

test('the walk follows cd and git -C, quoted paths with spaces included', () => {
  // From the root into a worktree: allowed.
  assert.equal(blockReason(`cd "${JOB}" && git commit -m "wip"`, inRoot), '');
  assert.equal(blockReason('cd .claude/worktrees/1170 && npm test && git commit -m "wip"', inRoot), '');
  assert.equal(blockReason(`git -C "${JOB}" commit -m "wip"`, inRoot), '');
  // A parenthesised cd never relocates (named fail-closed residual): nothing would restore the
  // directory when the subshell closes, so the whole command is judged where it started.
  assert.equal(blockReason(`(cd '${JOB}' && git switch -c x)`, inRoot), rootReason('switch'));
  assert.equal(blockReason(`(cd '${JOB}' && npm test) && git commit -m "wip"`, inRoot), rootReason('commit'));
  // From a worktree back into the root: refused.
  assert.equal(blockReason(`cd "${ROOT}" && git commit -m "wip"`, inJob), rootReason('commit'));
  assert.equal(blockReason('cd ../../.. && git checkout -b x', inJob), rootReason('checkout'));
  assert.equal(blockReason(`git -C "${ROOT}" switch -c x`, inJob), rootReason('switch'));
  assert.equal(blockReason('git -C .. -C ../.. branch x', inJob), rootReason('branch'));
  // A later cd moves again, and an unresolvable hop does not hide a later absolute one.
  assert.equal(blockReason(`cd "${ROOT}" && cd .claude/worktrees/1170 && git commit -m "wip"`, inJob), '');
  assert.equal(blockReason(`cd "$X" && cd "${ROOT}" && git commit -m "wip"`, inJob), rootReason('commit'));
  // A cd inside a heredoc BODY is inert data: the relocation test reads the deheredoc text, so a
  // worktree commit whose message body mentions `cd /tmp` is not judged as if it were in the root.
  assert.equal(blockReason("cat <<'EOF' > notes.txt\ncd /tmp\nEOF\ngit commit -m wip", inJob), '');
});

test('ANTI-REGRESSION: a cd that could have failed keeps the old directory as a candidate', () => {
  // `;`, a newline, and `||` run on after a failed cd, so the root stays in the set and refuses.
  assert.equal(blockReason('cd .claude/worktrees/gone; git commit -m "wip"', inRoot), rootReason('commit'));
  assert.equal(blockReason('cd .claude/worktrees/gone\ngit commit -m "wip"', inRoot), rootReason('commit'));
  assert.equal(blockReason(`cd "${JOB}"; git commit -m "wip"`, inRoot), rootReason('commit'));
  assert.equal(blockReason(`cd "${JOB}" || exit 1; git commit -m "wip"`, inRoot), rootReason('commit'));
  // A pipeline cd moves nothing.
  assert.equal(blockReason(`cd "${JOB}" | cat && git commit -m "wip"`, inRoot), rootReason('commit'));
  // An unknown candidate beside a known root one does not hide it.
  assert.equal(blockReason('cd "$X"; git commit -m "wip"', inRoot), rootReason('commit'));
  // From a worktree the same shapes stay allowed: no candidate is the root.
  assert.equal(blockReason('cd .claude/worktrees/gone; git commit -m "wip"', inJob), '');
  assert.equal(blockReason(`cd "${JOB}" || exit 1; git commit -m "wip"`, inJob), '');
  // `&&` replaces the set, so a cd into a worktree from the root still passes.
  assert.equal(blockReason(`cd "${JOB}" && git commit -m "wip"`, inRoot), '');
});

test('without a checkout context, or at a directory the guard cannot resolve, the rule is not judged', () => {
  assert.equal(blockReason('git commit -m "wip"'), '');
  assert.equal(blockReason('git checkout -b x', undefined), '');
  for (const command of [
    'cd "$JOB" && git commit -m "wip"',
    'cd ~/repo && git commit -m "wip"',
    'cd && git commit -m "wip"',
    'cd - && git commit -m "wip"',
    'git --git-dir=/elsewhere/.git commit -m "wip"',
    'git --work-tree /elsewhere commit -m "wip"',
  ]) {
    assert.equal(blockReason(command, inRoot), '', command);
  }
});

test('the path placeholder carries a real quoted path, spaces and all', () => {
  assert.equal(blockReason(`cd "${ROOT}" && git commit -m "wip"`, inJob), rootReason('commit'));
  assert.equal(blockReason(`git -C "${ROOT}" commit -m "wip"`, inJob), rootReason('commit'));
});

// ── Git Bash paths on Windows ────────────────────────────────────────────────
// Claude Code runs a Bash-tool command on Windows through Git for Windows' bash, whose mount table
// puts each drive at /<letter> and its own install folder at /. The expected paths are written out
// by hand, never derived with node:path. Mutation: drop the drive-path reading and `/c/…` resolves
// to C:\c\…, so the cd into the root from a worktree is allowed.

const WIN_ROOT = 'C:\\Users\\z\\Claude Code\\repo';
const WIN_JOB = 'C:\\Users\\z\\Claude Code\\repo\\.claude\\worktrees\\1170';
const winCheckout = (root, cwd) => ({
  cwd,
  platform: 'win32',
  isRootCheckout: (dir) => dir === root || (dir.startsWith(`${root}\\`) && !dir.startsWith(`${root}\\.claude\\worktrees\\`)),
});

test('ANTI-REGRESSION: on Windows a Git Bash drive path after cd or -C is read as its drive', () => {
  const winJob = winCheckout(WIN_ROOT, WIN_JOB);
  assert.equal(blockReason('cd "/c/Users/z/Claude Code/repo" && git commit -m "wip"', winJob), rootReason('commit'));
  assert.equal(blockReason('git -C "/c/Users/z/Claude Code/repo" switch -c x', winJob), rootReason('switch'));
  assert.equal(blockReason('cd "/C/Users/z/Claude Code/repo" && git commit -m "wip"', winJob), rootReason('commit'));
  const winRoot = winCheckout(WIN_ROOT, WIN_ROOT);
  assert.equal(blockReason('cd "/c/Users/z/Claude Code/repo/.claude/worktrees/1170" && git commit -m "wip"', winRoot), '');
});

test('on Windows a rooted path other than a drive is an unresolved target', () => {
  const root = 'C:\\srv\\repo';
  assert.equal(blockReason('cd /srv/repo && git commit -m "wip"', winCheckout(root, 'C:\\srv\\repo\\.claude\\worktrees\\1170')), '');
  assert.equal(blockReason('cd /srv/repo; git commit -m "wip"', winCheckout(root, root)), rootReason('commit'));
});

test('on macOS and Linux a /c/ folder is judged as the real folder it names', () => {
  const posixCheckout = (root, cwd) => ({
    cwd,
    platform: 'linux',
    isRootCheckout: (dir) => dir === root || (dir.startsWith(`${root}/`) && !dir.startsWith(`${root}/.claude/worktrees/`)),
  });
  const root = '/c/Users/z/repo';
  assert.equal(blockReason('cd /c/Users/z/repo && git commit -m "wip"', posixCheckout(root, `${root}/.claude/worktrees/1170`)), rootReason('commit'));
  assert.equal(blockReason('cd /c/Users/z/repo/.claude/worktrees/1170 && git commit -m "wip"', posixCheckout(root, root)), '');
  assert.equal(blockReason('cd /srv/repo && git commit -m "wip"', posixCheckout('/srv/repo', '/srv/repo/.claude/worktrees/1170')), rootReason('commit'));
});
