// sweep-scope-workflow.test.mjs — the safe shape of the tracked `sweep-scope` guard in
// .github/workflows/sweep-scope.yml.
//
// The guard judges a pull request the sweep or triage routine opened, so the enforcer must not come
// from the pull request it judges: the workflow runs on pull_request_target, checks out the base
// branch, installs only that branch's own locked production dependencies, executes nothing from the
// pull request's tree, and skips its job off a sweep or triage branch, which is why the lock's own
// shape is pinned here too. Tracked bytes do not prove a maintenance routine, schedule, required
// check, or publication environment is active. Each assertion goes red if the corresponding line is
// removed (`docs/TESTING-STRATEGY.md`, a deterministic guard over the committed bytes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/sweep-scope.yml'), 'utf8');
const JOBS = load(WORKFLOW).jobs;
const JOB = JOBS['sweep-scope'];
const PARSER_PINS = {
  htmlparser2: '10.1.0',
  'mdast-util-from-markdown': '2.0.3',
  'mdast-util-gfm': '3.1.0',
  'micromark-extension-gfm': '3.0.0',
};
const BASELINE_SCRIPT_PACKAGES = [
  ['node_modules/esbuild', true, false],
  ['node_modules/fsevents', false, true],
  ['node_modules/unrs-resolver', true, false],
  ['node_modules/vite/node_modules/fsevents', true, true],
  ['node_modules/workerd', true, false],
  ['node_modules/wrangler/node_modules/esbuild', true, false],
  ['node_modules/wrangler/node_modules/fsevents', true, true],
];

test('the workflow pins every action to its approved immutable revision', () => {
  assert.match(WORKFLOW, /^\s+- uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7$/m);
  assert.match(WORKFLOW, /^\s+- uses: actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6$/m);
  assert.doesNotMatch(WORKFLOW, /^\s+- uses: actions\/(?:checkout|setup-node)@v\d+$/m);
});

test('the workflow starts from the base branch on pull_request_target, on every pull request event the suite uses', () => {
  assert.match(WORKFLOW, /^on:\n  pull_request_target:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n/m);
  assert.doesNotMatch(WORKFLOW, /^\s+ref:/m, 'a ref on the checkout would fetch the pull request\'s tree');
  assert.match(WORKFLOW, /fetch-depth: 0/);
});

test('the guard keeps one bounded run per pull request', () => {
  assert.match(WORKFLOW, /^concurrency:\n  group: sweep-scope-pr-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true$/m);
  assert.match(WORKFLOW, /^    timeout-minutes: 5$/m);
});

test('the check executes nothing from the pull request and holds a read-only token', () => {
  assert.match(WORKFLOW, /^permissions:\n  contents: read$/m);
  assert.equal((WORKFLOW.match(/^    permissions:/gm) ?? []).length, 0, 'no job may widen the token');
  assert.doesNotMatch(WORKFLOW, /npx|secrets\./);
  assert.match(WORKFLOW, /persist-credentials: false/);
  assert.match(WORKFLOW, /node scripts\/sweep-scope-check\.mjs "\$BASE_SHA" "\$HEAD_SHA"/);
});

// The parser the semantic half needs is installed, so the job is no longer install-free; what keeps
// the property is where the packages come from. One production install off the base tree's own lock,
// with no lifecycle script.
test('the only install is the base tree\'s production lock', () => {
  assert.deepEqual(JOB.steps.map((step) => step.run).filter((run) => /\bnpm\b/.test(run ?? '')),
    ['npm ci --omit=dev --ignore-scripts --no-audit --no-fund']);
});

function lockedDependencyPath(lock, packagePath, dependency) {
  let ancestor = packagePath;
  while (true) {
    const candidate = `${ancestor}/node_modules/${dependency}`;
    if (lock.packages[candidate]) return candidate;

    const boundary = ancestor.lastIndexOf('/node_modules/');
    if (boundary === -1) break;
    ancestor = ancestor.slice(0, boundary);
  }

  const rootCandidate = `node_modules/${dependency}`;
  assert.ok(lock.packages[rootCandidate], `${packagePath} dependency ${dependency} must be locked`);
  return rootCandidate;
}

function parserClosure(lock) {
  const pending = Object.keys(PARSER_PINS).map((name) => `node_modules/${name}`);
  const closure = new Set();
  while (pending.length > 0) {
    const packagePath = pending.pop();
    if (closure.has(packagePath)) continue;
    const metadata = lock.packages[packagePath];
    assert.ok(metadata, `${packagePath} must be locked`);
    closure.add(packagePath);
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      pending.push(lockedDependencyPath(lock, packagePath, dependency));
    }
  }
  return [...closure].sort();
}

function assertParserClosureIsTrusted(lock) {
  for (const packagePath of parserClosure(lock)) {
    const metadata = lock.packages[packagePath];
    const resolved = new URL(metadata.resolved);
    assert.equal(resolved.protocol, 'https:', `${packagePath} must use HTTPS`);
    assert.equal(resolved.host, 'registry.npmjs.org', `${packagePath} must use the npm registry`);
    assert.match(metadata.integrity, /^sha512-/, `${packagePath} must have SHA-512 integrity`);
    assert.notEqual(metadata.hasInstallScript, true, `${packagePath} must not run a lifecycle script`);
  }
}

