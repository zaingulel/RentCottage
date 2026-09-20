// run-log.test.mjs — scripts/run-log.mjs writes what actually happened.
//
// The log line is what a pull request body quotes as machine-written evidence, so the three
// outcomes must be distinguishable: a real exit code, a signal, and a command that never started.
// Mutation: collapse the spawn-failure branch back to `exit 1` and the third case goes red.

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
    assert.match(lines[0], /^- \d{4}-\d{2}-\d{2}T[^ ]+ \| focused test \| `.*-e process\.exit\(0\)` \| exit 0$/);
    assert.match(lines[1], /\| mutation red \| .* \| exit 3$/);
  });
});

test('a command that cannot be started is logged as a spawn failure, never as a red run', () => {
  withRepo((repo) => {
    const r = run(repo, ['typo', '--', 'definitely-not-a-command-xyz', '--flag']);
    assert.equal(r.status, 127);
    const [line] = logLines(repo);
    assert.match(line, /\| typo \| `definitely-not-a-command-xyz --flag` \| spawn failed \(ENOENT\)$/);
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
    assert.match(line, /\| signal \| .* \| killed by SIGKILL$/);
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

test('a missing label or command is a usage error and writes nothing', () => {
  withRepo((repo) => {
    assert.equal(run(repo, ['--', 'true']).status, 2);
    assert.equal(run(repo, ['label', '--']).status, 2);
    assert.equal(run(repo, ['label', 'true']).status, 2);
    assert.throws(() => logLines(repo), /ENOENT/);
  });
});
