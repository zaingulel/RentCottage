// run-log.test.mjs — scripts/run-log.mjs writes what actually happened.
//
// The log line is what a pull request body quotes as machine-written evidence, so the three
// outcomes must be distinguishable: a real exit code, a signal, and a command that never started.
// Mutation: collapse the spawn-failure branch back to `exit 1` and the third case goes red.
// Each receipt also records the commit and working-tree state; an unknown state never reads as clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../run-log.mjs');
const TEST_ENV = { ...process.env };
delete TEST_ENV.RUN_LOG_RERUN_REASON;

function withRepo(fn) {
  const repo = mkdtempSync(join(realpathSync(tmpdir()), 'run-log-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'job/42'], { cwd: repo });
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function run(repo, args, { env = TEST_ENV, nodeArgs = [] } = {}) {
  return spawnSync(process.execPath, [...nodeArgs, SCRIPT, ...args], { cwd: repo, encoding: 'utf8', env });
}

const IDENTITY = ['-c', 'user.name=run-log-test', '-c', 'user.email=run-log@example.invalid'];

function commit(repo) {
  const r = spawnSync('git', [...IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function head(repo) {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
}

function logLines(repo) {
  const lines = readFileSync(join(repo, '.claude', 'worklog', 'job_42.md'), 'utf8').trim().split('\n');
  lines.forEach(receiptFields);
  return lines;
}

// Every stored receipt must retain complete timing, including unsuccessful child outcomes.
function receiptFields(line) {
  const match = line.match(/^- ([^ ]+) \| (.*?) \| `([^`]*)` \| (.*?) \| completed=([^ ]+) \| elapsedMs=(\d+(?:\.\d+)?) \| rerunReason=`([^`]*)` \| (head=.* tree=.*)$/);
  assert.ok(match, line);
  const [, started, label, argv, outcome, completed, elapsedMs, reason, state] = match;
  for (const timestamp of [started, completed]) {
    assert.equal(new Date(timestamp).toISOString(), timestamp, 'timestamps must be canonical UTC');
  }
  return { started, label, command: JSON.parse(argv), outcome, completed, elapsedMs: Number(elapsedMs), rerunReason: JSON.parse(reason), state };
}

// The real child still executes. Git work advances the clock by a distinct, excluded amount.
function clockPreload(repo) {
  const path = join(repo, '.git', 'receipt-clock.mjs');
  writeFileSync(path, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const realSpawn = childProcess.spawnSync;
    const RealDate = Date;
    let tick = 1000000000n;
    let utc = '2026-09-26T10:00:00.000Z';
    process.hrtime.bigint = () => tick;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [utc])); }
    };
    childProcess.spawnSync = (...args) => {
      const result = realSpawn(...args);
      if (args[0] === 'git') {
        tick += 1000000000n;
        utc = new RealDate(new RealDate(utc).getTime() + 1000).toISOString();
      } else {
        tick += 137500000n;
        utc = new RealDate(new RealDate(utc).getTime() + 2000).toISOString();
      }
      return result;
    };
    syncBuiltinESMExports();
  `);
  return ['--import', pathToFileURL(path).href];
}

// Reuse the real-repository regression set; retire it only when the receipt contract is retired.
test('command receipt contract', async (t) => {
  await t.test('monotonic child duration and UTC boundaries exclude Git snapshots for every outcome', () => {
    withRepo((repo) => {
      const nodeArgs = clockPreload(repo);
      const cases = [
        { command: [process.execPath, '-e', 'process.exit(0)'], status: 0, signal: null, outcome: 'exit 0' },
        { command: [process.execPath, '-e', 'process.exit(3)'], status: 3, signal: null, outcome: 'exit 3' },
        { command: [process.execPath, '-e', 'process.kill(process.pid, "SIGKILL")'], status: null, signal: 'SIGKILL', outcome: 'killed by SIGKILL' },
        { command: ['definitely-not-a-command-xyz'], status: 127, signal: null, outcome: 'spawn failed (ENOENT)' },
      ];
      for (const { command, status, signal, outcome } of cases) {
        const result = run(repo, ['deterministic clock', '--', ...command], { nodeArgs });
        assert.equal(result.status, status, result.stderr);
        assert.equal(result.signal, signal);
        const receipt = receiptFields(logLines(repo).at(-1));
        assert.deepEqual(receipt.command, command);
        assert.equal(receipt.outcome, outcome);
        assert.equal(receipt.elapsedMs, 137.5, 'the child advances 137.5 milliseconds; each Git call advances a separate second');
        assert.equal(new Date(receipt.completed) - new Date(receipt.started), 2000, 'only the child advances UTC by two seconds');
        assert.equal(receipt.rerunReason, null, 'absent context must not imply a first run');
      }
    });
  });

  await t.test('real child UTC timestamps fall within the persisted receipt boundaries', () => {
    withRepo((repo) => {
      const result = run(repo, ['real UTC observer', '--', process.execPath, '-e',
        'console.log(JSON.stringify({ first: new Date().toISOString(), final: new Date().toISOString() }))',
      ]);
      assert.equal(result.status, 0, result.stderr);
      const child = JSON.parse(result.stdout.split('\n')[0]);
      const receipt = receiptFields(logLines(repo)[0]);
      assert.ok(Date.parse(receipt.started) <= Date.parse(child.first));
      assert.ok(Date.parse(receipt.completed) >= Date.parse(child.final), 'completion must follow the child final timestamp');
    });
  });

  await t.test('explicit rerun context round-trips exactly without Markdown or control injection', () => {
    withRepo((repo) => {
      for (const [index, reason] of ['  Changed the assertion  ', 'line\nbreak\r\t` | <tag>&\b\x1f\x7f\u0085\u2028\u2029'].entries()) {
        const result = run(repo, ['explicit rerun', '--', process.execPath, '-e', 'process.exit(0)'], {
          env: { ...TEST_ENV, RUN_LOG_RERUN_REASON: reason },
        });
        assert.equal(result.status, 0, result.stderr);
        const lines = logLines(repo);
        const line = lines.at(-1);
        assert.equal(lines.length, index + 1, 'each invocation adds exactly one receipt line');
        assert.equal([...line.matchAll(/`/g)].length, 4, 'only the command and reason delimiters remain');
        const field = line.match(/\| rerunReason=`([^`]*)` \|/)[1];
        assert.doesNotMatch(field, /[|<>&\u007f-\u009f\u2028\u2029]/);
        assert.equal(receiptFields(line).rerunReason, reason);
      }
    });
  });

  await t.test('blank rerun context is a usage error before any child or receipt is created', () => {
    withRepo((repo) => {
      const marker = join(repo, 'child-started');
      for (const reason of ['', ' \t\r\n']) {
        const result = run(repo, ['invalid rerun', '--', process.execPath, '-e',
          'require("node:fs").writeFileSync(process.argv[1], "started")', marker,
        ], { env: { ...TEST_ENV, RUN_LOG_RERUN_REASON: reason } });
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /RUN_LOG_RERUN_REASON must be nonblank/);
        assert.throws(() => readFileSync(marker), /ENOENT/);
        assert.throws(() => logLines(repo), /ENOENT/);
      }
    });
  });

  await t.test('a passing and a failing command are logged with their real exit codes and propagated', () => {
    withRepo((repo) => {
      const ok = run(repo, ['focused test', '--', process.execPath, '-e', 'process.exit(0)']);
      assert.equal(ok.status, 0, ok.stderr);
      const red = run(repo, ['mutation red', '--', process.execPath, '-e', 'process.exit(3)']);
      assert.equal(red.status, 3, red.stderr);
      const lines = logLines(repo);
      assert.equal(lines.length, 2);
      const passing = lines[0].match(/^- \d{4}-\d{2}-\d{2}T[^ ]+ \| focused test \| `([^`]*)` \| exit 0 \| .* \| head=unknown tree=unknown$/);
      assert.ok(passing, 'the passing receipt must retain its timestamp, label, command field, and exit code');
      assert.deepEqual(JSON.parse(passing[1]), [process.execPath, '-e', 'process.exit(0)']);
      assert.match(lines[1], /\| mutation red \| .* \| exit 3 \| .* \| head=unknown tree=unknown$/);
    });
  });

  await t.test('a command that cannot be started is logged as a spawn failure, never as a red run', () => {
    withRepo((repo) => {
      const r = run(repo, ['typo', '--', 'definitely-not-a-command-xyz', '--flag']);
      assert.equal(r.status, 127);
      const [line] = logLines(repo);
      const failed = line.match(/\| typo \| `([^`]*)` \| spawn failed \(ENOENT\) \| .* \| head=unknown tree=unknown$/);
      assert.ok(failed, 'the receipt must retain its label, command field, and ENOENT outcome');
      assert.deepEqual(JSON.parse(failed[1]), ['definitely-not-a-command-xyz', '--flag']);
      assert.doesNotMatch(line, /exit 1/);
    });
  });

  await t.test('a child signal is logged and re-raised with shell status 137', () => {
    withRepo((repo) => {
      const result = spawnSync('/bin/sh', [
        '-c',
        '"$1" "$2" signal -- "$1" -e \'process.kill(process.pid, "SIGKILL")\'; exit $?',
        'run-log-test',
        process.execPath,
        SCRIPT,
      ], { cwd: repo, encoding: 'utf8', env: TEST_ENV });
      assert.equal(result.status, 137, result.stderr);
      const [line] = logLines(repo);
      assert.match(line, /\| signal \| .* \| killed by SIGKILL \| .* \| head=unknown tree=unknown$/);
    });
  });

  await t.test('receipt preserves exact argument boundaries and Markdown safety', () => {
    withRepo((repo) => {
      const command = [
        process.execPath,
        '-e',
        'process.exit(0)',
        'one argument',
        'back`tick',
        'line\nbreak',
        'pipe|value',
        '<tag>&',
        'controls\x7f\u0085\u2028\u2029',
      ];

      const result = run(repo, ['receipt safety', '--', ...command]);
      assert.equal(result.status, 0, result.stderr);

      const receipt = readFileSync(join(repo, '.claude', 'worklog', 'job_42.md'), 'utf8').trimEnd();
      assert.equal(receipt.split('\n').length, 1, 'the receipt must remain on one Markdown line');
      assert.equal([...receipt.matchAll(/`/g)].length, 4, 'the command and reason fields must have only their delimiters');
      const field = receipt.match(/\| receipt safety \| `([^`]*)` \| exit 0 \| .* \| head=unknown tree=unknown$/);
      assert.ok(field, 'the receipt must contain one inline-code command field');
      assert.doesNotMatch(field[1], /[|<>&\u007f-\u009f\u2028\u2029]/);
      assert.deepEqual(JSON.parse(field[1]), command, 'the receipt must preserve the exact argument vector');
    });
  });

  await t.test('a receipt-write failure cannot replace the child exit or signal result', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, '.claude'), 'blocks the receipt directory');
      const red = run(repo, ['red without receipt', '--', process.execPath, '-e', 'process.exit(3)']);
      assert.equal(red.status, 3, red.stderr);
      assert.match(red.stderr, /run-log: could not write receipt/);

      const signalled = spawnSync('/bin/sh', [
        '-c',
        '"$1" "$2" signal-without-receipt -- "$1" -e \'process.kill(process.pid, "SIGKILL")\'; exit $?',
        'run-log-test',
        process.execPath,
        SCRIPT,
      ], { cwd: repo, encoding: 'utf8', env: TEST_ENV });
      assert.equal(signalled.status, 137, signalled.stderr);
      assert.match(signalled.stderr, /run-log: could not write receipt/);
    });
  });

  await t.test('a successful child is incomplete evidence when its receipt cannot be written', () => {
    withRepo((repo) => {
      writeFileSync(join(repo, '.claude'), 'blocks the receipt directory');

      const result = run(repo, [
        'green without receipt',
        '--',
        process.execPath,
        '-e',
        'process.exit(0)',
      ]);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /run-log: could not write receipt/);
      assert.equal(readFileSync(join(repo, '.claude'), 'utf8'), 'blocks the receipt directory');
    });
  });

  await t.test('a missing label or command is a usage error and writes nothing', () => {
    withRepo((repo) => {
      assert.equal(run(repo, ['--', 'true']).status, 2);
      assert.equal(run(repo, ['label', '--']).status, 2);
      assert.equal(run(repo, ['label', 'true']).status, 2);
      assert.throws(() => logLines(repo), /ENOENT/);
    });
  });

  await t.test('a clean committed tree is recorded with its commit and tree=clean', () => {
    withRepo((repo) => {
      commit(repo);
      const r = run(repo, ['clean', '--', process.execPath, '-e', 'process.exit(0)']);
      assert.equal(r.status, 0, r.stderr);
      const [line] = logLines(repo);
      const state = line.match(/\| exit 0 \| .* \| head=([0-9a-f]{40}) tree=clean$/);
      assert.ok(state, line);
      assert.equal(state[1], head(repo));
    });
  });

  await t.test('an untracked file makes the recorded tree dirty', () => {
    withRepo((repo) => {
      commit(repo);
      writeFileSync(join(repo, 'scratch.txt'), 'untracked');
      const r = run(repo, ['untracked', '--', process.execPath, '-e', 'process.exit(0)']);
      assert.equal(r.status, 0, r.stderr);
      const [line] = logLines(repo);
      assert.equal(receiptFields(line).outcome, 'exit 0');
      assert.ok(line.endsWith(`| head=${head(repo)} tree=dirty`), line);
    });
  });

  await t.test('an untracked file makes the recorded tree dirty even when git hides untracked files', () => {
    withRepo((repo) => {
      commit(repo);
      spawnSync('git', ['config', 'status.showUntrackedFiles', 'no'], { cwd: repo });
      writeFileSync(join(repo, 'scratch.txt'), 'untracked');
      const r = run(repo, ['untracked hidden', '--', process.execPath, '-e', 'process.exit(0)']);
      assert.equal(r.status, 0, r.stderr);
      const [line] = logLines(repo);
      assert.equal(receiptFields(line).outcome, 'exit 0');
      assert.ok(line.endsWith(`| head=${head(repo)} tree=dirty`), line);
    });
  });

  await t.test('an unborn HEAD is recorded as unknown and never as a clean tree', () => {
    withRepo((repo) => {
      const r = run(repo, ['unborn', '--', process.execPath, '-e', 'process.exit(0)']);
      assert.equal(r.status, 0, r.stderr);
      const [line] = logLines(repo);
      assert.equal(receiptFields(line).outcome, 'exit 0');
      assert.ok(line.endsWith('| head=unknown tree=unknown'), line);
      assert.ok(!line.includes('tree=clean'), line);
    });
  });

  await t.test('a commit and a new file made during the run are recorded as a head change and a dirty tree', () => {
    withRepo((repo) => {
      commit(repo);
      const before = head(repo);
      const script = [
        "const { execFileSync } = require('node:child_process');",
        "require('node:fs').writeFileSync('made.txt', 'made');",
        `execFileSync('git', ${JSON.stringify([...IDENTITY, 'commit', '-q', '--allow-empty', '-m', 'during'])});`,
      ].join('\n');
      const r = run(repo, ['changed', '--', process.execPath, '-e', script]);
      assert.equal(r.status, 0, r.stderr);
      const after = head(repo);
      assert.notEqual(after, before);
      const [line] = logLines(repo);
      assert.equal(receiptFields(line).outcome, 'exit 0');
      assert.ok(line.endsWith(`| head=${before}->${after} tree=dirty`), line);
    });
  });

  await t.test('a missing git binary is recorded as unknown state without changing the exit status', () => {
    withRepo((repo) => {
      commit(repo);
      const emptyPath = mkdtempSync(join(realpathSync(tmpdir()), 'run-log-path-'));
      try {
        const r = spawnSync(process.execPath, [SCRIPT, 'no git', '--', process.execPath, '-e', 'process.exit(0)'], {
          cwd: repo,
          encoding: 'utf8',
          env: { ...TEST_ENV, PATH: emptyPath },
        });
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stderr, /TypeError/);
        const receipt = readFileSync(join(repo, '.claude', 'worklog', 'detached.md'), 'utf8').trimEnd();
        assert.equal(receiptFields(receipt).outcome, 'exit 0');
        assert.ok(receipt.endsWith('| head=unknown tree=unknown'), receipt);
      } finally {
        rmSync(emptyPath, { recursive: true, force: true });
      }
    });
  });
});
