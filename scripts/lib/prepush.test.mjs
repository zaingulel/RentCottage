// prepush.test.mjs — real-shell proof for the shared pre-push gate.
//
// The fixture executes the tracked hook from a nested directory with isolated Git, npm, Node, and
// local-ESLint capabilities. It observes calls and scrubbed environment at the executable boundary;
// no push or hook activation occurs.
//
// Recurring cost: about four seconds for small shell subprocesses with fake tools.
// Removal condition: remove with the pre-push hook, or replace when Git supplies equivalent native
// lint, nested-test, environment-scrub, and optional-full-test enforcement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { posixShell } from './posix-shell.mjs';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '../../.githooks/pre-push');
const NO_SHELL = 'a POSIX shell is required: install Git for Windows';

// The located POSIX shell, null when there is none. On Windows it can be Git's bin\sh.exe, a launcher
// that puts Git's own tool directories, real git included, ahead of the PATH it is given, which would
// shadow the fixture's fake git; there the fixture runs the MSYS sh.exe behind it, which keeps PATH as given.
function fixtureShell() {
  const shell = posixShell();
  if (process.platform !== 'win32' || !shell) return shell;
  return spawnSync(shell, ['-c', 'cygpath -w /usr/bin/sh.exe'], { encoding: 'utf8' }).stdout.trim();
}

const SHELL = fixtureShell();

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function commandPath(name) {
  assert.ok(SHELL, NO_SHELL);
  const result = spawnSync(SHELL, ['-c', `command -v ${name}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, `fixture requires ${name}`);
  return result.stdout.trim();
}

function withFixture(options, fn) {
  const scratch = mkdtempSync(join(tmpdir(), 'workflow-prepush-'));
  try {
    const repo = join(scratch, 'repo lane');
    const cwd = join(repo, 'nested');
    const bin = join(scratch, 'bin');
    const calls = join(scratch, 'calls');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(bin);
    writeFileSync(calls, '');

    executable(join(bin, 'git'), `#!/bin/sh
case "$*" in
  "rev-parse --local-env-vars") printf '%s\n' GIT_DIR GIT_WORK_TREE ;;
  "rev-parse --show-toplevel") printf '%s\n' "$REPO_ROOT" ;;
  *) exit 90 ;;
esac
`);
    // Wrapper stubs rather than symlinks, because a symlink needs privilege on Windows; `sh` is on the
    // hook's PATH because a bare `sh` launcher resolves through it.
    for (const name of ['dirname', 'sh']) executable(join(bin, name), `#!/bin/sh\nexec "${commandPath(name)}" "$@"\n`);

    if (options.node !== false) {
      executable(join(bin, 'node'), `#!/bin/sh
printf 'node\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$*" "$PWD" "$GIT_DIR" "$GIT_WORK_TREE" "$GIT_NAMESPACE" "$NODE_TEST_CONTEXT" "$GIT_TRACE_PACKET$GIT_TRACE2_EVENT" >> "$CALLS"
case "$*" in
  "--test scripts/lib/*.test.mjs") exit "\${SCRIPT_STATUS:-0}" ;;
  *) exit 91 ;;
esac
`);
    }

    if (options.npm !== false) {
      executable(join(bin, 'npm'), `#!/bin/sh
printf 'npm\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$*" "$PWD" "$GIT_DIR" "$GIT_WORK_TREE" "$GIT_NAMESPACE" "$NODE_TEST_CONTEXT" "$GIT_TRACE_PACKET$GIT_TRACE2_EVENT" >> "$CALLS"
case "$*" in
  "run lint --silent") exit "\${LINT_STATUS:-0}" ;;
  "test") exit "\${FULL_TEST_STATUS:-0}" ;;
  *) exit 92 ;;
esac
`);
    }

    if (options.eslint !== false) {
      const eslint = join(repo, 'node_modules', '.bin', 'eslint');
      mkdirSync(dirname(eslint), { recursive: true });
      executable(eslint, '#!/bin/sh\nexit 0\n');
    }

    const run = (extra = {}) => spawnSync(SHELL, [HOOK], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: bin,
        REPO_ROOT: repo,
        CALLS: calls,
        GIT_DIR: '/wrong/repository',
        GIT_WORK_TREE: '/wrong/worktree',
        GIT_NAMESPACE: 'wrong-namespace',
        NODE_TEST_CONTEXT: 'nested-test',
        GIT_TRACE_PACKET: 'trace-packet',
        GIT_TRACE2_EVENT: 'trace-event',
        ...extra,
      },
    });
    const recorded = () => readFileSync(calls, 'utf8').split('\n').filter(Boolean);
    // The repository root as the shell names it once the hook has changed into it: the path itself off
    // Windows, where MSYS instead names it in its own POSIX form.
    const root = process.platform === 'win32'
      ? spawnSync(SHELL, ['-c', 'cd "$REPO_ROOT" && printf %s "$PWD"'], { cwd, encoding: 'utf8', env: { REPO_ROOT: repo } }).stdout
      : repo;
    fn({ recorded, root, run });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function output(result) {
  return `${result.stdout}${result.stderr}`;
}