test('the four exact parser pins are production dependencies backed by the locked registry closure', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(PARSER_PINS)) {
    assert.equal(manifest.dependencies[name], version);
  }

  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(PARSER_PINS)) {
    assert.equal(lock.packages[''].dependencies[name], version);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
  assertParserClosureIsTrusted(lock);
});

test('the parser closure rejects an untrusted nested dependency', () => {
  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));
  const closure = parserClosure(lock);
  for (const nestedPath of [
    'node_modules/htmlparser2/node_modules/entities',
    'node_modules/dom-serializer/node_modules/entities',
    'node_modules/mdast-util-find-and-replace/node_modules/escape-string-regexp',
  ]) {
    assert.ok(closure.includes(nestedPath), `${nestedPath} must be validated`);
  }
  assert.equal(closure.includes('node_modules/entities'), false);
  assert.equal(closure.includes('node_modules/escape-string-regexp'), false);

  const nestedPath = 'node_modules/htmlparser2/node_modules/entities';
  lock.packages[nestedPath].resolved = 'https://example.invalid/entities.tgz';

  assert.throws(
    () => assertParserClosureIsTrusted(lock),
    new RegExp(`${nestedPath} must use the npm registry`),
  );
});

test('the parser closure adds no lifecycle scripts to RentCottage\'s existing script-bearing packages', () => {
  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));
  const scriptPackages = Object.entries(lock.packages)
    .filter(([, metadata]) => metadata.hasInstallScript)
    .map(([name, metadata]) => [name, metadata.dev === true, metadata.optional === true]);
  assert.deepEqual(scriptPackages, BASELINE_SCRIPT_PACKAGES);
});

// A job its `if:` skips still reports a passing required check, so the condition is the whole
// decision: a sweep or triage branch it missed would merge unjudged, which is why both prefixes are
// pinned. The workflow holds this one job, so no other job can report under the check's name. The
// exact key sets leave nothing else able to skip the job or a step, so a job that starts always
// reaches the check. A fork names its own branch: the condition compares it as a value, and no step
// may read it.
test('the job condition alone reads the branch name and decides the job, and a started job skips no step', () => {
  assert.deepEqual(Object.keys(JOBS), ['sweep-scope']);
  assert.equal(JOB.if, "startsWith(github.head_ref, 'docs-sweep/') || startsWith(github.head_ref, 'docs-triage/')");
  assert.deepEqual(Object.keys(JOB).sort(), ['if', 'runs-on', 'steps', 'timeout-minutes']);
  assert.deepEqual(JOB.steps.map((step) => Object.keys(step).sort()),
    [['uses', 'with'], ['uses', 'with'], ['run'], ['env', 'run']]);
  assert.doesNotMatch(JSON.stringify(JOB.steps), /head_ref|head\.ref/);
});

// GitHub pastes a `${{ }}` expression into the script text before bash reads it, which would run a
// value carrying a backtick or a `;`; reaching a value through `env:` and a quoted variable cannot.
test('fork-controlled values reach the shell through env, never interpolated into a run block', () => {
  for (const { run } of JOB.steps) if (run) assert.doesNotMatch(run, /\$\{\{/);
  assert.deepEqual(JOB.steps.at(-1).env, {
    HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
    BASE_SHA: '${{ github.event.pull_request.base.sha }}',
  });
});

// The check's run block is executed, not pattern-matched, for the branch it can decide without a
// network call.
test('a judged branch whose head is missing fails loud instead of passing on an empty check', () => {
  const result = spawnSync('bash', ['-c', JOB.steps.at(-1).run], {
    env: { ...process.env, HEAD_SHA: '0'.repeat(40), BASE_SHA: 'unused' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /was not fetched/);
});

function fakeCommand(directory, name, body) {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

test('a judged branch installs the base production lock with lifecycle scripts disabled', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-install-'));
  const commandLog = join(directory, 'command-log');
  fakeCommand(directory, 'npm', 'printf \'%s\\n\' "$@" > "$COMMAND_LOG"');
  const install = spawnSync('bash', ['-c', JOB.steps[2].run], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COMMAND_LOG: commandLog },
    encoding: 'utf8',
  });
  assert.equal(install.status, 0, install.stderr);
  assert.equal(readFileSync(commandLog, 'utf8'), 'ci\n--omit=dev\n--ignore-scripts\n--no-audit\n--no-fund\n');
});

test('a registry failure stops the judged install closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-registry-'));
  fakeCommand(directory, 'npm', 'echo "registry unavailable" >&2\nexit 42');
  const result = spawnSync('bash', ['-c', JOB.steps[2].run], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 42);
  assert.match(result.stderr, /registry unavailable/);
});

test('the base-owned checker receives the quoted immutable base and head SHAs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-check-'));
  const commandLog = join(directory, 'command-log');
  fakeCommand(directory, 'git', 'test "$1" = cat-file\ntest "$2" = -e');
  fakeCommand(directory, 'node', 'printf \'%s\\n\' "$@" > "$COMMAND_LOG"');
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const result = spawnSync('bash', ['-c', JOB.steps.at(-1).run], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      COMMAND_LOG: commandLog,
      HEAD_SHA: headSha,
      BASE_SHA: baseSha,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(commandLog, 'utf8'), `scripts/sweep-scope-check.mjs\n${baseSha}\n${headSha}\n`);
});
