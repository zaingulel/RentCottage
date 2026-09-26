import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { gitEnvironment, MANIFEST_PATH, readManifest, regionText, verifyManifest } from './factory-sync.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLOSEOUT = readFileSync(resolve(ROOT, '.agents/skills/closeout/SKILL.md'), 'utf8');
const HANDOFF = readFileSync(resolve(ROOT, '.agents/skills/handoff/SKILL.md'), 'utf8');
const RESUME = readFileSync(resolve(ROOT, '.agents/skills/resume/SKILL.md'), 'utf8');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function updateLocalMainStepFive(markdown) {
  const section = markdown.match(/^## Update local main\n([\s\S]*)$/m);
  assert.ok(section, 'Update local main must exist');
  const step = section[1].match(/^5\. Verify local `main`([\s\S]*?)(?=^\S|(?![\s\S]))/m);
  assert.ok(step, 'Update local main step 5 must exist');
  return step[1].replace(/\s+/g, ' ').trim();
}

test('closeout removes the linked job worktree before deleting its branch', () => {
  const match = CLOSEOUT.match(/^5\. \*\*Branch and worktree\.\*\*([\s\S]*?)(?=^6\. \*\*Rulings\.\*\*)/m);
  assert.ok(match, 'closeout step 5 must exist');

  const step = match[1];
  const removeWorktree = step.indexOf('`git worktree remove <path>`');
  const deleteBranch = step.indexOf('`git branch -d job/<issue>`');
  assert.notEqual(removeWorktree, -1, 'step 5 must remove the exact job worktree');
  assert.notEqual(deleteBranch, -1, 'step 5 must ordinarily delete the job branch');
  assert.ok(removeWorktree < deleteBranch, 'step 5 must remove the linked worktree before deleting its branch');
});

test('closeout retains its verifier through job cleanup and stops when the runtime cannot leave', () => {
  const closeoutStep = CLOSEOUT.match(/^5\. \*\*Branch and worktree\.\*\*([\s\S]*?)(?=^6\. \*\*Rulings\.\*\*)/m);
  assert.ok(closeoutStep, 'closeout step 5 must exist');
  const closeoutText = closeoutStep[1].replace(/\s+/g, ' ').trim();
  assert.match(
    closeoutText,
    /if the runtime cannot leave it or ownership is uncertain, retain it, report why, and stop before worktree removal and branch deletion; continue to step 6 and the final report\./i,
  );

  const verifierText = updateLocalMainStepFive(CLOSEOUT);
  assert.match(verifierText, /During resume, .* removed at the end of the same run, after board operations/i);
  assert.match(verifierText, /During closeout, .* retained until closeout step 5's job cleanup has finished, then removed in the same run/i);
});

test('Update local main step 5 excludes later unindented text', () => {
  const lifecycleDecoy = 'During resume, a verifier is removed at the end of the same run, after board operations. During closeout, it is retained until closeout step 5\'s job cleanup has finished, then removed in the same run.';
  const leaks = ['# Later top-level heading', '### Later deeper heading', 'Later bare trailing text'].map((boundary) => {
    const markdown = `## Update local main\n\n5. Verify local \`main\` has no lifecycle contract.\n   This indented continuation remains in step 5.\n${boundary}\n${lifecycleDecoy}\n`;
    return /During resume|During closeout/i.test(updateLocalMainStepFive(markdown));
  });
  assert.deepEqual(leaks, [false, false, false], 'H1, H3+, and bare trailing text must remain outside step 5');
});

test('handoff requires explicit owner authorization before remote publication', () => {
  const handoff = HANDOFF.replace(/\s+/g, ' ').trim();
  const parkingSection = RESUME.match(/^## Parking\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const authorization = handoff.indexOf('**Get publication authorization.**');
  const publication = handoff.indexOf('**Push the branch**');

  assert.notEqual(authorization, -1, 'handoff must name a publication authorization gate');
  assert.notEqual(publication, -1, 'handoff must name the remote publication step');
  assert.ok(authorization < publication, 'handoff must require authorization before remote publication');
  assert.match(
    handoff,
    /A bare `?handoff`? or `?park`? request authorizes only local preparation and the commit\./i,
    'a bare handoff or park request must not authorize publication',
  );
  assert.match(
    handoff,
    /Do not push the branch or create or update a draft pull request until the owner explicitly authorizes those outward actions\./i,
    'the gate must cover both push and draft pull-request mutations',
  );
  assert.match(
    handoff,
    /An invocation that explicitly names both push and draft pull-request publication satisfies this gate\./i,
    'an owner instruction that explicitly names both publication actions must satisfy the gate',
  );

  assert.ok(parkingSection, 'resume must retain a Parking section');
  const parking = parkingSection[1].replace(/\s+/g, ' ').trim();
  assert.doesNotMatch(
    parking,
    /commit what exists, push the branch/i,
    'Parking must not unconditionally shortcut from commit to remote publication',
  );
  assert.match(
    parking,
    /A bare `?handoff`? or `?park`? request does not authorize remote publication\./i,
    'Parking must limit a bare handoff or park request to local work',
  );
  assert.match(
    parking,
    /Follow (?:the )?`?handoff`? skill's explicit publication-authorization gate before pushing the branch or creating or updating a draft pull request\./i,
    'Parking must route both remote actions through the handoff authorization gate',
  );
});

// Independent oracle for the resume skill's parallel-slice route: Git runs its commands verbatim. Recurring cost: one
// disposable repository and about fifteen Git subprocesses. Remove if builders no longer run parallel slices.
test("the resume skill's parallel-slice commands run while the job branch is checked out", () => {
  const fixture = mkdtempSync(join(tmpdir(), 'flowgauge-parallel-slice-'));
  const repository = join(fixture, 'repository');
  const jobWorktree = join(fixture, 'job-1421');
  const sliceWorktree = join(fixture, 'slice-1421-parallel');
  const bullet = RESUME.slice(RESUME.indexOf('- Builders work inside the job worktree')).split(/\n- /)[0];
  const commands = [...bullet.matchAll(/`(git [^`]+)`/g)].map(([, command]) =>
    command.replaceAll('<issue>', '1421').replaceAll('<name>', 'parallel').replaceAll('<path>', sliceWorktree));
  for (const command of commands) assert.doesNotMatch(command, /<[^>]+>/, `unfilled placeholder in \`${command}\``);
  const argvs = commands.map((command) => command.split(/\s+/).slice(1));
  const [add, merge, remove, deleteBranch] = argvs;
  assert.deepEqual(
    argvs.map((argv) => argv.slice(0, argv[0] === 'merge' ? 1 : 2).join(' ')),
    ['worktree add', 'merge', 'worktree remove', 'branch -d'],
    'the parallel-slice route must cut, merge back, remove the worktree and delete the branch, in that order',
  );
  const env = {
    ...gitEnvironment(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    // Force the editor on and make it fail, so the skill's merge command must be non-interactive.
    GIT_MERGE_AUTOEDIT: 'yes',
    GIT_EDITOR: 'false',
    GIT_AUTHOR_NAME: 'Flowgauge Contract Test',
    GIT_AUTHOR_EMAIL: 'contract-test@flowgauge.invalid',
    GIT_COMMITTER_NAME: 'Flowgauge Contract Test',
    GIT_COMMITTER_EMAIL: 'contract-test@flowgauge.invalid',
  };
  const git = (cwd, args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  const ok = (run, what) => assert.equal(run.status, 0, `${what} failed: ${run.stderr}`);
  const commitFile = (cwd, name) => {
    writeFileSync(join(cwd, name), `${name}\n`);
    ok(git(cwd, ['add', name]), `git add ${name}`);
    ok(git(cwd, ['commit', '-q', '-m', name]), `git commit ${name}`);
    return git(cwd, ['rev-parse', 'HEAD']).stdout.trim();
  };

  try {
    ok(git(fixture, ['init', '-q', repository]), 'git init');
    ok(git(repository, ['commit', '-q', '--allow-empty', '-m', 'fixture baseline']), 'baseline commit');
    ok(git(repository, ['worktree', 'add', '-q', '-b', 'job/1421', jobWorktree]), 'job worktree');

    const jobTip = git(jobWorktree, ['rev-parse', 'job/1421']).stdout.trim();
    ok(git(jobWorktree, add), `git ${add.join(' ')}`);
    assert.equal(git(sliceWorktree, ['rev-parse', 'HEAD']).stdout.trim(), jobTip, 'the slice must start at the job tip');

    const sliceCommit = commitFile(sliceWorktree, 'a.txt');
    commitFile(jobWorktree, 'b.txt');

    ok(git(jobWorktree, merge), `git ${merge.join(' ')}`);
    ok(git(jobWorktree, ['merge-base', '--is-ancestor', sliceCommit, 'job/1421']), 'slice commit on job/1421');

    ok(git(jobWorktree, remove), `git ${remove.join(' ')}`);
    ok(git(jobWorktree, deleteBranch), `git ${deleteBranch.join(' ')}`);
    assert.notEqual(
      git(jobWorktree, ['rev-parse', '--verify', '--quiet', 'refs/heads/slice/1421-parallel']).status,
      0,
      'the slice branch must be deleted',
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// Independent oracle for the instruction-order contract. Recurring cost: one disposable repository and eight Git
// subprocesses. Remove if closeout no longer relies on Git refusing deletion of a linked branch.
test('Git permits job branch deletion only after its linked worktree is removed', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'flowgauge-closeout-'));
  const repository = join(fixture, 'repository');
  const worktree = join(fixture, 'job-1350');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Flowgauge Contract Test',
    GIT_AUTHOR_EMAIL: 'contract-test@flowgauge.invalid',
    GIT_COMMITTER_NAME: 'Flowgauge Contract Test',
    GIT_COMMITTER_EMAIL: 'contract-test@flowgauge.invalid',
    // Hostile ambient signing config keeps the command-local `commit.gpgsign=false` override load-bearing.
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'commit.gpgSign',
    GIT_CONFIG_VALUE_0: 'true',
    GIT_CONFIG_KEY_1: 'gpg.format',
    GIT_CONFIG_VALUE_1: 'openpgp',
    GIT_CONFIG_KEY_2: 'user.signingKey',
    GIT_CONFIG_VALUE_2: 'flowgauge-contract-test-missing-key',
  };
  const git = (args) => spawnSync('git', args, { cwd: repository, env, encoding: 'utf8' });

  try {
    assert.equal(spawnSync('git', ['init', '-q', repository]).status, 0);
    assert.equal(git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture baseline']).status, 0);
    assert.equal(git(['worktree', 'add', '-q', '-b', 'job/1350', worktree]).status, 0);

    const refused = git(['branch', '-d', 'job/1350']);
    assert.notEqual(refused.status, 0, 'Git must refuse to delete a branch checked out in a linked worktree');
    assert.match(`${refused.stdout}\n${refused.stderr}`, /checked out|worktree/i);

    const normalizedWorktree = realpathSync(worktree);
    const worktreeEntry = new RegExp(`^worktree ${escapeRegExp(normalizedWorktree)}$`, 'm');
    const beforeRemoval = git(['worktree', 'list', '--porcelain']);
    assert.equal(beforeRemoval.status, 0);
    assert.match(beforeRemoval.stdout, worktreeEntry);

    assert.equal(git(['worktree', 'remove', worktree]).status, 0);
    const afterRemoval = git(['worktree', 'list', '--porcelain']);
    assert.equal(afterRemoval.status, 0);
    assert.doesNotMatch(afterRemoval.stdout, worktreeEntry);

    const deleted = git(['branch', '-d', 'job/1350']);
    assert.equal(deleted.status, 0, deleted.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('card size is judged by the owner and epics are never picked', () => {
  // These assertions come from card #1398's acceptance criteria.
  const read = (path) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\s+/g, ' ');
  const toIssues = read('.agents/skills/to-issues/SKILL.md');
  const resume = RESUME.replace(/\s+/g, ' ');

  assert.match(
    toIssues,
    /more than five distinct outcome or invariant statements, checkbox or bullet, is a signal to make the work a `type:epic` parent with native child slices/,
    'to-issues must flag more than five outcome or invariant statements as an epic signal',
  );
  assert.match(
    toIssues,
    /No later seat stops, replans, splits or refuses work on these signals or on a line count; after work-pick the only split is the plan-time finding/,
    'no later seat may act on the to-issues size signals or a line count',
  );
  assert.match(
    toIssues,
    /one-sentence outcome and its count of outcome or invariant statements, flagging any count above five/,
    'every to-issues proposal must show its outcome and statement count',
  );
  assert.match(
    toIssues,
    /not a proposal the owner has not seen, so a single captured idea is presented here too/,
    'a single captured idea must be presented to the owner too',
  );
  assert.match(
    toIssues,
    /`type:epic` parent holds no acceptance criteria of its own; any whole-journey or end-to-end check becomes its last child, blocked by the others/,
    'an epic must hold no criteria and put its whole-journey check in its last child',
  );
  assert.match(
    toIssues,
    /Never name a builder seat: the plan chooses one per slice/,
    'to-issues routing must never name a builder seat',
  );
  assert.match(
    toIssues,
    /## Required capabilities The planning, review, or specialist capabilities required, provider-neutral; never a builder seat\./,
    'the issue template must never name a builder seat',
  );

  assert.match(
    resume,
    /open `type:epic` parent is never a candidate row; its next unblocked child is, and a child with an open blocker is not offered/,
    'work-pick must offer an epic\'s next unblocked child, never the parent or a blocked child',
  );
  assert.match(
    resume,
    /fragment Card on Issue \{[^}]*parent \{ number \} blockedBy\(first:50\) \{ nodes \{ number state \} \}/,
    'the work-pick Card fragment must read up to GitHub\'s maximum of 50 blockers per card',
  );
  assert.match(
    resume,
    /parent: \\\(if \.parent then "#\\\(\.parent\.number\)" else "none" end\); open blockers: /,
    'the work-pick read must print each card\'s parent and open blockers',
  );
  assert.match(
    resume,
    /\[\.blockedBy\.nodes\[\] \| select\(\.state == "OPEN"\) \| "#\\\(\.number\)"\]/,
    'the work-pick read must keep only open blockers',
  );
  assert.match(
    resume,
    /never split again on a session's own judgment; only the owner starts another split/,
    'resume must leave any further split of a split card to the owner',
  );
  assert.match(
    resume,
    /the session never narrows such a plan inline or merges slices to fit/,
    'resume must never narrow an oversized plan inline',
  );

  assert.match(
    read('.agents/templates/planner-handoff.md'),
    /more than one independently demonstrable outcome goes to the owner as a split proposal under the `resume` skill's Plan section and is never narrowed or finished inline/,
    'the planner handoff must route a multi-outcome card to the owner',
  );

  for (const path of ['.claude/agents/architect.md', '.codex/agents/architect.toml']) {
    assert.match(
      read(path),
      /\*\*build seat\*\*, chosen per builder handoff and stated once when all handoffs share it/,
      `${path} must choose the build seat per builder handoff`,
    );
  }

  assert.match(
    read('.claude/templates/builder-handoff.md'),
    /The stop condition never carries a line count: a builder stops for a file or step the plan did not name, never for size\./,
    'the builder handoff template must forbid a line-count stop',
  );
});

test('the factory never gates on line counts, ends review loops in one more round, and binds approvals to their question', () => {
  // These assertions come from card #1402's acceptance criteria.
  const read = (path) => readFileSync(resolve(ROOT, path), 'utf8').replace(/\s+/g, ' ');
  const builderSeats = [
    '.claude/agents/builder.md',
    '.claude/agents/builder-lite.md',
    '.claude/agents/builder-max.md',
    '.codex/agents/builder.toml',
    '.codex/agents/builder-lite.toml',
    '.codex/agents/builder-max.toml',
  ];
  const architectSeats = ['.claude/agents/architect.md', '.codex/agents/architect.toml'];

  for (const path of [
    'AGENTS.md',
    'CLAUDE.md',
    '.agents/skills/resume/SKILL.md',
    '.agents/skills/to-issues/SKILL.md',
    '.agents/templates/planner-handoff.md',
    '.claude/templates/builder-handoff.md',
    ...architectSeats,
    ...builderSeats,
  ]) {
    assert.doesNotMatch(
      read(path),
      /size envelope|rough line count|roughly doubles|1,500 changed lines/,
      `${path} must not gate work on a line count`,
    );
  }

  const resume = RESUME.replace(/\s+/g, ' ');
  assert.match(
    resume,
    /Commit green work before any stop, handoff, replan or split proposal/,
    'resume must commit green work before any stop',
  );
  assert.match(
    resume,
    /or when that round still does not converge/,
    'resume must bring the owner a review loop that still does not converge',
  );
  assert.match(
    resume,
    /still produce true findings, new or repeated, judge them/,
    'resume must end the review loop on repeated as well as new true findings',
  );
  assert.match(
    resume,
    /If each is bounded and verifiable, run one more round that fixes all of them/,
    'resume must run one more fixing round when findings are bounded and verifiable',
  );
  assert.match(
    resume,
    /Bring the owner the choice, with a recommendation, only when a finding needs an unsettled design, owner judgment or evidence that cannot be bounded/,
    'resume must bring the owner the choice only when a finding needs unsettled design, owner judgment or unbounded evidence',
  );
  assert.doesNotMatch(
    resume,
    /still produce new\s+true findings/,
    'resume must not gate the review loop on new findings alone',
  );

  const agents = read('AGENTS.md');
  assert.match(
    agents,
    /An approval covers only the question it answered/,
    'an approval must be bound to its question',
  );
  assert.match(agents, /never grants approval/, 'memory or a summary must never grant approval');
  assert.match(
    agents,
    /## Compact instructions [^#]*quoted word for word with the question it answered/,
    'the compact instructions must keep each approval with its question',
  );
  assert.doesNotMatch(
    read('CLAUDE.md'),
    /Compact instructions/,
    'CLAUDE.md must not duplicate the compact instructions',
  );
  assert.match(
    agents,
    /reread the owner's latest messages before acting on one/,
    'AGENTS.md must require rereading the owner\'s latest messages before acting on an approval',
  );
  assert.match(
    agents,
    /an approval whose question is no longer in view is asked again/,
    'AGENTS.md must ask again when an approval\'s question is no longer in view',
  );
  assert.match(
    agents,
    /dispatched by its seat name; a generic, default or unnamed role is never dispatched/,
    'AGENTS.md must require dispatch by seat name and forbid a generic, default or unnamed role',
  );

  for (const path of builderSeats) {
    const seat = read(path);
    assert.match(seat, /its line count never stops it/, `${path} must never stop on a line count`);
    assert.match(
      seat,
      /No hook sees a Codex handoff, so this check is yours on both runtimes/,
      `${path} must check its own handoff`,
    );
    assert.match(
      seat,
      /Before any edit, check that the handoff carries every labelled line of/,
      `${path} must check the handoff carries every labelled line before any edit`,
    );
    assert.match(
      seat,
      /from `Slice` to `Stop condition`, each with a value and no `\{\{SLOT\}\}` left/,
      `${path} must require every labelled line from Slice to Stop condition with no {{SLOT}} left`,
    );
    assert.match(
      seat,
      /stop and report which without editing anything/,
      `${path} must stop and report a missing labelled line without editing anything`,
    );
    assert.match(
      seat,
      /A build that needs a file or step the plan did not name stops and reports/,
      `${path} must stop and report when a build needs a file or step the plan did not name`,
    );
  }
  for (const path of architectSeats) {
    const seat = read(path);
    assert.match(seat, /never a line estimate/, `${path} must scope without a line estimate`);
    assert.match(seat, /[Nn]ever propose a split for size/, `${path} must never propose a split for size`);
  }
});

test('a Codex session waits on helpers with one long timeout and the deliver step watches checks with one waiting command', () => {
  const agents = readFileSync(resolve(ROOT, 'AGENTS.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(agents, /calls `wait_agent` with `timeout_ms: 3600000`, the maximum/, 'AGENTS.md must give a Codex session the one-hour helper wait');
  assert.match(agents, /never sleeps and checks in a loop/, 'AGENTS.md must forbid the sleep-then-check loop');
  assert.match(agents, /`\/\/ @exec: \{"yield_time_ms": 3600000\}`/, 'AGENTS.md must run a long Codex command in one exec cell');
  assert.match(agents, /chars: "", yield_time_ms: 300000/, 'AGENTS.md must poll the process inside the cell at the empty-write cap');
  assert.match(agents, /`Bash` with `run_in_background: true`/, 'AGENTS.md must background the same command on Claude Code');
  const resume = RESUME.replace(/\s+/g, ' ');
  const step = resume.match(/4\. Watch it land(.*?)(?= Greptile is metered)/);
  assert.ok(step, 'deliver step 4 must exist');
  assert.doesNotMatch(step[1], /every 30 seconds/, 'step 4 must not read the checks on a timer');
  assert.match(
    step[1],
    /one `exec` cell whose first line is `\/\/ @exec: \{"yield_time_ms": 3600000\}`/,
    'step 4 must run the Codex watch in one exec cell opened by the one-hour pragma',
  );
  assert.match(
    step[1],
    /polls the returned `session_id` with `tools\.write_stdin\(\{ session_id, chars: "", yield_time_ms: 300000 \}\)` until `exit_code` is set/,
    'step 4 must poll the Codex process inside the cell until it exits',
  );
  assert.match(step[1], /`Bash` with `run_in_background: true`/, 'step 4 must background the watch on Claude Code');
  assert.match(
    step[1],
    /stops the moment a check fails, the merge is blocked, or the state is `MERGED`, whichever comes first/,
    'step 4 must keep its stop conditions',
  );
  assert.match(step[1], /Merged: run `closeout` in the same session/, 'step 4 must still run closeout on merge');
  assert.match(watchCommand('7'), /^\s*sleep 30$/m, 'step 4 must wait between reads with sleep');
});

// The gh stub answers the loop's `pr view` and `pr checks` from numbered files, one pair per read, and repeats the
// last pair; it answers the base-branch read and the two required-set `api` reads from the `base`, `branch` and
// `rules` files without counting a read. Each file holds the exit code on line 1 and the body after it. A zero-code
// body is the JSON gh exports, piped through the call's own `--jq` expression with real jq as gh does, or printed raw
// without `--jq`; a non-zero-code body is gh's error message, printed to stderr. The `rules` body holds one JSON page
// per line: a call with `--paginate` gets every page, each a separate jq input as gh applies `--jq` per page, and a
// call without it gets page one only, as the real API answers. It refuses any call missing the flags the command
// relies on, the substituted pull request number, gh's own `{owner}/{repo}` placeholders, or the substituted base
// branch `trunk`.
//
// Price tag: recurring cost is one `sh` per watch scenario, running the skill's own step-4 block against this fake
// gh and real jq in a temporary directory, with no network. Removal condition: retire the harness together with the
// watch command in the resume skill's deliver step 4.
const GH_STUB = `#!/bin/sh
n=$(cat "$GH_STUB_DIR/n")
case "$1 $2" in
  "pr view")
    case " $* " in
      *" --json baseRefName "*) kind=base; want='--json baseRefName' ;;
      *) n=$((n + 1)); echo "$n" > "$GH_STUB_DIR/n"; kind=view; want='--json state,mergeStateStatus' ;;
    esac ;;
  "pr checks") kind=checks; want='--required --json name,bucket' ;;
  "api "*)
    path=; for arg do case "$arg" in repos/*) path=$arg; break ;; esac; done
    case "$path" in *'repos/{owner}/{repo}/'*) ;; *) echo "gh stub: api path without repos/{owner}/{repo}/: $*" >&2; exit 99 ;; esac
    case "$path" in
      */rules/branches/trunk) kind=rules ;;
      */branches/trunk) kind=branch ;;
      *) echo "gh stub: the base branch was not substituted: $*" >&2; exit 99 ;;
    esac ;;
  *) echo "gh stub: unexpected gh $*" >&2; exit 99 ;;
esac
case "$kind" in
  view|checks|base)
    case " $* " in *" $want "*) ;; *) echo "gh stub: $kind called without $want: $*" >&2; exit 99 ;; esac
    case " $* " in *" 7 "*) ;; *) echo "gh stub: <pr> was not substituted: $*" >&2; exit 99 ;; esac ;;
esac
expr=; jq=no; paginate=no; prev=
for arg do [ "$prev" = --jq ] && { expr=$arg; jq=yes; }; [ "$arg" = --paginate ] && paginate=yes; prev=$arg; done
case "$kind" in
  view|checks) f="$GH_STUB_DIR/$kind.$n"; [ -f "$f" ] || f="$GH_STUB_DIR/$kind.last" ;;
  *) f="$GH_STUB_DIR/$kind" ;;
esac
body() { if [ "$kind" = rules ] && [ "$paginate" = no ]; then sed -n 2p "$f"; else tail -n +2 "$f"; fi; }
code=$(head -n 1 "$f")
if [ "$code" -ne 0 ]; then body >&2
elif [ "$jq" = yes ]; then body | jq -r "$expr" || exit 1
else body; fi
exit "$code"
`;
const SLEEP_STUB = '#!/bin/sh\necho 1 >> "$GH_STUB_DIR/sleeps"\nexit 0\n';

function watchCommand(pr) {
  const block = RESUME.match(/^4\. Watch it land[\s\S]*?\n[ \t]*```sh\n([\s\S]*?)\n[ \t]*```/m);
  assert.ok(block, 'deliver step 4 must carry one fenced sh block');
  assert.ok(block[1].includes('<pr>'), 'the block must take the pull request number as <pr>');
  return block[1].replaceAll('<pr>', pr);
}

// The JSON gh exports before `--jq`: `pr view --json` an object of the named fields, `pr checks --json` an array of
// the checks GitHub has created, each with its `name` and `bucket`.
const view = (state, mergeStateStatus) => JSON.stringify({ state, mergeStateStatus });
const checks = (byName) => JSON.stringify(Object.entries(byName).map(([name, bucket]) => ({ name, bucket })));

const OPEN_BLOCKED = [0, view('OPEN', 'BLOCKED')];
const MERGED = { view: [0, view('MERGED', 'CLEAN')], checks: [0, checks({ test: 'pass', 'sweep-scope': 'pass' })] };

// steps: one { view: [code, body], checks: [code, body] } per read; the last step repeats until the command exits.
// The base branch requires `classic` through classic protection and `ruled` through a ruleset; the default union is
// split across the two sources so dropping either read shows. The rules come as two pages, the ruleset's checks on
// page two so reading page one alone shows; `extraRules` joins page two. `branch` or `rules` replaces that read's
// [code, body].
function runWatchCommand(steps, { classic = ['test'], ruled = ['sweep-scope'], extraRules = [], branch, rules } = {}) {
  assert.equal(
    spawnSync('sh', ['-c', 'command -v jq']).status,
    0,
    "jq must be on PATH: the gh stub applies the command's --jq expressions with real jq",
  );
  const dir = mkdtempSync(join(tmpdir(), 'flowgauge-watch-'));
  const write = (name, [code, body]) => writeFileSync(join(dir, name), `${code}\n${body}\n`);
  steps.forEach((s, i) => { write(`view.${i + 1}`, s.view); write(`checks.${i + 1}`, s.checks); });
  write('view.last', steps.at(-1).view);
  write('checks.last', steps.at(-1).checks);
  write('base', [0, JSON.stringify({ baseRefName: 'trunk' })]);
  write('branch', branch ?? [0, JSON.stringify({ protection: { required_status_checks: { contexts: classic } } })]);
  write('rules', rules ?? [0, [
    JSON.stringify([{ type: 'pull_request', parameters: {} }]),
    JSON.stringify([
      { type: 'required_status_checks', parameters: { required_status_checks: ruled.map((context) => ({ context })) } },
      ...extraRules,
    ]),
  ].join('\n')]);
  writeFileSync(join(dir, 'n'), '0');
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 });
  writeFileSync(join(dir, 'sleep'), SLEEP_STUB, { mode: 0o755 });
  const result = spawnSync('sh', ['-c', watchCommand('7')], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_STUB_DIR: dir },
  });
  const reads = Number(readFileSync(join(dir, 'n'), 'utf8'));
  const sleeps = existsSync(join(dir, 'sleeps')) ? readFileSync(join(dir, 'sleeps'), 'utf8').split('\n').length - 1 : 0;
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.signal, null, `the watch command must exit on its own; stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return { ...result, reads, sleeps };
}

test('the watch command exits non-zero the moment gh itself fails', () => {
  const auth = runWatchCommand([{ view: [4, 'To get started with GitHub CLI, please run: gh auth login'], checks: [0, checks({ test: 'pass', 'sweep-scope': 'pass' })] }]);
  assert.notEqual(auth.status, 0, 'an authentication failure must stop the wait');
  assert.equal(auth.reads, 1, 'an authentication failure must stop on the first read');
  assert.match(auth.stderr, /gh auth login/, 'the gh error must reach the session');

  const network = runWatchCommand([
    { view: OPEN_BLOCKED, checks: [0, checks({ test: 'pending', 'sweep-scope': 'pending' })] },
    { view: OPEN_BLOCKED, checks: [1, 'error connecting to api.github.com'] },
  ]);
  assert.equal(network.status, 1, 'a network failure while reading checks must stop the wait');
  assert.equal(network.reads, 2);
  assert.match(network.stdout, /error connecting to api\.github\.com/, 'the gh error must be printed as the reason');
});

test('the watch command stops on a failed required check, a dirty or behind merge, or a closed pull request, even while checks are pending', () => {
  const failed = runWatchCommand([{ view: OPEN_BLOCKED, checks: [0, checks({ test: 'fail', 'sweep-scope': 'pending' })] }, MERGED]);
  assert.equal(failed.status, 1);
  assert.equal(failed.reads, 1, 'a failed check must stop before the next read');
  assert.match(failed.stdout, /a required check failed/);

  for (const status of ['DIRTY', 'BEHIND']) {
    const blocked = runWatchCommand([{ view: [0, view('OPEN', status)], checks: [0, checks({ test: 'pending', 'sweep-scope': 'pending' })] }, MERGED]);
    assert.equal(blocked.status, 1, `${status} must stop the wait`);
    assert.equal(blocked.reads, 1, `${status} must stop before the next read`);
    assert.match(blocked.stdout, new RegExp(`merge blocked: OPEN ${status}`));
  }

  const closed = runWatchCommand([{ view: [0, view('CLOSED', 'CLEAN')], checks: [0, checks({ test: 'pass', 'sweep-scope': 'pass' })] }]);
  assert.equal(closed.status, 1, 'a closed pull request must stop the wait');
  assert.match(closed.stdout, /closed without merging/);
});

test('the watch command keeps waiting through BLOCKED while required checks are pending or unreported, and stops on BLOCKED once they have all finished', () => {
  const pending = runWatchCommand([
    { view: OPEN_BLOCKED, checks: [0, checks({ test: 'pending', 'sweep-scope': 'pass' })] },
    { view: OPEN_BLOCKED, checks: [0, checks({ test: 'pending', 'sweep-scope': 'pass' })] },
    MERGED,
  ]);
  assert.equal(pending.status, 0, 'BLOCKED with a pending required check must not stop the wait');
  assert.equal(pending.reads, 3, 'the wait must read again after each pending pass');
  assert.equal(pending.sleeps, 2, 'the wait must sleep between reads');

  const unreported = runWatchCommand([
    { view: OPEN_BLOCKED, checks: [1, "no required checks reported on the 'job/7' branch"] },
    { view: OPEN_BLOCKED, checks: [1, "no checks reported on the 'job/7' branch"] },
    MERGED,
  ]);
  assert.equal(unreported.status, 0, 'a required check not yet reported must not stop the wait');
  assert.equal(unreported.reads, 3);

  const finished = runWatchCommand([{ view: OPEN_BLOCKED, checks: [0, checks({ test: 'pass', 'sweep-scope': 'skipping' })] }, MERGED]);
  assert.equal(finished.status, 1, 'BLOCKED with every required check finished must stop the wait');
  assert.equal(finished.reads, 1);
  assert.match(finished.stdout, /merge blocked with every required check finished/);
});

test('the watch command keeps waiting through BLOCKED while a required check from either source has not yet appeared', () => {
  for (const partial of [{ 'sweep-scope': 'pass' }, { test: 'pass' }]) {
    const waiting = runWatchCommand([
      { view: OPEN_BLOCKED, checks: [0, checks(partial)] },
      { view: OPEN_BLOCKED, checks: [0, checks({ 'sweep-scope': 'pass', test: 'pending' })] },
      MERGED,
    ]);
    assert.equal(waiting.status, 0, `BLOCKED with only ${Object.keys(partial)} reported must not stop the wait`);
    assert.equal(waiting.reads, 3);
    assert.equal(waiting.sleeps, 2);
    assert.match(waiting.stdout, /^merged$/m);
  }
});

test('the watch command exits non-zero when the required set cannot be read', () => {
  const unreadable = runWatchCommand([MERGED], { branch: [1, 'gh: Resource not accessible by integration (HTTP 403)'] });
  assert.notEqual(unreadable.status, 0, 'an unreadable required set must stop the wait');
  assert.equal(unreadable.reads, 0, 'an unreadable required set must stop before the first read');
  assert.match(`${unreadable.stdout}${unreadable.stderr}`, /HTTP 403/, 'the gh error must reach the session');
});

test('the watch command stops before its first read when a ruleset requires checks it does not name', () => {
  for (const rule of [
    { type: 'workflows', parameters: { workflows: [{ path: '.github/workflows/<workflow>.yml', repository_id: 1 }] } },
    { type: 'code_scanning', parameters: { code_scanning_tools: [{ tool: 'CodeQL', security_alerts_threshold: 'high_or_higher', alerts_threshold: 'errors' }] } },
  ]) {
    const unnamed = runWatchCommand([MERGED], { extraRules: [rule] });
    assert.equal(unnamed.status, 1, `a ${rule.type} rule must stop the wait`);
    assert.equal(unnamed.reads, 0, `a ${rule.type} rule must stop before the first read`);
    assert.match(unnamed.stdout, /a ruleset requires checks it does not name/);
  }
});

test('the watch command stops on BLOCKED at once when the base branch requires no checks', () => {
  const none = runWatchCommand(
    [{ view: OPEN_BLOCKED, checks: [1, "no required checks reported on the 'job/7' branch"] }],
    { classic: [], ruled: [] },
  );
  assert.equal(none.status, 1);
  assert.equal(none.reads, 1);
  assert.match(none.stdout, /merge blocked with every required check finished/);
});

test('the watch command exits 0 only on MERGED', () => {
  const merged = runWatchCommand([{ view: OPEN_BLOCKED, checks: [0, checks({ test: 'pending', 'sweep-scope': 'pending' })] }, MERGED]);
  assert.equal(merged.status, 0);
  assert.equal(merged.reads, 2);
  assert.match(merged.stdout, /^merged$/m);

  const pending = runWatchCommand([{ view: [0, view('MERGED', 'UNKNOWN')], checks: [0, checks({ test: 'pending', 'sweep-scope': 'pending' })] }]);
  assert.equal(pending.status, 0, 'MERGED must end the wait even while a required check is pending');
  assert.equal(pending.reads, 1);
  assert.match(pending.stdout, /^merged$/m);
});

test('the manual carries one shared workflow region followed by the product headings and tables', () => {
  const manual = readFileSync(resolve(ROOT, 'AGENTS.md'), 'utf8');
  const start = '<!-- factory-shared:start -->';
  const end = '<!-- factory-shared:end -->';
  assert.equal(manual.split(start).length - 1, 1, 'AGENTS.md must carry exactly one shared-region start marker');
  assert.equal(manual.split(end).length - 1, 1, 'AGENTS.md must carry exactly one shared-region end marker');
  const startAt = manual.indexOf(start);
  const endAt = manual.indexOf(end);
  assert.ok(startAt < endAt, 'the shared-region start marker must precede its end marker');

  const shared = manual.slice(startAt, endAt);
  for (const word of ['Flowgauge', 'index.html', 'validate-math', 'Monte Carlo', 'Jira']) {
    assert.ok(!shared.includes(word), `the shared region must not name the product term ${word}`);
  }

  const product = manual.slice(endAt);
  const headings = ['Product', 'Hard constraints', 'Architecture seams', 'Grounding', 'Surfaces', 'Conventions'];
  assert.deepEqual(
    [...product.matchAll(/^## (.*)$/gm)].map((match) => match[1]),
    headings,
    `the shared region must be followed by exactly the product headings ${headings.join(', ')}, in order`,
  );

  const section = (heading) => product.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))[1];
  const tables = {
    Surfaces: ['plan-first', 'owner-directed', 'sign-off', 'security review'],
    Conventions: ['generated artifacts', 'visual verification', 'fixtures', 'documentation routines'],
  };
  for (const [heading, rows] of Object.entries(tables)) {
    const firstCells = section(heading)
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .slice(2)
      .map((line) => line.split('|')[1].trim());
    assert.deepEqual(firstCells, rows, `## ${heading} must carry exactly the rows ${rows.join(', ')}, in order`);
  }

  const surfaces = section('Surfaces').split('\n');
  const guaranteesAt = surfaces.indexOf('The standing security guarantees, in order of blast radius:');
  assert.notEqual(guaranteesAt, -1, '## Surfaces must carry the line introducing the standing security guarantees');
  assert.ok(
    surfaces.slice(guaranteesAt + 1).find((line) => line.trim())?.startsWith('1. '),
    'the standing security guarantees must start with a numbered item 1.',
  );
  const securityRow = surfaces.find((line) => line.startsWith('|') && line.split('|')[1].trim() === 'security review');
  const targets = [...securityRow.split('|')[2].matchAll(/\]\(([^)#\s]+)[^)]*\)/g)].map((match) => match[1]);
  assert.ok(targets.length > 0, 'the security review row must link the privacy documents');
  for (const target of targets) {
    assert.ok(existsSync(resolve(ROOT, target)), `the security review row links ${target}, which does not exist`);
  }

  assert.ok(Buffer.byteLength(manual) < 32768, 'AGENTS.md must stay under the 32 KiB Codex read cap');
});

const FIXED_PRODUCT_DOCUMENTS = [
  'CONTEXT.md',
  'docs/README.md',
  'docs/CODING-STANDARDS.md',
  'docs/TESTING-STRATEGY.md',
  'docs/ISSUE-TRACKER.md',
  'docs/DOC-SWEEP.md',
  'docs/SWEEP-TRIAGE.md',
];

test('the seven fixed product documents exist', () => {
  const missing = FIXED_PRODUCT_DOCUMENTS.filter((path) => !existsSync(resolve(ROOT, path)));
  assert.deepEqual(missing, [], `the shared workflow points at these fixed product documents, which are missing: ${missing.join(', ')}`);
});

test('the testing strategy carries the shared construction-mode and mutation rules verbatim', () => {
  const strategy = readFileSync(resolve(ROOT, 'docs/TESTING-STRATEGY.md'), 'utf8').replace(/\s+/g, ' ');
  const rules = [
    'Subject matter sets the minimum mode; change shape cannot lower that floor.',
    'The builder follows the handed-off mode and cannot reinterpret or downgrade it.',
    'An asserted-but-unexecuted mutation is a review finding.',
  ];
  const missing = rules.filter((rule) => !strategy.includes(rule));
  assert.deepEqual(missing, [], `docs/TESTING-STRATEGY.md is missing these shared rules: ${missing.map((rule) => JSON.stringify(rule)).join(', ')}`);
});

// Runs the real prepare script in a fresh repository holding a copy of package.json. The environment drops git's
// repository-scoped variables, so an inherited GIT_DIR cannot aim the script at this repository, keeps npm's log
// inside the temporary repository and skips npm's update check, so nothing outside that repository changes.
test('npm install activates the git hooks through the prepare script', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-prepare-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...gitEnvironment(), npm_config_logs_dir: join(root, '.npm-logs'), npm_config_update_notifier: 'false' };
  const run = (command, ...args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', env });
  assert.equal(run('git', 'init', '-q').status, 0);
  cpSync(resolve(ROOT, 'package.json'), join(root, 'package.json'));
  const prepare = run('npm', 'run', 'prepare');
  assert.equal(prepare.status, 0, prepare.stderr);
  assert.equal(
    run('git', 'config', '--get', 'core.hooksPath').stdout.trim(),
    '.githooks',
    'package.json scripts.prepare does not set core.hooksPath to .githooks, so `npm install` would not activate the git hooks',
  );
});

test('the review line has one specified format, and the template and skills point at it', () => {
  // Hand-written from the owner-approved format and slot, never extracted from a repo file, so
  // a drift in the manual's example or the template cannot silently redefine what the test accepts.
  const REVIEW_LINE =
    /^Review: tier=(document|code|sign-off) rounds=([1-9]\d*) raised=(0|[1-9]\d*) fixed=(0|[1-9]\d*) dismissed=(0|[1-9]\d*) deferred=(0|[1-9]\d*) greptile_rounds=(0|[1-9]\d*) greptile_raised=(0|[1-9]\d*) greptile_true=(0|[1-9]\d*)\s*$/;
  const REVIEW_SLOT =
    'Review: tier= rounds= raised= fixed= dismissed= deferred= greptile_rounds= greptile_raised= greptile_true=';
  const assertValidLine = (line, where) => {
    const m = REVIEW_LINE.exec(line ?? '');
    assert.ok(m, `${where}: example review line ${JSON.stringify(line)} no longer matches the approved format`);
    const [rounds, raised, fixed, dismissed, deferred, gRounds, gRaised, gTrue] = m.slice(2).map(Number);
    assert.equal(
      raised,
      fixed + dismissed + deferred,
      `${where}: example review line has raised not equal to fixed plus dismissed plus deferred`,
    );
    assert.ok(gRounds <= rounds, `${where}: example review line has greptile_rounds greater than rounds`);
    assert.ok(gRaised <= raised, `${where}: example review line has greptile_raised greater than raised`);
    assert.ok(gTrue <= gRaised, `${where}: example review line has greptile_true greater than greptile_raised`);
    assert.ok(
      gTrue <= fixed + deferred,
      `${where}: example review line has greptile_true greater than fixed plus deferred`,
    );
    assert.ok(
      gRaised - gTrue <= dismissed,
      `${where}: example review line has more false Greptile findings than dismissed`,
    );
    assert.ok(
      gRounds > 0 || gRaised === 0,
      `${where}: example review line has Greptile findings but greptile_rounds=0`,
    );
  };

  const PREFIX = 'Review: tier=sign-off rounds=7 raised=16 fixed=13 dismissed=2 deferred=1';
  assertValidLine(`${PREFIX} greptile_rounds=0 greptile_raised=0 greptile_true=0`, 'no-Greptile fixture');
  for (const [broken, message] of [
    [`${PREFIX} greptile_rounds=8 greptile_raised=1 greptile_true=1`, /greptile_rounds greater than rounds/],
    [`${PREFIX} greptile_rounds=2 greptile_raised=17 greptile_true=1`, /greptile_raised greater than raised/],
    [`${PREFIX} greptile_rounds=2 greptile_raised=1 greptile_true=2`, /greptile_true greater than greptile_raised/],
    [`${PREFIX} greptile_rounds=0 greptile_raised=1 greptile_true=0`, /Greptile findings but greptile_rounds=0/],
    [
      'Review: tier=sign-off rounds=2 raised=1 fixed=0 dismissed=1 deferred=0 greptile_rounds=1 greptile_raised=1 greptile_true=1',
      /greptile_true greater than fixed plus deferred/,
    ],
    [
      'Review: tier=sign-off rounds=2 raised=1 fixed=1 dismissed=0 deferred=0 greptile_rounds=1 greptile_raised=1 greptile_true=0',
      /more false Greptile findings than dismissed/,
    ],
  ]) {
    assert.throws(() => assertValidLine(broken, 'fixture'), message, `${broken} was accepted`);
  }

  const manual = readFileSync(resolve(ROOT, 'docs/AI-WORKFLOW.md'), 'utf8').split('\n');
  const heading = manual.indexOf('## The review line');
  assert.ok(heading >= 0, 'docs/AI-WORKFLOW.md lost its "## The review line" section');
  const next = manual.findIndex((l, i) => i > heading && l.startsWith('## '));
  const section = manual.slice(heading, next === -1 ? undefined : next);
  const fence = section.indexOf('```');
  assert.ok(fence >= 0, 'the review line section in docs/AI-WORKFLOW.md lost its fenced example');
  assertValidLine(section[fence + 1], 'docs/AI-WORKFLOW.md');

  const template = readFileSync(resolve(ROOT, '.github/pull_request_template.md'), 'utf8');
  assertValidLine(/for example `([^`]*)`/.exec(template)?.[1], '.github/pull_request_template.md');
  assert.deepEqual(
    template.split('\n').filter((l) => REVIEW_LINE.test(l)),
    [],
    'the pull request template has a line a parser would read as a real review line',
  );
  assert.equal(
    template.split('\n').filter((l) => l.trimEnd() === REVIEW_SLOT).length,
    1,
    `the pull request template's review line slot "${REVIEW_SLOT}" is missing, duplicated or reshaped`,
  );
  assert.ok(
    template.includes('docs/AI-WORKFLOW.md'),
    'the pull request template no longer names docs/AI-WORKFLOW.md for the review line format',
  );

  for (const skill of ['.agents/skills/resume/SKILL.md', '.agents/skills/closeout/SKILL.md']) {
    assert.ok(
      readFileSync(resolve(ROOT, skill), 'utf8').includes('docs/AI-WORKFLOW.md#the-review-line'),
      `${skill} no longer links to docs/AI-WORKFLOW.md#the-review-line`,
    );
  }
});

test('every manifest entry matches the file on disk', () => {
  const { canonical } = readManifest(ROOT);
  const mismatches = verifyManifest(ROOT);
  assert.equal(
    mismatches.length,
    0,
    [
      'These shared workflow files differ from .agents/factory-manifest.json:',
      ...mismatches.map(({ path, expected, actual }) => `  ${path}: recorded ${expected}, found ${actual}`),
      `In an adopter repository, undo the local edit, make the change in the canonical repository (${canonical}), then re-sync with \`node scripts/factory-sync.mjs --from <canonical checkout>\`.`,
      'In the canonical repository, record an intended change with `node scripts/factory-sync.mjs --write`.',
    ].join('\n'),
  );
});

// Each tracked path under the given directories with its git index mode.
function indexEntries(...directories) {
  const listed = spawnSync('git', ['ls-files', '-s', '--', ...directories], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  return listed.stdout.split('\n').filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    return { mode: meta.split(' ')[0], path };
  });
}

// A symlink does not survive a Windows checkout without developer mode, so every installed skill is a real copy
// that must stay byte-identical to the file it copies.
test('skill copies are byte-identical to their sources and no skill is a symlink', () => {
  const entries = indexEntries('.agents/skills', '.claude/skills', '.agents/upstream');
  const problems = entries
    .filter(({ mode, path }) => mode === '120000' && /^\.(?:agents|claude)\/skills\//.test(path))
    .map(({ path }) => `${path} is a symlink`);
  const under = (prefix) =>
    new Set(entries.filter(({ mode, path }) => mode !== '120000' && path.startsWith(prefix)).map(({ path }) => path.slice(prefix.length)));
  const compare = (copies, copyRoot, sources, sourceRoot) => {
    for (const rest of copies) {
      if (!sources.has(rest)) problems.push(`${copyRoot}${rest} has no ${sourceRoot}${rest}`);
      else if (!readFileSync(resolve(ROOT, copyRoot + rest)).equals(readFileSync(resolve(ROOT, sourceRoot + rest)))) {
        problems.push(`${copyRoot}${rest} differs from ${sourceRoot}${rest}`);
      }
    }
  };
  const agents = under('.agents/skills/');
  const claude = under('.claude/skills/');
  compare(claude, '.claude/skills/', agents, '.agents/skills/');
  compare([...agents].filter((rest) => !claude.has(rest)), '.agents/skills/', claude, '.claude/skills/');

  const skillNames = new Set(entries.filter(({ path }) => path.startsWith('.agents/skills/')).map(({ path }) => path.split('/')[2]));
  for (const { path } of entries) {
    const match = /^(\.agents\/upstream\/[^/]+\/)([^/]+)\/SKILL\.md$/.exec(path);
    if (!match || !skillNames.has(match[2])) continue;
    const [, sourceRoot, name] = match;
    const upstream = new Set([...under(sourceRoot)].filter((rest) => rest.startsWith(`${name}/`)));
    const installed = new Set([...agents].filter((rest) => rest.startsWith(`${name}/`)));
    compare(upstream, sourceRoot, installed, '.agents/skills/');
    compare([...installed].filter((rest) => !upstream.has(rest)), '.agents/skills/', upstream, sourceRoot);
  }
  assert.deepEqual(problems, [], 'every skill is a tracked real copy, byte-identical to its source');
});

// gitattributes(5): an `eol=lf` rule overrides core.autocrlf, so a hook keeps its LF shebang line on Windows.
const HOOK_DIRECTORIES = ['.githooks', '.claude/hooks', '.codex/hooks'];
const LF_RULE = '* text eol=lf\n';

test('hook scripts carry the LF rule and the git hooks their run permission', () => {
  const manifest = new Map(readManifest(ROOT).entries.map((entry) => [entry.path, entry]));
  const problems = [];
  for (const directory of HOOK_DIRECTORIES) {
    const tracked = indexEntries(directory);
    const attributes = `${directory}/.gitattributes`;
    if (!tracked.some(({ path }) => path === attributes)) problems.push(`${attributes} is not tracked`);
    else if (readFileSync(resolve(ROOT, attributes), 'utf8') !== LF_RULE) problems.push(`${attributes} is not exactly ${JSON.stringify(LF_RULE)}`);
    if (!manifest.has(attributes)) problems.push(`${attributes} is not a manifest entry`);

    const eol = spawnSync('git', ['ls-files', '--eol', '--', directory], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(eol.status, 0, eol.stderr);
    for (const line of eol.stdout.split('\n').filter(Boolean)) {
      const [meta, path] = line.split('\t');
      if (manifest.has(path) && !meta.startsWith('i/lf ')) problems.push(`${path} is not LF in the index (${meta.trim()})`);
    }
  }
  for (const { mode, path } of indexEntries('.githooks')) {
    if (path === '.githooks/README.md' || path === '.githooks/.gitattributes') continue;
    if (mode !== '100755') problems.push(`${path} has index mode ${mode}, not 100755`);
    if (manifest.get(path)?.executable !== true) problems.push(`${path} manifest entry lacks executable: true`);
  }
  assert.deepEqual(problems, [], 'every hook directory checks out LF and every git hook runs');
});

// Every shared workflow file the manifest pins, and the AGENTS.md shared region, reaches every adopter byte for
// byte, so none may name a product fact. The vendored upstream skills and their installed copies are never edited
// in place, and this file must name the tokens it forbids.
const VENDORED_SKILLS = new Set(
  indexEntries('.agents/upstream').flatMap(({ path }) => /^\.agents\/upstream\/[^/]+\/([^/]+)\/SKILL\.md$/.exec(path)?.slice(1) ?? []),
);
const vendoredCopy = (path) =>
  path.startsWith('.agents/upstream/') || VENDORED_SKILLS.has(/^\.(?:agents|claude)\/skills\/([^/]+)\//.exec(path)?.[1]);
const TOKEN_SCAN_EXEMPT = (path) =>
  vendoredCopy(path) || path === '.agents/factory-manifest.json' || path === 'scripts/lib/workflow-contract.test.mjs';
const PRODUCT_TOKENS = [
  'Flowgauge',
  'flow-metrics-dashboard',
  'RentCottage',
  'Cottage',
  'zaingulel',
  'index.html',
  'build-concat',
  'validate-math',
  'Monte Carlo',
  'Jira',
  'Supabase',
  'Next.js',
  'Cloudflare',
  'Row Level Security',
  'Atlassian',
];

test('shared workflow files name no product of any adopter', () => {
  const hits = [];
  for (const entry of readManifest(ROOT).entries) {
    const { path } = entry;
    if (TOKEN_SCAN_EXEMPT(path)) continue;
    const text = readFileSync(resolve(ROOT, path), 'utf8');
    const [scanned, where] = 'region' in entry ? [regionText(text, path), `${path} shared region line `] : [text, `${path}:`];
    scanned.split('\n').forEach((line, index) => {
      for (const token of PRODUCT_TOKENS) {
        if (line.toLowerCase().includes(token.toLowerCase())) hits.push(`${where}${index + 1} names ${token}`);
      }
    });
  }
  assert.deepEqual(hits, [], 'shared workflow files must point at the product tables and documents instead');
});

// Paths outside the manifest that shared code or prose names in every adopter, each with the reason it may.
const ADOPTER_PATHS = {
  [MANIFEST_PATH]: 'the manifest itself, which lists every shared file but not its own path',
  'package.json': 'the npm scripts every adopter defines and the shared hooks and tests run',
  'src/': 'the product source root every adopter keeps',
  'scripts/lib/board-config.mjs': 'the product board configuration the shared board scripts load',
  'scripts/doc-lint.mjs': 'the doc lint command every adopter runs',
  'scripts/lib/doc-lint.mjs': 'the doc lint core the shared citation and link scans run beside',
  'scripts/lib/doc-lint.test.mjs': 'the doc lint core\'s own test, which every adopter carries with the doc lint',
  '.codex/rules/playwright.rules': 'the Codex rule that prompts before a browser run, which every adopter carries',
  'scripts/gates/': 'optional product hook point, checked for presence',
  'scripts/gates/stop': 'optional product hook point, checked for presence',
  'scripts/gates/pre-commit': 'optional product hook point, checked for presence',
};
const PATH_TOKEN = /[A-Za-z0-9_.@/*<>{}|$-]+/g;
const PLACEHOLDER = /[*<>{}|$]/;
const FILE_EXTENSION = /\.(?:md|mjs|js|ts|json|jsonc|ya?ml|toml|sh|html|css|txt|csv)$/;
// A `join(` or `resolve(` call's run of string literals after its leading identifier arguments: one path in pieces.
const JOINED_LITERALS =
  /\b(?:join|resolve)\(\s*(?:[A-Za-z_$][\w$.]*\s*,\s*)*((?:'[^'\n]*'|"[^"\n]*")(?:\s*,\s*(?:'[^'\n]*'|"[^"\n]*"))*)/g;
const STRING_LITERAL = /'([^'\n]*)'|"([^"\n]*)"/g;
const RELATIVE_SEGMENT = /(?:^|\/)\.\.?(?:\/|$)/;

// Each path with every ancestor directory, a directory written with a trailing slash.
const withAncestors = (paths) =>
  new Set(paths.flatMap((path) => {
    const parts = path.split('/');
    return [path, ...parts.slice(1).map((_, index) => `${parts.slice(0, index + 1).join('/')}/`)];
  }));

// A shared file reaches every adopter byte for byte, so a path it names must exist there too. A token that is
// no path of this repository is a fixture or a placeholder; one that is, and is neither shared nor a declared
// adopter path, exists only here.
test('no shared file names a path only this repository has', () => {
  const listed = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const tracked = withAncestors(listed.stdout.split('\n').filter(Boolean));
  const { entries } = readManifest(ROOT);
  const allowed = withAncestors([
    ...entries.map(({ path }) => path),
    ...FIXED_PRODUCT_DOCUMENTS,
    'AGENTS.md',
    ...Object.keys(ADOPTER_PATHS),
  ]);

  const hits = [];
  for (const entry of entries) {
    const { path } = entry;
    // Vendored skills and their copies are replaced whole and never edited, so the product-name test skips them too.
    if (vendoredCopy(path)) continue;
    let text = readFileSync(resolve(ROOT, path), 'utf8');
    if ('region' in entry) text = regionText(text, path);
    // This file's forbidden-word lists, each opening with the product name, must spell a file name they forbid.
    if (path === 'scripts/lib/workflow-contract.test.mjs') text = text.replace(/\[\s*'Flowgauge',[^\]]*\]/g, '');
    const joined = [...text.matchAll(JOINED_LITERALS)].map(([, run]) =>
      [...run.matchAll(STRING_LITERAL)].map(([, single, double]) => single ?? double).join('/'));
    const named = new Set();
    for (const raw of [...(text.match(PATH_TOKEN) ?? []), ...joined]) {
      if (PLACEHOLDER.test(raw)) continue;
      // Trailing dots are sentence punctuation, except in a token that ends at a parent-directory segment.
      const token = /(?:^|\/)\.\.$/.test(raw) ? raw : raw.replace(/\.+$/, '');
      if (!token.includes('/') && !FILE_EXTENSION.test(token)) continue;
      // A relative token is read both from the repository root and from the shared file's own directory; one that
      // escapes the root, or names the root itself, names nothing here.
      const fromFile = RELATIVE_SEGMENT.test(token) ? posix.normalize(posix.join(posix.dirname(path), token)) : null;
      for (const candidate of [posix.normalize(token), fromFile]) {
        if (candidate === null || candidate === '.' || candidate === '..' || candidate.startsWith('../')) continue;
        const found = tracked.has(candidate) ? candidate : tracked.has(`${candidate}/`) ? `${candidate}/` : null;
        if (found && !allowed.has(found)) named.add(found);
      }
    }
    for (const token of named) hits.push(`${path}: ${token}`);
  }
  assert.deepEqual(
    hits,
    [],
    'shared files name paths only this repository has; move each such check into a product-owned test the manifest does not list, or name the path neutrally (a placeholder, a glob, or a path no adopter has)',
  );
});
