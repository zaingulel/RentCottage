// merge-watch.test.mjs — the merge watch's exit contract and required-check rules, through the fake-gh seam.
//
// Polling scenarios run the command's `main` in-process with the real `runGh`, so every call reaches the fake `gh`
// through `BOARD_TOOLKIT_GH`, and a recording sleep that returns at once; the argument contract and single-pass
// stops also run the command as a subprocess.
//
// Recurring cost: one Node process per faked `gh` call, a handful per scenario, and no network. Removal condition:
// retire with scripts/merge-watch.mjs.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { installFakeGh } from './fake-gh.mjs';
import { main } from '../merge-watch.mjs';

const CLI = fileURLToPath(new URL('../merge-watch.mjs', import.meta.url));
const USAGE = 'usage: node scripts/merge-watch.mjs <pull-request-number>';

// The fake answers from the scenario directory named by MERGE_WATCH_SCENARIO and logs every call's argv as one JSON
// line. Each loop pass's `pr view` advances to the next step and its `pr checks` answers from the same step; the last
// step repeats. A reply is [exit code, body]: a zero-code body is the JSON gh exports, printed to stdout, and a
// non-zero-code body is gh's error, printed to stderr. The rules reply holds one JSON page per array element: with
// `--paginate` gh fetches every page and, without `--slurp`, prints them back to back; without `--paginate` the API
// answers page one only. It refuses (exit 99) any call without the pull request number 7, the flags the command
// relies on, gh's own `{owner}/{repo}` placeholders, or the base branch `trunk`, and it applies no `--jq`.
const fakeGh = installFakeGh('merge-watch-', `
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const dir = process.env.MERGE_WATCH_SCENARIO;
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls'), JSON.stringify(args) + '\\n');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const refuse = (why) => { process.stderr.write('fake gh: ' + why + ': ' + args.join(' ') + '\\n'); process.exit(99); };
const answer = ([code, body]) => {
  if (code === 0) process.stdout.write(body + '\\n'); else process.stderr.write(body + '\\n');
  process.exit(code);
};
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (args.includes('--jq')) refuse('the fake applies no --jq');
const step = (n) => scenario.steps[Math.min(n, scenario.steps.length) - 1];
if (args[0] === 'pr') {
  if (!args.includes('7')) refuse('<pr> was not passed');
  if (args[1] === 'view' && flag('--json') === 'baseRefName') answer(scenario.base);
  if (args[1] === 'view' && flag('--json') === 'state,mergeStateStatus') {
    const n = Number(readFileSync(join(dir, 'n'), 'utf8')) + 1;
    writeFileSync(join(dir, 'n'), String(n));
    answer(step(n).view);
  }
  if (args[1] === 'checks' && args.includes('--required') && flag('--json') === 'name,bucket') {
    answer(step(Number(readFileSync(join(dir, 'n'), 'utf8'))).checks);
  }
  refuse('unexpected pr call');
}
if (args[0] === 'api') {
  if (args.includes('rate_limit')) answer([0, JSON.stringify({ resources: { graphql: { limit: 5000, remaining: 5000, reset: 0 } } })]);
  const path = args.find((arg) => arg.startsWith('repos/'));
  if (!path || !path.startsWith('repos/{owner}/{repo}/')) refuse('api path without repos/{owner}/{repo}/');
  if (path === 'repos/{owner}/{repo}/branches/trunk') answer(scenario.branch);
  if (path === 'repos/{owner}/{repo}/rules/branches/trunk') {
    const [code, pages] = scenario.rules;
    if (code !== 0) answer(scenario.rules);
    if (!args.includes('--paginate')) answer([0, JSON.stringify(pages[0])]);
    answer([0, args.includes('--slurp') ? JSON.stringify(pages) : pages.map((page) => JSON.stringify(page)).join('')]);
  }
  refuse('the base branch was not substituted');
}
refuse('unexpected gh call');
`);
after(() => fakeGh.cleanup());

const view = (state, mergeStateStatus) => [0, JSON.stringify({ state, mergeStateStatus })];
const checks = (byName) => [0, JSON.stringify(Object.entries(byName).map(([name, bucket]) => ({ name, bucket })))];

const OPEN_BLOCKED = view('OPEN', 'BLOCKED');
const MERGED = { view: view('MERGED', 'CLEAN'), checks: checks({ test: 'pass', 'sweep-scope': 'pass' }) };

