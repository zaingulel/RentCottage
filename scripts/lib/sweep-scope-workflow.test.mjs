// sweep-scope-workflow.test.mjs — the safe shape of the tracked `sweep-scope` guard in
// .github/workflows/sweep-scope.yml.
//
// The guard judges a pull request the sweep or triage routine opened, so the enforcer must not come
// from the pull request it judges: the workflow runs on pull_request_target, checks out the base
// branch, installs only that branch's own locked production dependencies, executes nothing from the
// pull request's tree, and passes at once off a sweep or triage branch, which is why the lock's own
// shape is pinned here too. Tracked bytes do not prove a maintenance routine, schedule, required
// check, or publication environment is active. Each assertion goes red if the corresponding line is
// removed (`docs/engineering/testing-strategy.md`, a deterministic guard over the committed bytes).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/sweep-scope.yml'), 'utf8');
const PARSER_PINS = {
  htmlparser2: '10.1.0',
  'mdast-util-from-markdown': '2.0.3',
  'mdast-util-gfm': '3.1.0',
  'micromark-extension-gfm': '3.0.0',
};
const BASELINE_SCRIPT_PACKAGES = [
  ['node_modules/@opennextjs/aws/node_modules/esbuild', true, false],
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

test('the check runs from the base branch on pull_request_target, on every pull request event the suite uses', () => {
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

test('the only install is the base tree\'s production lock, run for a judged pull request alone', () => {
  assert.deepEqual(WORKFLOW.match(/\bnpm\b.*/g), ['npm ci --omit=dev --ignore-scripts --no-audit --no-fund']);
  assert.match(WORKFLOW, /^      - if: steps\.gate\.outputs\.judge == 'true'\n        run: npm ci /m);
  assert.equal(
    (WORKFLOW.match(/if: steps\.gate\.outputs\.judge == 'true'/g) ?? []).length,
    4,
    'the checkout, the setup, the install and the check all wait on the gate',
  );
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

function runBlock(which) {
  const chunks = WORKFLOW.split(/^ {8}run: \|\n/m).slice(1);
  assert.equal(chunks.length, 2, 'the gate and the check are the file\'s only multi-line run blocks');
  const body = [];
  for (const line of chunks[which === 'gate' ? 0 : 1].split('\n')) {
    if (!line.startsWith(' '.repeat(10))) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

function installCommand() {
  const match = WORKFLOW.match(/^        run: (npm ci .*)$/m);
  assert.ok(match, 'the install step must have a single-line npm ci command');
  return match[1];
}

function fakeCommand(directory, name, body) {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(path, 0o755);
}

test('fork-controlled values reach the shell through env, never interpolated into a run block', () => {
  for (const block of ['gate', 'check']) assert.doesNotMatch(runBlock(block), /\$\{\{/);
  assert.doesNotMatch(WORKFLOW, /^\s+run: .*\$\{\{/m, 'a single-line run may not interpolate either');
  assert.match(WORKFLOW, /^      - id: gate\n        env:\n          HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}$/m);
  assert.match(WORKFLOW, /^        env:\n          HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n          BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}$/m);
});

test('an ordinary branch exits through the first gate without installing or checking', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-ordinary-'));
  const output = join(directory, 'output');
  const result = spawnSync('bash', ['-c', runBlock('gate')], {
    env: { ...process.env, HEAD_REF: 'job/318', GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /job\/318 is not a sweep or triage branch/);
  assert.equal(readFileSync(output, 'utf8'), 'judge=false\n');
});

test('a judged branch installs the base production lock with lifecycle scripts disabled', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-install-'));
  const output = join(directory, 'output');
  const commandLog = join(directory, 'command-log');
  fakeCommand(directory, 'npm', 'printf \'%s\\n\' "$@" > "$COMMAND_LOG"');
  const gate = spawnSync('bash', ['-c', runBlock('gate')], {
    env: { ...process.env, HEAD_REF: 'docs-sweep/2026-09-21', GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });
  assert.equal(gate.status, 0, gate.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'judge=true\n');
  const install = spawnSync('bash', ['-c', installCommand()], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, COMMAND_LOG: commandLog },
    encoding: 'utf8',
  });
  assert.equal(install.status, 0, install.stderr);
  assert.equal(readFileSync(commandLog, 'utf8'), 'ci\n--omit=dev\n--ignore-scripts\n--no-audit\n--no-fund\n');
});

test('a registry failure stops the judged install closed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-registry-'));
  fakeCommand(directory, 'npm', 'echo "registry unavailable" >&2\nexit 42');
  const result = spawnSync('bash', ['-c', installCommand()], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 42);
  assert.match(result.stderr, /registry unavailable/);
});

// The triage lands on the same allowlist as the sweep, so a triage branch must reach the check:
// a gate that only knew the sweep's prefix would let a triage pull request through unjudged.
for (const head of ['docs-sweep/2026-09-21', 'docs-triage/2026-09-22']) {
  test(`a ${head.split('/')[0]} branch whose head is missing fails loud instead of passing on an empty check`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-missing-head-'));
    fakeCommand(directory, 'git', 'exit 1');
    const result = spawnSync('bash', ['-c', runBlock('check')], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        HEAD_SHA: '0'.repeat(40),
        BASE_SHA: 'a'.repeat(40),
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /was not fetched/);
  });
}

test('the base-owned checker receives the quoted immutable base and head SHAs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-scope-check-'));
  const commandLog = join(directory, 'command-log');
  fakeCommand(directory, 'git', 'test "$1" = cat-file\ntest "$2" = -e');
  fakeCommand(directory, 'node', 'printf \'%s\\n\' "$@" > "$COMMAND_LOG"');
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const result = spawnSync('bash', ['-c', runBlock('check')], {
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
