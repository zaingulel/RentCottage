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
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../run-log.mjs');

function withRepo(fn) {
  const repo = mkdtempSync(join(realpathSync(tmpdir()), 'run-log-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'job/42'], { cwd: repo });
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function run(repo, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' });
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
  return readFileSync(join(repo, '.claude', 'worklog', 'job_42.md'), 'utf8').trim().split('\n');
}

test('a passing and a failing command are logged with their real exit codes and propagated', () => {
  withRepo((repo) => {
    const ok = run(repo, ['focused test', '--', process.execPath, '-e', 'process.exit(0)']);
    assert.equal(ok.status, 0, ok.stderr);
    const red = run(repo, ['mutation red', '--', process.execPath, '-e', 'process.exit(3)']);
    assert.equal(red.status, 3, red.stderr);
    const lines = logLines(repo);
    assert.equal(lines.length, 2);
    const passing = lines[0].match(/^- \d{4}-\d{2}-\d{2}T[^ ]+ \| focused test \| `([^`]*)` \| exit 0 \| head=unknown tree=unknown$/);
    assert.ok(passing, 'the passing receipt must retain its timestamp, label, command field, and exit code');
    assert.deepEqual(JSON.parse(passing[1]), [process.execPath, '-e', 'process.exit(0)']);
    assert.match(lines[1], /\| mutation red \| .* \| exit 3 \| head=unknown tree=unknown$/);
  });
});

test('a command that cannot be started is logged as a spawn failure, never as a red run', () => {
  withRepo((repo) => {
    const r = run(repo, ['typo', '--', 'definitely-not-a-command-xyz', '--flag']);
    assert.equal(r.status, 127);
    const [line] = logLines(repo);
    const failed = line.match(/\| typo \| `([^`]*)` \| spawn failed \(ENOENT\) \| head=unknown tree=unknown$/);
    assert.ok(failed, 'the receipt must retain its label, command field, and ENOENT outcome');
    assert.deepEqual(JSON.parse(failed[1]), ['definitely-not-a-command-xyz', '--flag']);
    assert.doesNotMatch(line, /exit 1/);
  });
});

test('a child signal is logged and re-raised with shell status 137', () => {
  withRepo((repo) => {
    const result = spawnSync('/bin/sh', [
      '-c',
      '"$1" "$2" signal -- "$1" -e \'process.kill(process.pid, "SIGKILL")\'; exit $?',
      'run-log-test',
      process.execPath,
      SCRIPT,
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 137, result.stderr);
    const [line] = logLines(repo);
    assert.match(line, /\| signal \| .* \| killed by SIGKILL \| head=unknown tree=unknown$/);
  });
});

test('receipt preserves exact argument boundaries and Markdown safety', () => {
  withRepo((repo) => {
    const command = [
      process.execPath,
      '-e',
      'process.exit(0)',
      'one argument',
      'back`tick',
      'line\nbreak',
    ];

    const result = run(repo, ['receipt safety', '--', ...command]);
    assert.equal(result.status, 0, result.stderr);

    const receipt = readFileSync(join(repo, '.claude', 'worklog', 'job_42.md'), 'utf8').trimEnd();
    assert.equal(receipt.split('\n').length, 1, 'the receipt must remain on one Markdown line');
    assert.equal([...receipt.matchAll(/`/g)].length, 2, 'the command field must have only its delimiters');
    const field = receipt.match(/\| receipt safety \| `([^`]*)` \| exit 0 \| head=unknown tree=unknown$/);
    assert.ok(field, 'the receipt must contain one inline-code command field');
    assert.deepEqual(JSON.parse(field[1]), command, 'the receipt must preserve the exact argument vector');
  });
});

test('a receipt-write failure cannot replace the child exit or signal result', () => {
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
    ], { cwd: repo, encoding: 'utf8' });
    assert.equal(signalled.status, 137, signalled.stderr);
    assert.match(signalled.stderr, /run-log: could not write receipt/);
  });
});

test('a successful child is incomplete evidence when its receipt cannot be written', () => {
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

test('a missing label or command is a usage error and writes nothing', () => {
  withRepo((repo) => {
    assert.equal(run(repo, ['--', 'true']).status, 2);
    assert.equal(run(repo, ['label', '--']).status, 2);
    assert.equal(run(repo, ['label', 'true']).status, 2);
    assert.throws(() => logLines(repo), /ENOENT/);
  });
});

test('a clean committed tree is recorded with its commit and tree=clean', () => {
  withRepo((repo) => {
    commit(repo);
    const r = run(repo, ['clean', '--', process.execPath, '-e', 'process.exit(0)']);
    assert.equal(r.status, 0, r.stderr);
    const [line] = logLines(repo);
    const state = line.match(/\| exit 0 \| head=([0-9a-f]{40}) tree=clean$/);
    assert.ok(state, line);
    assert.equal(state[1], head(repo));
  });
});

test('an untracked file makes the recorded tree dirty', () => {
  withRepo((repo) => {
    commit(repo);
    writeFileSync(join(repo, 'scratch.txt'), 'untracked');
    const r = run(repo, ['untracked', '--', process.execPath, '-e', 'process.exit(0)']);
    assert.equal(r.status, 0, r.stderr);
    const [line] = logLines(repo);
    assert.ok(line.endsWith(`| exit 0 | head=${head(repo)} tree=dirty`), line);
  });
});

test('an untracked file makes the recorded tree dirty even when git hides untracked files', () => {
  withRepo((repo) => {
    commit(repo);
    spawnSync('git', ['config', 'status.showUntrackedFiles', 'no'], { cwd: repo });
    writeFileSync(join(repo, 'scratch.txt'), 'untracked');
    const r = run(repo, ['untracked hidden', '--', process.execPath, '-e', 'process.exit(0)']);
    assert.equal(r.status, 0, r.stderr);
    const [line] = logLines(repo);
    assert.ok(line.endsWith(`| exit 0 | head=${head(repo)} tree=dirty`), line);
  });
});

test('an unborn HEAD is recorded as unknown and never as a clean tree', () => {
  withRepo((repo) => {
    const r = run(repo, ['unborn', '--', process.execPath, '-e', 'process.exit(0)']);
    assert.equal(r.status, 0, r.stderr);
    const [line] = logLines(repo);
    assert.ok(line.endsWith('| exit 0 | head=unknown tree=unknown'), line);
    assert.ok(!line.includes('tree=clean'), line);
  });
});

test('a commit and a new file made during the run are recorded as a head change and a dirty tree', () => {
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
    assert.ok(line.endsWith(`| exit 0 | head=${before}->${after} tree=dirty`), line);
  });
});

test('a missing git binary is recorded as unknown state without changing the exit status', () => {
  withRepo((repo) => {
    commit(repo);
    const emptyPath = mkdtempSync(join(realpathSync(tmpdir()), 'run-log-path-'));
    try {
      const r = spawnSync(process.execPath, [SCRIPT, 'no git', '--', process.execPath, '-e', 'process.exit(0)'], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PATH: emptyPath },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /TypeError/);
      const receipt = readFileSync(join(repo, '.claude', 'worklog', 'detached.md'), 'utf8').trimEnd();
      assert.ok(receipt.endsWith('| exit 0 | head=unknown tree=unknown'), receipt);
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  });
});