// The base branch requires `classic` through classic protection and `ruled` through a ruleset; the default union is
// split across the two sources so dropping either read shows. The rules come as two pages, the ruleset's checks on
// page two so reading page one alone shows; `extraRules` joins page two. `branch` or `rules` replaces that read's
// reply, and `base` the base-branch read's.
function writeScenario(steps, { classic = ['test'], ruled = ['sweep-scope'], extraRules = [], base, branch, rules } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-watch-scenario-'));
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify({
    steps,
    base: base ?? [0, JSON.stringify({ baseRefName: 'trunk' })],
    branch: branch ?? [0, JSON.stringify({ protection: { required_status_checks: { contexts: classic } } })],
    rules: rules ?? [0, [
      [{ type: 'pull_request', parameters: {} }],
      [
        { type: 'required_status_checks', parameters: { required_status_checks: ruled.map((context) => ({ context })) } },
        ...extraRules,
      ],
    ]],
  }));
  writeFileSync(join(dir, 'n'), '0');
  writeFileSync(join(dir, 'calls'), '');
  return dir;
}

function readCalls(dir) {
  return readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function callKind([group, command, ...rest]) {
  if (group === 'pr' && command === 'view') return rest.includes('baseRefName') ? 'base' : 'view';
  if (group === 'pr' && command === 'checks') return 'checks';
  if (group === 'api' && command === 'rate_limit') return 'rate_limit';
  if (group === 'api') return [command, ...rest].some((arg) => arg.includes('/rules/branches/')) ? 'rules' : 'branch';
  return 'other';
}

// Reads only: `pr view`, `pr checks`, or an `api` GET carrying no method, field or body flag.
function assertReadOnly(calls) {
  const writeFlag = /^(-X|--method|-f|--raw-field|-F|--field|--input)(=|$)|^-[XfF]./;
  for (const call of calls) {
    const [group, command] = call;
    const read = (group === 'pr' && (command === 'view' || command === 'checks'))
      || (group === 'api' && !call.some((arg) => writeFlag.test(arg)));
    assert.ok(read, `the watch must only read GitHub state, but called: gh ${call.join(' ')}`);
  }
}

// Runs the command in-process against the scenario; a sleep past the twentieth means the watch never stopped.
async function watch(steps, options) {
  const dir = writeScenario(steps, options);
  const env = fakeGh.env({ MERGE_WATCH_SCENARIO: dir });
  const saved = { BOARD_TOOLKIT_GH: process.env.BOARD_TOOLKIT_GH, MERGE_WATCH_SCENARIO: process.env.MERGE_WATCH_SCENARIO };
  const lines = [];
  const sleeps = [];
  const output = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
  const sleep = async (ms) => {
    sleeps.push(ms);
    if (sleeps.length > 20) throw new Error('the watch did not stop');
  };
  let status;
  try {
    Object.assign(process.env, { BOARD_TOOLKIT_GH: env.BOARD_TOOLKIT_GH, MERGE_WATCH_SCENARIO: dir });
    status = await main(['7'], { output, sleep });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const calls = readCalls(dir);
  rmSync(dir, { recursive: true, force: true });
  assertReadOnly(calls);
  return { status, lines, last: lines.at(-1), sleeps, calls, reads: calls.filter((call) => callKind(call) === 'view').length };
}

function runCli(args, steps = [MERGED], options) {
  const dir = writeScenario(steps, options);
  const run = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: fakeGh.env({ MERGE_WATCH_SCENARIO: dir }),
  });
  const calls = readCalls(dir);
  rmSync(dir, { recursive: true, force: true });
  assertReadOnly(calls);
  return { ...run, calls, lastOut: run.stdout.trimEnd().split('\n').at(-1) };
}

