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
    /exits 0 only when the pull request has merged, and otherwise exits 1 with its reason as the last line of output/,
    'step 4 must state the exit contract the session relies on',
  );
  assert.match(step[1], /Merged: run `closeout` in the same session/, 'step 4 must still run closeout on merge');
  const rawStep = RESUME.match(/^4\. Watch it land[\s\S]*?(?=^Greptile is metered)/m);
  assert.deepEqual(
    shellBlocks(rawStep[0]).map((block) => block.body),
    ['node scripts/merge-watch.mjs <pr>'],
    'step 4 must carry exactly one fenced block, the committed watch command',
  );
});

// Splits markdown into the blocks a session copies into a shell and the prose around them. A block is a fence tagged
// `sh`, `bash` or `shell` or untagged, or an indented code block: a run of lines indented four spaces or a tab that
// follows a blank line. A fence tagged with any other language is skipped; prose keeps every other line, with each
// block's lines blanked so line numbers still match.
const SHELL_FENCE_TAGS = new Set(['sh', 'bash', 'shell', '']);
const INDENTED = /^(?: {4}|\t)/;

function splitMarkdown(markdown) {
  const blocks = [];
  const prose = [];
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const open = lines[index].match(/^([ \t]*)```(\w*)[ \t]*$/);
    if (open) {
      const close = lines.findIndex((line, at) => at > index && /^[ \t]*```[ \t]*$/.test(line));
      assert.notEqual(close, -1, `the fence opened on line ${index + 1} must close`);
      if (SHELL_FENCE_TAGS.has(open[2])) {
        const body = lines.slice(index + 1, close).map((line) => (line.startsWith(open[1]) ? line.slice(open[1].length) : line));
        blocks.push({ line: index + 1, body: body.join('\n') });
      }
      prose.push(...Array(close - index + 1).fill(''));
      index = close;
    } else if (INDENTED.test(lines[index]) && (index === 0 || !lines[index - 1].trim())) {
      let end = index;
      while (end < lines.length && (INDENTED.test(lines[end]) || !lines[end].trim())) end += 1;
      while (!lines[end - 1].trim()) end -= 1;
      const body = lines.slice(index, end).map((line) => line.replace(INDENTED, ''));
      blocks.push({ line: index + 1, body: body.join('\n') });
      prose.push(...Array(end - index).fill(''));
      index = end - 1;
    } else {
      prose.push(lines[index]);
    }
  }
  return { blocks, prose: prose.join('\n') };
}

function shellBlocks(markdown) {
  return splitMarkdown(markdown).blocks;
}