test('pre-push invokes installed lint exactly once, then the script suite, from the resolved root', () => {
  withFixture({}, ({ recorded, root, run }) => {
    const result = run();
    assert.equal(result.status, 0, output(result));
    const calls = recorded().map((line) => line.split('\t'));
    assert.deepEqual(calls.map(([tool, args]) => `${tool} ${args}`), [
      'npm run lint --silent',
      'node --test scripts/lib/*.test.mjs',
    ]);
    assert.deepEqual(calls.map(([, , cwd]) => cwd), [root, root]);
  });
});

test('pre-push refuses a completed red lint before the script suite', () => {
  withFixture({}, ({ recorded, run }) => {
    const result = run({ LINT_STATUS: '1' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(recorded().map((line) => line.split('\t')[0]), ['npm']);
  });
});

test('pre-push refuses a nonzero script suite after lint passes', () => {
  withFixture({}, ({ recorded, run }) => {
    const result = run({ SCRIPT_STATUS: '1' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(recorded().map((line) => line.split('\t')[0]), ['npm', 'node']);
  });
});

test('pre-push skips lint without npm but still runs the script suite', () => {
  withFixture({ npm: false }, ({ recorded, run }) => {
    const result = run();
    assert.equal(result.status, 0, output(result));
    assert.match(result.stderr, /npm not found.*skipping lint gate/);
    assert.deepEqual(recorded().map((line) => line.split('\t')[0]), ['node']);
  });
});

test('pre-push skips lint without local ESLint but still runs the script suite', () => {
  withFixture({ eslint: false }, ({ recorded, run }) => {
    const result = run();
    assert.equal(result.status, 0, output(result));
    assert.match(result.stderr, /eslint not installed.*skipping lint gate/);
    assert.deepEqual(recorded().map((line) => line.split('\t')[0]), ['node']);
  });
});

test('pre-push scrubs Git, nested-test, and open-ended trace variables before every gate', () => {
  withFixture({}, ({ recorded, run }) => {
    const result = run();
    assert.equal(result.status, 0, output(result));
    for (const line of recorded()) {
      const fields = line.split('\t');
      assert.deepEqual(fields.slice(3), ['', '', '', '', ''], line);
    }
  });
});

test('pre-push fails closed when Node is unavailable', () => {
  withFixture({ node: false }, ({ recorded, run }) => {
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(output(result), /node: (?:command )?not found/);
    assert.deepEqual(recorded().map((line) => line.split('\t')[0]), ['npm']);
  });
});

test('pre-push RUN_TESTS=1 retains the optional full-test invocation', () => {
  withFixture({}, ({ recorded, run }) => {
    const result = run({ RUN_TESTS: '1' });
    assert.equal(result.status, 0, output(result));
    assert.deepEqual(recorded().map((line) => {
      const [tool, args] = line.split('\t');
      return `${tool} ${args}`;
    }), [
      'npm run lint --silent',
      'node --test scripts/lib/*.test.mjs',
      'npm test',
    ]);
  });
});