test('merge-watch exits 2 with its usage before any gh call for a missing, non-numeric or extra argument, or any flag', () => {
  for (const args of [[], ['seven'], ['7x'], ['0'], ['7', '8'], ['--help'], ['-7'], ['7', '--interval=1'], ['--repo', '7']]) {
    const run = runCli(args);
    assert.equal(run.status, 2, `${JSON.stringify(args)} must exit 2; stdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
    assert.equal(run.stderr.trimEnd().split('\n').at(-1), USAGE, `${JSON.stringify(args)} must print the usage last`);
    assert.equal(run.stdout, '');
    assert.deepEqual(run.calls, [], `${JSON.stringify(args)} must make no gh call`);
  }
});

test('merge-watch as a process exits 0 printing merged last, and 1 printing the reason last on a closed pull request or a gh failure', () => {
  const merged = runCli(['7']);
  assert.equal(merged.status, 0, merged.stderr);
  assert.equal(merged.lastOut, 'merged');

  const closed = runCli(['7'], [{ view: view('CLOSED', 'CLEAN'), checks: checks({ test: 'pass', 'sweep-scope': 'pass' }) }]);
  assert.equal(closed.status, 1, closed.stderr);
  assert.equal(closed.lastOut, 'closed without merging');

  const auth = runCli(['7'], [{ view: [4, 'To get started with GitHub CLI, please run:  gh auth login'], checks: checks({}) }]);
  assert.equal(auth.status, 1, auth.stderr);
  assert.equal(auth.lastOut, 'To get started with GitHub CLI, please run:  gh auth login');
});

test('the watch exits 1 the moment gh itself fails, with the gh error as its last line', async () => {
  const auth = await watch([{ view: [4, 'To get started with GitHub CLI, please run:  gh auth login'], checks: checks({ test: 'pass', 'sweep-scope': 'pass' }) }]);
  assert.equal(auth.status, 1, 'an authentication failure must stop the wait');
  assert.equal(auth.reads, 1, 'an authentication failure must stop on the first read');
  assert.equal(auth.last, 'To get started with GitHub CLI, please run:  gh auth login');

  const network = await watch([
    { view: OPEN_BLOCKED, checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) },
    { view: OPEN_BLOCKED, checks: [1, 'error connecting to api.github.com'] },
  ]);
  assert.equal(network.status, 1, 'a network failure while reading checks must stop the wait');
  assert.equal(network.reads, 2);
  assert.equal(network.sleeps.length, 1);
  assert.equal(network.last, 'error connecting to api.github.com', 'the gh error must be printed as the reason');
});

test('the watch makes exactly one attempt at the gh call that fails, and no gh call of any kind after it', async () => {
  const error = [1, 'HTTP 502: Bad Gateway (https://api.github.com/graphql)'];
  const pending = { view: OPEN_BLOCKED, checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) };
  for (const [kind, steps, options] of [
    ['base', [MERGED], { base: error }],
    ['branch', [MERGED], { branch: error }],
    ['rules', [MERGED], { rules: error }],
    ['view', [{ ...pending, view: error }], {}],
    ['checks', [{ ...pending, checks: error }], {}],
  ]) {
    const failed = await watch(steps, options);
    assert.equal(failed.status, 1, `a failing ${kind} read must stop the wait`);
    assert.equal(failed.last, error[1], `a failing ${kind} read must print gh's error last`);
    assert.equal(failed.sleeps.length, 0, `a failing ${kind} read must not wait and try again`);
    const kinds = failed.calls.map(callKind);
    assert.equal(kinds.filter((k) => k === kind).length, 1, `a failing ${kind} read must be attempted once`);
    assert.equal(kinds.at(-1), kind, `nothing may be read after the failing ${kind} read, the rate-limit probe included`);
  }
});

test('the watch stops on a failed required check, a dirty or behind merge, or a closed pull request, even while checks are pending', async () => {
  const failed = await watch([{ view: OPEN_BLOCKED, checks: checks({ test: 'fail', 'sweep-scope': 'pending' }) }, MERGED]);
  assert.equal(failed.status, 1);
  assert.equal(failed.reads, 1, 'a failed check must stop before the next read');
  assert.equal(failed.last, 'a required check failed: fail pending');

  for (const status of ['DIRTY', 'BEHIND']) {
    const blocked = await watch([{ view: view('OPEN', status), checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) }, MERGED]);
    assert.equal(blocked.status, 1, `${status} must stop the wait`);
    assert.equal(blocked.reads, 1, `${status} must stop before the next read`);
    assert.equal(blocked.last, `merge blocked: OPEN ${status}`);
  }

  const closed = await watch([{ view: view('CLOSED', 'CLEAN'), checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) }, MERGED]);
  assert.equal(closed.status, 1, 'a closed pull request must stop the wait');
  assert.equal(closed.reads, 1);
  assert.equal(closed.last, 'closed without merging');
});