// Every inline code span in the prose, its line breaks read as spaces; a span never crosses a blank line.
function inlineSpans(prose) {
  const spans = [];
  for (const match of prose.matchAll(/(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?[^`])\1(?!`)/g)) {
    spans.push({ line: prose.slice(0, match.index).split('\n').length, body: match[2].replace(/\n/g, ' ') });
  }
  return spans;
}

// Everything a skill hands a session to run that isolation would refuse: each shell block's refused shapes, and each
// inline code span's too, since a session also runs a command quoted in prose, except brace expansion: spans also
// quote non-shell code such as the Codex `tools.write_stdin({ ... })` call, whose comma inside braces is not a command.
const SPAN_SHAPES = new Set(['command substitution', 'grouped block', 'control structure', 'more than one command']);

function skillShapeFindings(markdown) {
  const { blocks, prose } = splitMarkdown(markdown);
  const findings = [];
  for (const { line, body } of blocks) {
    const shapes = refusedShapes(body);
    if (shapes.length) findings.push({ where: `the block opened on line ${line}`, body, shapes });
  }
  for (const { line, body } of inlineSpans(prose)) {
    const shapes = refusedShapes(body).filter((shape) => SPAN_SHAPES.has(shape));
    if (shapes.length) findings.push({ where: `the inline span on line ${line}`, body, shapes });
  }
  return findings;
}

// The shapes Claude Code's worktree isolation refuses in one block, or [] when the block is one plain command.
// Continuation lines are joined, then quoted text is dropped: single quotes expand nothing, so a `$(` or `\(`
// inside a jq or GraphQL string is text; double quotes still expand `$(` and backticks, so those are caught first.
// Isolation reads a comma anywhere inside a `{...}` span as brace expansion, through quotes and nested brackets alike.
function refusedShapes(block) {
  const text = block.replace(/\\\n/g, ' ');
  const shapes = new Set();
  let residue = '';
  let quote = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote === "'") {
      if (char === "'") quote = '';
    } else if (quote === '"') {
      if (char === '\\') at += 1;
      else if (char === '"') quote = '';
      else if (char === '`' || (char === '$' && text[at + 1] === '(')) shapes.add('command substitution');
    } else if (char === "'" || char === '"') {
      quote = char;
      residue += 'Q';
    } else if (char === '\\') {
      at += 1;
      residue += 'E';
    } else {
      residue += char;
    }
  }
  if (/`|\$\(/.test(residue)) shapes.add('command substitution');
  if (/(?:^|[|;&])\s*[{(]/m.test(residue)) shapes.add('grouped block');
  if (/(?:^|[|;&])\s*(?:while|for|until|if|case)\b/m.test(residue)) shapes.add('control structure');
  if (/;|&&|\|\|/.test(residue) || residue.split('\n').filter((line) => line.trim()).length > 1) {
    shapes.add('more than one command');
  }
  let depth = 0;
  for (const char of text) {
    if (char === '{') depth += 1;
    else if (char === '}') depth = Math.max(depth - 1, 0);
    else if (char === ',' && depth > 0) shapes.add('brace expansion');
  }
  return [...shapes];
}

test('the resume, cross-review and to-issues skills give only command shapes an isolated worktree session accepts', () => {
  for (const name of ['resume', 'cross-review', 'to-issues']) {
    const path = `.agents/skills/${name}/SKILL.md`;
    const markdown = readFileSync(resolve(ROOT, path), 'utf8');
    assert.ok(shellBlocks(markdown).length > 0, `${path} must carry fenced shell blocks to inspect`);
    for (const { where, body, shapes } of skillShapeFindings(markdown)) {
      assert.fail(`${path}, ${where}, must be one plain command, but has ${shapes.join(', ')}:\n${body}`);
    }
  }
});

test('the refused-shape check catches each refused shape and passes quoted jq text', () => {
  const cases = [
    ['echo "$(git branch --show-current)"', ['command substitution']],
    ['echo `date`', ['command substitution']],
    ['{ echo a; } > out', ['grouped block', 'more than one command']],
    ['( cd x )', ['grouped block']],
    ['while :; do sleep 1; done', ['control structure', 'more than one command']],
    ['cat a | if true', ['control structure']],
    ['a && b', ['more than one command']],
    ['a\nb', ['more than one command']],
    ["gh api \\\n  --jq '\"\\(.x) $(y)\"' > out", []],
    [
      "gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){subIssue{number}}}' -f p=X -f c=Y",
      ['brace expansion'],
    ],
    ['gh api graphql -f query=\'query{repository(owner:"a",name:"b"){id}}\'', ['brace expansion']],
    [
      "gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p subIssueId:$c}){subIssue{number}}}' -f p=X -f c=Y",
      [],
    ],
    ['gh api repos/{owner}/{repo}/issues/1', []],
  ];
  for (const [block, shapes] of cases) assert.deepEqual(refusedShapes(block), shapes, block);

  const markdown = [
    'Read the branch with `git branch --show-current`, then',
    'run `cd x && make` or `echo $(date)`, but `jq ".a; .b"` is text.',
    'Nor may a span run `(cd x)` or `while true`.',
    '',
    '    git fetch; git status',
    '',
    '```sh',
    'node scripts/board.mjs',
    '```',
  ].join('\n');
  assert.deepEqual(skillShapeFindings(markdown), [
    { where: 'the block opened on line 5', body: 'git fetch; git status', shapes: ['more than one command'] },
    { where: 'the inline span on line 2', body: 'cd x && make', shapes: ['more than one command'] },
    { where: 'the inline span on line 2', body: 'echo $(date)', shapes: ['command substitution'] },
    { where: 'the inline span on line 3', body: '(cd x)', shapes: ['grouped block'] },
    { where: 'the inline span on line 3', body: 'while true', shapes: ['control structure'] },
  ]);
});

test('the cross-review skill reads the reviewer model and effort from the seat file at run time, never a copy', () => {
  const skill = readFileSync(resolve(ROOT, '.agents/skills/cross-review/SKILL.md'), 'utf8');
  assert.match(
    skill.replace(/\s+/g, ' '),
    /Read the seat's `model` and `model_reasoning_effort` from `\.codex\/agents\/reviewer\.toml`/,
    'cross-review must name the seat file as where the model and effort are read',
  );
  const seat = readFileSync(resolve(ROOT, '.codex/agents/reviewer.toml'), 'utf8');
  for (const key of ['model', 'model_reasoning_effort']) {
    const value = seat.match(new RegExp(`^${key} = "([^"]+)"$`, 'm'))?.[1];
    assert.ok(value, `.codex/agents/reviewer.toml must set ${key}`);
    assert.ok(!skill.includes(value), `cross-review must not copy the reviewer's ${key} value ${value}`);
  }
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