test('the watch keeps waiting through BLOCKED while required checks are pending or unreported, and stops on BLOCKED once they have all finished', async () => {
  const pending = await watch([
    { view: OPEN_BLOCKED, checks: checks({ test: 'pending', 'sweep-scope': 'pass' }) },
    { view: OPEN_BLOCKED, checks: checks({ test: 'pending', 'sweep-scope': 'pass' }) },
    MERGED,
  ]);
  assert.equal(pending.status, 0, 'BLOCKED with a pending required check must not stop the wait');
  assert.equal(pending.reads, 3, 'the wait must read again after each pending pass');
  assert.deepEqual(pending.sleeps, [30_000, 30_000], 'the wait must sleep 30 seconds between reads');
  assert.equal(pending.last, 'merged');

  const unreported = await watch([
    { view: OPEN_BLOCKED, checks: [1, "no required checks reported on the 'job/7' branch"] },
    { view: OPEN_BLOCKED, checks: [1, "no checks reported on the 'job/7' branch"] },
    MERGED,
  ]);
  assert.equal(unreported.status, 0, 'a required check not yet reported must not stop the wait');
  assert.equal(unreported.reads, 3);
  assert.equal(unreported.sleeps.length, 2);

  const finished = await watch([{ view: OPEN_BLOCKED, checks: checks({ test: 'pass', 'sweep-scope': 'skipping' }) }, MERGED]);
  assert.equal(finished.status, 1, 'BLOCKED with every required check finished must stop the wait');
  assert.equal(finished.reads, 1);
  assert.equal(finished.last, 'merge blocked with every required check finished: OPEN BLOCKED pass skipping');
});

test('the watch keeps waiting through BLOCKED while a required check from either source has not yet appeared', async () => {
  for (const partial of [{ 'sweep-scope': 'pass' }, { test: 'pass' }]) {
    const waiting = await watch([
      { view: OPEN_BLOCKED, checks: checks(partial) },
      { view: OPEN_BLOCKED, checks: checks({ 'sweep-scope': 'pass', test: 'pending' }) },
      MERGED,
    ]);
    assert.equal(waiting.status, 0, `BLOCKED with only ${Object.keys(partial)} reported must not stop the wait`);
    assert.equal(waiting.reads, 3);
    assert.equal(waiting.sleeps.length, 2);
    assert.equal(waiting.last, 'merged');
  }
});

test('the watch exits 1 before its first read when the required set cannot be read', async () => {
  const forbidden = [1, 'gh: Resource not accessible by integration (HTTP 403)'];
  for (const source of ['branch', 'rules']) {
    const unreadable = await watch([MERGED], { [source]: forbidden });
    assert.equal(unreadable.status, 1, `an unreadable ${source} read must stop the wait`);
    assert.equal(unreadable.reads, 0, `an unreadable ${source} read must stop before the first read`);
    assert.equal(unreadable.last, forbidden[1], 'the gh error must reach the session');
  }
});

test('the watch stops before its first read when a ruleset requires checks it does not name', async () => {
  for (const rule of [
    { type: 'workflows', parameters: { workflows: [{ path: '.github/workflows/<workflow>.yml', repository_id: 1 }] } },
    { type: 'code_scanning', parameters: { code_scanning_tools: [{ tool: 'CodeQL', security_alerts_threshold: 'high_or_higher', alerts_threshold: 'errors' }] } },
  ]) {
    const unnamed = await watch([MERGED], { extraRules: [rule] });
    assert.equal(unnamed.status, 1, `a ${rule.type} rule must stop the wait`);
    assert.equal(unnamed.reads, 0, `a ${rule.type} rule must stop before the first read`);
    assert.equal(
      unnamed.last,
      `a ruleset requires checks it does not name, so the full required set is unknown: ["sweep-scope",{"unnamed":"${rule.type}"}]`,
    );
  }
});

test('the watch exits 1 before its first read when a present required-check list cannot be read', async () => {
  const noContexts = { protection: { required_status_checks: { strict: true } } };
  const namelessRule = { type: 'required_status_checks', parameters: { required_status_checks: [{ integration_id: 1 }] } };
  const listlessRule = { type: 'required_status_checks', parameters: {} };
  const emptyNameRule = { type: 'required_status_checks', parameters: { required_status_checks: [{ context: '' }] } };
  const flatPages = [{ type: 'pull_request', parameters: {} }];
  for (const [options, reason] of [
    [{ branch: [0, JSON.stringify(noContexts)] }, 'unreadable required set: classic required_status_checks {"strict":true}'],
    [{ branch: [0, JSON.stringify({ protection: { required_status_checks: { contexts: 'test' } } })] }, 'unreadable required set: classic required_status_checks {"contexts":"test"}'],
    [{ branch: [0, JSON.stringify({ protection: { required_status_checks: { contexts: [null] } } })] }, 'unreadable required set: classic required_status_checks {"contexts":[null]}'],
    [{ branch: [0, JSON.stringify({ protection: { required_status_checks: { contexts: ['', 'test'] } } })] }, 'unreadable required set: classic required_status_checks {"contexts":["","test"]}'],
    [{ extraRules: [namelessRule] }, `unreadable required set: rule ${JSON.stringify(namelessRule)}`],
    [{ extraRules: [listlessRule] }, `unreadable required set: rule ${JSON.stringify(listlessRule)}`],
    [{ extraRules: [emptyNameRule] }, `unreadable required set: rule ${JSON.stringify(emptyNameRule)}`],
    [{ rules: [0, flatPages] }, `unreadable required set: rules ${JSON.stringify(flatPages)}`],
  ]) {
    const unreadable = await watch([MERGED], options);
    assert.equal(unreadable.status, 1, `${reason} must stop the wait`);
    assert.equal(unreadable.reads, 0, `${reason} must stop before the first read`);
    assert.equal(unreadable.sleeps.length, 0);
    assert.equal(unreadable.calls.filter((call) => callKind(call) === 'checks').length, 0, `${reason} must make no pr checks call`);
    assert.equal(unreadable.last, reason);
  }
});

test('the watch exits 1 on its first pass when a successful reply carries a pull request state or merge state it does not know', async () => {
  for (const [state, mergeStateStatus] of [[null, null], ['DRAFT', 'CLEAN'], ['OPEN', null], ['OPEN', ''], ['OPEN', 'ALIEN']]) {
    const unreadable = await watch([{ view: view(state, mergeStateStatus), checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) }, MERGED]);
    assert.equal(unreadable.status, 1, `${state} ${mergeStateStatus} must stop the wait`);
    assert.equal(unreadable.reads, 1);
    assert.equal(unreadable.sleeps.length, 0, `${state} ${mergeStateStatus} must not wait and read again`);
    assert.equal(unreadable.last, `unreadable pull request state: ${JSON.stringify({ state, mergeStateStatus })}`);
  }
});

test('the watch exits 1 on its first pass when a required check carries no known bucket or the checks reply is not a list', async () => {
  for (const [reply, reason] of [
    [[{ name: 'test' }, { name: 'sweep-scope', bucket: 'pass' }], 'unreadable bucket on required check "test": null'],
    [[{ name: 'test', bucket: 'pass' }, { name: 'sweep-scope', bucket: 'queued' }], 'unreadable bucket on required check "sweep-scope": "queued"'],
    [{ test: 'pass' }, 'unreadable required checks: {"test":"pass"}'],
  ]) {
    const unreadable = await watch([{ view: OPEN_BLOCKED, checks: [0, JSON.stringify(reply)] }, MERGED]);
    assert.equal(unreadable.status, 1, `${reason} must stop the wait`);
    assert.equal(unreadable.reads, 1);
    assert.equal(unreadable.sleeps.length, 0, `${reason} must not wait and read again`);
    assert.equal(unreadable.last, reason);
  }
});

test('the watch stops on BLOCKED at once when the base branch requires no checks', async () => {
  const none = await watch(
    [{ view: OPEN_BLOCKED, checks: [1, "no required checks reported on the 'job/7' branch"] }],
    { classic: [], ruled: [] },
  );
  assert.equal(none.status, 1);
  assert.equal(none.reads, 1);
  assert.equal(none.sleeps.length, 0);
  assert.equal(none.last, 'merge blocked with every required check finished: OPEN BLOCKED');
});

test('the watch exits 0 only on MERGED', async () => {
  const merged = await watch([{ view: OPEN_BLOCKED, checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) }, MERGED]);
  assert.equal(merged.status, 0);
  assert.equal(merged.reads, 2);
  assert.equal(merged.last, 'merged');

  const pending = await watch([{ view: view('MERGED', 'UNKNOWN'), checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) }]);
  assert.equal(pending.status, 0, 'MERGED must end the wait even while a required check is pending');
  assert.equal(pending.reads, 1);
  assert.equal(pending.last, 'merged');
});

test('the watch only ever reads GitHub state', async () => {
  const run = await watch([{ view: OPEN_BLOCKED, checks: checks({ test: 'pending', 'sweep-scope': 'pending' }) }, MERGED]);
  assert.equal(run.status, 0);
  assert.deepEqual(run.calls.map(callKind), ['base', 'branch', 'rules', 'view', 'checks', 'view', 'checks']);
  for (const write of [['pr', 'merge', '7'], ['pr', 'ready', '7'], ['pr', 'comment', '7'], ['issue', 'edit', '7'], ['api', '-X', 'PATCH', 'repos/{owner}/{repo}/pulls/7'], ['api', 'repos/{owner}/{repo}/issues/7/comments', '-f', 'body=x']]) {
    assert.throws(() => assertReadOnly([write]), /must only read/, `the read-only check must refuse gh ${write.join(' ')}`);
  }
});
