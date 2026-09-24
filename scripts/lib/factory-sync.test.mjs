// factory-sync.test.mjs — tests for the factory manifest reader, its drift verification, the sync into an
// adopter, the lag check against the canonical main, and the CLI.
// Run: node --test scripts/lib/factory-sync.test.mjs   (or `npm run test:scripts`)
//
// Price tag: every tree is a real temporary directory; each sync test builds and commits two small git
// repositories, and the CLI tests spawn git and node a handful of times. No network: the sync tests inject the
// source's fetch of origin main, which is proven on its own against a local bare origin; the --from wire test runs
// with GIT_ALLOW_PROTOCOL=file; and the --check wire tests put a fake gh first on the PATH. Retire this file with
// scripts/lib/factory-sync.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLag, checkManifestPath, computeEntries, fetchMain, readManifest, syncInto, verifyManifest } from './factory-sync.mjs';

// Computed by `printf 'hello\n' | shasum -a 256`, never by the code under test.
const HELLO_SHA256 = '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03';
// Computed by `printf 'x\ny\n' | shasum -a 256`: the region text excludes both marker lines.
const REGION_SHA256 = '09834d488008f5f1ef589a2d7cedc52425bee9dd23b2212e4c1d673c5cbb54e4';
const START = '<!-- factory-shared:start -->';
const END = '<!-- factory-shared:end -->';

function writeManifest(root, entries) {
  mkdirSync(join(root, '.agents'), { recursive: true });
  writeFileSync(
    join(root, '.agents', 'factory-manifest.json'),
    JSON.stringify({ canonical: 'example-owner/example-repo', adopters: ['example-owner/adopter'], entries }),
  );
}

// A tree holding one file and one symlink to it, with a manifest that records both correctly.
function matchingTree(t) {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'a.txt'), 'hello\n');
  symlinkSync('docs/a.txt', join(root, 'link'));
  writeManifest(root, [
    { path: 'docs/a.txt', sha256: HELLO_SHA256 },
    { path: 'link', symlink: 'docs/a.txt' },
  ]);
  return root;
}

for (const path of ['../x', 'a/../b', '/abs', '', './x']) {
  test(`the manifest path ${JSON.stringify(path)} is rejected by name`, () => {
    assert.throws(() => checkManifestPath(path), /invalid manifest path/);
  });
}

test('a plain relative manifest path is accepted', () => {
  assert.equal(checkManifestPath('.agents/skills/tdd/SKILL.md'), '.agents/skills/tdd/SKILL.md');
});

test('a tree matching its manifest verifies clean', (t) => {
  assert.deepEqual(verifyManifest(matchingTree(t)), []);
});

test('one changed byte in a file entry is reported', (t) => {
  const root = matchingTree(t);
  writeFileSync(join(root, 'docs', 'a.txt'), 'hellO\n');
  const [mismatch, ...rest] = verifyManifest(root);
  assert.deepEqual(rest, []);
  assert.equal(mismatch.path, 'docs/a.txt');
  assert.equal(mismatch.expected, HELLO_SHA256);
  assert.match(mismatch.actual, /^[0-9a-f]{64}$/);
  assert.notEqual(mismatch.actual, HELLO_SHA256);
});

test('a replaced symlink target is reported', (t) => {
  const root = matchingTree(t);
  rmSync(join(root, 'link'));
  symlinkSync('./docs/a.txt', join(root, 'link'));
  assert.deepEqual(verifyManifest(root), [{ path: 'link', expected: 'docs/a.txt', actual: './docs/a.txt' }]);
});

test('a file replaced by a symlink is reported, even when the link resolves to identical bytes', (t) => {
  const root = matchingTree(t);
  writeFileSync(join(root, 'b.txt'), 'hello\n');
  rmSync(join(root, 'docs', 'a.txt'));
  symlinkSync('../b.txt', join(root, 'docs', 'a.txt'));
  const [mismatch, ...rest] = verifyManifest(root);
  assert.deepEqual(rest, []);
  assert.equal(mismatch.path, 'docs/a.txt');
  assert.match(mismatch.actual, /not a regular file/);
});

test('a file entry whose executable bit differs from its record is reported', (t) => {
  const root = matchingTree(t);
  put(root, 'run.sh', 'hello\n', 0o755);
  writeManifest(root, [
    { path: 'docs/a.txt', sha256: HELLO_SHA256 },
    { path: 'run.sh', sha256: HELLO_SHA256, executable: true },
  ]);
  assert.deepEqual(verifyManifest(root), []);
  chmodSync(join(root, 'run.sh'), 0o644);
  chmodSync(join(root, 'docs', 'a.txt'), 0o755);
  assert.deepEqual(verifyManifest(root), [
    { path: 'docs/a.txt', expected: 'not executable', actual: 'executable' },
    { path: 'run.sh', expected: 'executable', actual: 'not executable' },
  ]);
});

test('recording a file entry marks it executable only when the file is', (t) => {
  const root = matchingTree(t);
  put(root, 'run.sh', 'hello\n', 0o755);
  const entries = [
    { path: 'docs/a.txt', sha256: ZERO_SHA256, executable: true },
    { path: 'run.sh', sha256: ZERO_SHA256 },
  ];
  assert.deepEqual(computeEntries(root, { entries }), [
    { path: 'docs/a.txt', sha256: HELLO_SHA256 },
    { path: 'run.sh', sha256: HELLO_SHA256, executable: true },
  ]);
});

test('a missing path is reported as missing', (t) => {
  const root = matchingTree(t);
  rmSync(join(root, 'link'));
  rmSync(join(root, 'docs'), { recursive: true });
  assert.deepEqual(verifyManifest(root), [
    { path: 'docs/a.txt', expected: HELLO_SHA256, actual: 'missing' },
    { path: 'link', expected: 'docs/a.txt', actual: 'missing' },
  ]);
});

test('a missing, unparsable or malformed manifest fails loudly by name', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => readManifest(root), /cannot read \.agents\/factory-manifest\.json/);
  mkdirSync(join(root, '.agents'));
  writeFileSync(join(root, '.agents', 'factory-manifest.json'), '{');
  assert.throws(() => readManifest(root), /factory-manifest\.json is not valid JSON/);
  for (const entry of [
    { path: 'a', sha256: 'not-a-hash' },
    { path: 'a', symlink: '' },
    { path: 'a', sha256: HELLO_SHA256, symlink: 'b' },
    { path: 'a', region: 'other', sha256: HELLO_SHA256 },
    { path: '../a', sha256: HELLO_SHA256 },
    { path: 'a', sha256: HELLO_SHA256, executable: false },
    { path: 'a', sha256: HELLO_SHA256, executable: 'true' },
    { path: 'a', region: 'factory-shared', sha256: HELLO_SHA256, executable: true },
    { path: 'a', symlink: 'b', executable: true },
  ]) {
    writeManifest(root, [entry]);
    assert.throws(() => readManifest(root), /malformed manifest entry|invalid manifest path/, JSON.stringify(entry));
  }
});

test('a manifest that lists one path twice is refused, naming the path', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeManifest(root, [
    { path: 'docs/a.txt', sha256: HELLO_SHA256 },
    { path: 'link', symlink: 'docs/a.txt' },
    { path: 'docs/a.txt', symlink: 'elsewhere' },
  ]);
  assert.throws(() => readManifest(root), /\.agents\/factory-manifest\.json lists docs\/a\.txt more than once/);
});

// Refuses, with message, a manifest holding one file entry at each of the paths.
function assertPathsRefused(t, paths, message) {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeManifest(root, paths.map((path) => ({ path, sha256: HELLO_SHA256 })));
  assert.throws(() => readManifest(root), { message });
}

for (const [name, first, second] of [
  ['Case.txt and case.txt', 'Case.txt', 'case.txt'],
  ['one accented name in NFC and in NFD', 'docs/café.txt', 'docs/café.txt'],
]) {
  test(`a manifest that lists ${name} is refused as two paths naming one file, naming both`, (t) => {
    assertPathsRefused(
      t,
      ['other.txt', first, second],
      `.agents/factory-manifest.json lists ${first} and ${second}, which name the same file on a case-insensitive or Unicode-normalising disk`,
    );
  });
}

for (const [name, paths, ancestor, descendant] of [
  ['a and a/b', ['a', 'a/b'], 'a', 'a/b'],
  ['d/x before D', ['d/x', 'D'], 'D', 'd/x'],
]) {
  test(`a manifest that lists ${name} is refused as one path lying under another, naming both`, (t) => {
    assertPathsRefused(t, paths, `.agents/factory-manifest.json lists ${ancestor} and ${descendant}, and ${descendant} lies under ${ancestor}`);
  });
}

function regionTree(t, manual) {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'AGENTS.md'), manual);
  writeManifest(root, [{ path: 'AGENTS.md', region: 'factory-shared', sha256: REGION_SHA256 }]);
  return root;
}

test('a region edit is reported while an edit outside the region is not', (t) => {
  const outside = regionTree(t, `# Product manual\n${START}\nx\ny\n${END}\n## Product rules\n`);
  assert.deepEqual(verifyManifest(outside), []);
  writeFileSync(join(outside, 'AGENTS.md'), `# Other manual\n${START}\nx\ny\n${END}\n## Other rules\n`);
  assert.deepEqual(verifyManifest(outside), []);

  writeFileSync(join(outside, 'AGENTS.md'), `# Other manual\n${START}\nx\nY\n${END}\n## Other rules\n`);
  const [mismatch, ...rest] = verifyManifest(outside);
  assert.deepEqual(rest, []);
  assert.equal(mismatch.path, 'AGENTS.md');
  assert.equal(mismatch.expected, REGION_SHA256);
  assert.notEqual(mismatch.actual, REGION_SHA256);
});

for (const [name, manual] of [
  ['no start marker', `x\ny\n${END}\n`],
  ['no end marker', `${START}\nx\ny\n`],
  ['a duplicated start marker', `${START}\n${START}\nx\ny\n${END}\n`],
  ['a duplicated end marker', `${START}\nx\ny\n${END}\n${END}\n`],
  ['reversed markers', `${END}\nx\ny\n${START}\n`],
]) {
  test(`a region with ${name} throws the named malformed region markers error`, (t) => {
    assert.throws(() => verifyManifest(regionTree(t, manual)), /AGENTS\.md: malformed region markers/);
  });
}

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'factory-sync.mjs');
const ZERO_SHA256 = '0'.repeat(64);

// A git repository whose manifest records stale values for a region, a file and a symlink.
function staleRepository(t, origin) {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: root });
  if (origin) spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: root });
  writeFileSync(join(root, 'AGENTS.md'), `# Product manual\n${START}\nx\ny\n${END}\n`);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'a.txt'), 'hello\n');
  symlinkSync('docs/a.txt', join(root, 'link'));
  writeManifest(root, [
    { path: 'AGENTS.md', region: 'factory-shared', sha256: ZERO_SHA256 },
    { path: 'docs/a.txt', sha256: ZERO_SHA256 },
    { path: 'link', symlink: 'stale' },
  ]);
  return root;
}

const runCli = (root, ...args) => spawnSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8' });
const manifestBytes = (root) => readFileSync(join(root, '.agents', 'factory-manifest.json'), 'utf8');

test('without --write the CLI prints its usage and exits non-zero', (t) => {
  const run = runCli(staleRepository(t, 'https://github.com/example-owner/example-repo.git'));
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /usage: node scripts\/factory-sync\.mjs --write/);
});

test('--write refuses a repository whose origin is not the canonical, and one with no origin', (t) => {
  for (const origin of ['https://github.com/example-owner/adopter.git', undefined]) {
    const root = staleRepository(t, origin);
    const before = manifestBytes(root);
    const run = runCli(root, '--write');
    assert.notEqual(run.status, 0, `origin ${origin}`);
    assert.match(run.stderr, /refusing to --write: .* is not github\.com\/example-owner\/example-repo/);
    assert.equal(manifestBytes(root), before, 'a refused --write must leave the manifest untouched');
  }
});

test('--write in the canonical repository records every entry deterministically', (t) => {
  const root = staleRepository(t, 'https://github.com/example-owner/example-repo.git');
  const expected = `${JSON.stringify(
    {
      canonical: 'example-owner/example-repo',
      adopters: ['example-owner/adopter'],
      entries: [
        { path: 'AGENTS.md', region: 'factory-shared', sha256: REGION_SHA256 },
        { path: 'docs/a.txt', sha256: HELLO_SHA256 },
        { path: 'link', symlink: 'docs/a.txt' },
      ],
    },
    null,
    2,
  )}\n`;
  const first = runCli(root, '--write');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(manifestBytes(root), expected);

  spawnSync('git', ['remote', 'set-url', 'origin', 'git@github.com:example-owner/example-repo'], { cwd: root });
  const second = runCli(root, '--write');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(manifestBytes(root), expected, 'a second --write over unchanged files must yield identical bytes');
});

const CANONICAL = 'example-owner/example-repo';
const CANONICAL_URL = `https://github.com/${CANONICAL}`;
const ADOPTER_URL = 'https://github.com/example-owner/adopter';
const MANIFEST = '.agents/factory-manifest.json';
const GIT_ISOLATION = ['-c', 'user.name=Factory Test', '-c', 'user.email=factory@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

function git(root, ...args) {
  const run = spawnSync('git', ['-C', root, ...GIT_ISOLATION, ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
}

function commitAll(root) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'fixture');
}

function put(root, path, content, mode = 0o644) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  chmodSync(join(root, path), mode);
}

function link(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  symlinkSync(text, join(root, path));
}

function repository(root, origin) {
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'remote', 'add', 'origin', origin);
}

const SOURCE_ENTRIES = [
  { path: 'AGENTS.md', region: 'factory-shared', sha256: ZERO_SHA256 },
  { path: 'docs/a.txt', sha256: ZERO_SHA256 },
  { path: 'scripts/run.sh', sha256: ZERO_SHA256 },
  { path: 'link', symlink: 'stale' },
];

// Records the source's manifest from disk over the given entries, then commits the whole source.
function recordSource(source, entries) {
  writeManifest(source, computeEntries(source, { entries }));
  commitAll(source);
}

// A canonical source on main with a region, a plain file, an executable file and a symlink; an adopter target
// whose committed manifest names the canonical, whose shared file is a symlink to a file outside it, and whose
// script is not yet executable; and that outside directory.
function syncFixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sync-into-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const [source, target, outside] = ['source', 'target', 'outside'].map((name) => join(base, name));
  put(outside, 'secret.txt', 'outside\n');

  repository(source, CANONICAL_URL);
  put(source, 'AGENTS.md', `# Canonical manual\n${START}\nshared v2\n${END}\n## Canonical rules\n`);
  put(source, 'docs/a.txt', 'hello v2\n');
  put(source, 'scripts/run.sh', '#!/bin/sh\necho v2\n', 0o755);
  link(source, 'link', 'scripts/run.sh');
  recordSource(source, SOURCE_ENTRIES);

  repository(target, ADOPTER_URL);
  put(target, 'AGENTS.md', `# Adopter manual\n${START}\nshared v1\n${END}\n## Adopter rules\n`);
  link(target, 'docs/a.txt', '../../outside/secret.txt');
  put(target, 'scripts/run.sh', '#!/bin/sh\necho v1\n');
  put(target, MANIFEST, JSON.stringify({ canonical: CANONICAL, adopters: [], entries: [] }));
  commitAll(target);

  const fetchMain = (root) => git(root, 'rev-parse', 'refs/heads/main');
  return { source, target, outside, sync: (options) => syncInto({ source, target, fetchMain, ...options }) };
}

// Every path under root except .git (git status may refresh the index), with its kind, mode and bytes.
function snapshot(root) {
  const tree = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const path = relative(root, full);
      if (path === '.git') continue;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) tree[path] = `symlink ${readlinkSync(full)}`;
      else if (stat.isDirectory()) {
        tree[path] = 'directory';
        walk(full);
      } else tree[path] = `${(stat.mode & 0o777).toString(8)} ${readFileSync(full, 'base64')}`;
    }
  };
  walk(root);
  return tree;
}

function assertRefused(fixture, cause, options) {
  const before = [snapshot(fixture.target), snapshot(fixture.outside)];
  assert.throws(() => fixture.sync(options), cause);
  assert.deepEqual([snapshot(fixture.target), snapshot(fixture.outside)], before, 'a refused sync must write nothing');
}

test('a sync writes every shared file, symlink and region into the adopter and records the source commit', (t) => {
  const fixture = syncFixture(t);
  const at = (path) => join(fixture.target, path);
  const outsideBefore = snapshot(fixture.outside);

  assert.deepEqual(fixture.sync(), { files: 2, symlinks: 1, regions: 1 });

  assert.equal(readFileSync(at('AGENTS.md'), 'utf8'), `# Adopter manual\n${START}\nshared v2\n${END}\n## Adopter rules\n`);
  assert.ok(lstatSync(at('docs/a.txt')).isFile(), 'a shared file that was a symlink must become a regular file');
  assert.equal(readFileSync(at('docs/a.txt'), 'utf8'), 'hello v2\n');
  assert.equal(lstatSync(at('docs/a.txt')).mode & 0o777, 0o644);
  assert.equal(readFileSync(at('scripts/run.sh'), 'utf8'), '#!/bin/sh\necho v2\n');
  assert.equal(lstatSync(at('scripts/run.sh')).mode & 0o777, 0o755, 'the executable bit must follow the source');
  assert.equal(readlinkSync(at('link')), 'scripts/run.sh');
  assert.deepEqual(snapshot(fixture.outside), outsideBefore, 'the file the old symlink pointed at must be untouched');

  const { canonical, adopters, entries } = JSON.parse(readFileSync(join(fixture.source, MANIFEST), 'utf8'));
  const syncedFrom = git(fixture.source, 'rev-parse', 'HEAD');
  assert.equal(readFileSync(at(MANIFEST), 'utf8'), `${JSON.stringify({ canonical, adopters, syncedFrom, entries }, null, 2)}\n`);
  assert.deepEqual(verifyManifest(fixture.target), []);
});

test('a sync leaves in place, byte for byte, a file the target\'s previous manifest listed and the fetched one does not', (t) => {
  const fixture = syncFixture(t);
  put(fixture.target, 'docs/retired.txt', 'retired\n', 0o755);
  put(fixture.target, MANIFEST, JSON.stringify({ canonical: CANONICAL, adopters: [], entries: [{ path: 'docs/retired.txt', sha256: ZERO_SHA256 }] }));
  commitAll(fixture.target);
  const before = snapshot(fixture.target)['docs/retired.txt'];
  fixture.sync();
  assert.equal(snapshot(fixture.target)['docs/retired.txt'], before);
});

test('a manifest entry that climbs out of the tree is refused', (t) => {
  const fixture = syncFixture(t);
  writeManifest(fixture.source, [...computeEntries(fixture.source, { entries: SOURCE_ENTRIES }), { path: '../x', sha256: HELLO_SHA256 }]);
  commitAll(fixture.source);
  assertRefused(fixture, /invalid manifest path "\.\.\/x"/);
});

test('an entry whose parent in the target is a symlink to a directory outside it is refused', (t) => {
  const fixture = syncFixture(t);
  put(fixture.source, 'evil/x.txt', 'x\n');
  recordSource(fixture.source, [...SOURCE_ENTRIES, { path: 'evil/x.txt', sha256: ZERO_SHA256 }]);
  link(fixture.target, 'evil', '../outside');
  commitAll(fixture.target);
  assertRefused(fixture, /evil\/x\.txt: .*outside the target/);
});

// Through `docs/sub -> ..` the entry would land at the target's l, where its text ../../y leaves the target.
test('a symlink entry whose parent in the target is a symlink back up the target is refused', (t) => {
  const fixture = syncFixture(t);
  link(fixture.source, 'docs/sub/l', '../../y');
  recordSource(fixture.source, [...SOURCE_ENTRIES, { path: 'docs/sub/l', symlink: 'stale' }]);
  link(fixture.target, 'docs/sub', '..');
  commitAll(fixture.target);
  assertRefused(fixture, /docs\/sub\/l: its parent .*\/docs\/sub is a symlink/);
});

test('a file entry whose parent in the target is a symlink to a directory inside it is refused', (t) => {
  const fixture = syncFixture(t);
  put(fixture.source, 'alias/x.txt', 'x\n');
  recordSource(fixture.source, [...SOURCE_ENTRIES, { path: 'alias/x.txt', sha256: ZERO_SHA256 }]);
  link(fixture.target, 'alias', 'docs');
  commitAll(fixture.target);
  assertRefused(fixture, /alias\/x\.txt: its parent .*\/alias is a symlink/);
  assert.equal(lstatSync(join(fixture.target, 'docs', 'x.txt'), { throwIfNoEntry: false }), undefined, 'nothing may land at the symlink destination');
});

for (const [name, text] of [
  ['climbs out of the target', '../../outside'],
  ['is absolute', null],
]) {
  test(`a symlink entry whose link text ${name} is refused`, (t) => {
    const fixture = syncFixture(t);
    link(fixture.source, 'docs/escape', text ?? fixture.outside);
    recordSource(fixture.source, [...SOURCE_ENTRIES, { path: 'docs/escape', symlink: 'stale' }]);
    assertRefused(fixture, text ? /docs\/escape: .*link text .*outside the target/ : /docs\/escape: .*absolute link text/);
  });
}

// A fixture whose target commits `pre`, made by makePre and by default a symlink to the outside directory, and whose
// source shares a symlink docs/tool with the given link text.
function throughPre(t, text, makePre = (target) => link(target, 'pre', '../outside')) {
  const fixture = syncFixture(t);
  makePre(fixture.target);
  commitAll(fixture.target);
  link(fixture.source, 'docs/tool', text);
  recordSource(fixture.source, [...SOURCE_ENTRIES, { path: 'docs/tool', symlink: 'stale' }]);
  return fixture;
}

test('a symlink entry whose link text leads through an outward symlink to a path that does not exist yet is refused', (t) => {
  assertRefused(throughPre(t, '../pre/not-yet/tool'), /docs\/tool: link text \.\.\/pre\/not-yet\/tool resolves to .*outside the target/);
});

test('a symlink entry whose link text leads through an outward symlink to an existing file is refused', (t) => {
  assertRefused(throughPre(t, '../pre/secret.txt'), /docs\/tool: link text \.\.\/pre\/secret\.txt resolves to .*outside the target/);
});

test('a symlink entry whose link text leads through a dangling symlink is refused', (t) => {
  const fixture = throughPre(t, '../pre/tool', (target) => link(target, 'pre', '../outside/not-yet'));
  assertRefused(fixture, /docs\/tool: link text \.\.\/pre\/tool resolves to \(nowhere\), outside the target/);
});

test('a symlink entry whose link text leads through a regular file is refused', (t) => {
  const fixture = throughPre(t, '../pre/tool', (target) => put(target, 'pre', 'plain\n'));
  assertRefused(fixture, /docs\/tool: link text \.\.\/pre\/tool resolves to \(nowhere\), outside the target/);
});

// Nothing is written until everything is validated, so the link's destination does not exist yet when its text is
// checked, even though the file entry that creates it is listed after it.
test('a first sync into an empty target accepts a symlink entry whose destination the same sync creates', (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sync-first-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const [source, target] = ['source', 'target'].map((name) => join(base, name));
  repository(source, CANONICAL_URL);
  link(source, '.claude/skills/x', '../../.agents/skills/x');
  put(source, '.agents/skills/x/SKILL.md', 'skill\n');
  recordSource(source, [
    { path: '.claude/skills/x', symlink: 'stale' },
    { path: '.agents/skills/x/SKILL.md', sha256: ZERO_SHA256 },
  ]);
  repository(target, ADOPTER_URL);
  commitAll(target);

  const fetchMain = (root) => git(root, 'rev-parse', 'refs/heads/main');
  assert.deepEqual(syncInto({ source, target, canonical: CANONICAL, fetchMain }), { files: 1, symlinks: 1, regions: 0 });

  assert.equal(realpathSync(join(target, '.claude/skills/x')), join(target, '.agents/skills/x'));
  assert.deepEqual(verifyManifest(target), []);
});

test('a non-empty directory where a symlink entry goes is refused', (t) => {
  const fixture = syncFixture(t);
  put(fixture.target, 'link/kept.txt', 'kept\n');
  commitAll(fixture.target);
  assertRefused(fixture, /link: .*non-empty directory/);
});

test('a source whose HEAD is not its freshly fetched origin main is refused', (t) => {
  const fixture = syncFixture(t);
  git(fixture.source, 'checkout', '-q', '-b', 'job/branch');
  git(fixture.source, 'commit', '-q', '--allow-empty', '-m', 'job work');
  assertRefused(fixture, /not on its freshly fetched origin main/);
});

test('a failed fetch of the source origin main is refused', (t) => {
  const fixture = syncFixture(t);
  const fetchMain = () => {
    throw new Error('could not resolve host');
  };
  assertRefused(fixture, /cannot fetch the source's origin main \(could not resolve host\)/, { fetchMain });
});

for (const [name, dirty] of [
  ['a modified shared file', (source) => put(source, 'docs/a.txt', 'edited\n')],
  [
    'an untracked file at a manifest path',
    (source) => {
      put(source, 'docs/new.txt', 'new\n');
      writeManifest(source, computeEntries(source, { entries: [...SOURCE_ENTRIES, { path: 'docs/new.txt', sha256: ZERO_SHA256 }] }));
      git(source, 'add', MANIFEST);
      git(source, 'commit', '-q', '-m', 'record without the file');
    },
  ],
]) {
  test(`a source with ${name} is refused as uncommitted`, (t) => {
    const fixture = syncFixture(t);
    dirty(fixture.source);
    assertRefused(fixture, /the source has uncommitted changes at shared paths: .*docs\/(a|new)\.txt/);
  });
}

test('a source that fails its own manifest is refused, naming the mismatched path', (t) => {
  const fixture = syncFixture(t);
  put(fixture.source, 'docs/a.txt', 'drift\n');
  commitAll(fixture.source);
  assertRefused(fixture, /the source does not match its own manifest at docs\/a\.txt/);
});

test('a source whose origin is not the canonical is refused', (t) => {
  const fixture = syncFixture(t);
  git(fixture.source, 'remote', 'set-url', 'origin', 'https://github.com/example-owner/fork');
  assertRefused(fixture, /the source's origin https:\/\/github\.com\/example-owner\/fork is not github\.com\/example-owner\/example-repo/);
});

test('a source with no origin remote is refused', (t) => {
  const fixture = syncFixture(t);
  git(fixture.source, 'remote', 'remove', 'origin');
  assertRefused(fixture, /the source has no origin remote/);
});

test('a target whose origin is the canonical is refused', (t) => {
  const fixture = syncFixture(t);
  git(fixture.target, 'remote', 'set-url', 'origin', 'git@github.com:example-owner/example-repo.git');
  assertRefused(fixture, /never sync into the canonical/);
});

test('a --canonical that disagrees with the target\'s committed manifest is refused', (t) => {
  assertRefused(syncFixture(t), /--canonical example-owner\/other disagrees with/, { canonical: 'example-owner/other' });
});

test('a target with no committed manifest needs --canonical, and syncs with it', (t) => {
  const fixture = syncFixture(t);
  git(fixture.target, 'rm', '-q', MANIFEST);
  commitAll(fixture.target);
  assertRefused(fixture, /no canonical repository/);
  fixture.sync({ canonical: CANONICAL });
  assert.deepEqual(verifyManifest(fixture.target), []);
});

for (const [name, manual] of [
  ['missing markers', '# Adopter manual\n'],
  ['duplicated markers', `${START}\n${START}\nx\n${END}\n`],
  ['no manual at all', null],
]) {
  test(`a target AGENTS.md with ${name} is refused as malformed region markers`, (t) => {
    const fixture = syncFixture(t);
    if (manual === null) rmSync(join(fixture.target, 'AGENTS.md'));
    else put(fixture.target, 'AGENTS.md', manual);
    commitAll(fixture.target);
    assertRefused(fixture, /target AGENTS\.md: malformed region markers/);
  });
}

test('a target AGENTS.md that is a symlink is refused, even to a manual with well-formed markers', (t) => {
  const fixture = syncFixture(t);
  put(fixture.outside, 'manual.md', `# Outside manual\n${START}\nshared v1\n${END}\n`);
  rmSync(join(fixture.target, 'AGENTS.md'));
  link(fixture.target, 'AGENTS.md', '../outside/manual.md');
  commitAll(fixture.target);
  assertRefused(fixture, /AGENTS\.md/);
});

test('a sync gives each file its committed mode, whatever the mode in the source working tree', (t) => {
  const fixture = syncFixture(t);
  git(fixture.source, 'config', 'core.fileMode', 'false');
  chmodSync(join(fixture.source, 'scripts', 'run.sh'), 0o644);
  chmodSync(join(fixture.source, 'docs', 'a.txt'), 0o755);
  assert.equal(git(fixture.source, 'status', '--porcelain'), '', 'the mode change must be invisible to git status');
  fixture.sync();
  assert.equal(lstatSync(join(fixture.target, 'scripts', 'run.sh')).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(fixture.target, 'docs', 'a.txt')).mode & 0o777, 0o644);
});

test('a source commit whose file mode differs from its manifest is refused, naming the path', (t) => {
  const fixture = syncFixture(t);
  chmodSync(join(fixture.source, 'scripts', 'run.sh'), 0o644);
  commitAll(fixture.source);
  assertRefused(fixture, /the source does not match its own manifest at scripts\/run\.sh in its commit/);
});

test('a source AGENTS.md with malformed markers is refused', (t) => {
  const fixture = syncFixture(t);
  put(fixture.source, 'AGENTS.md', `# Canonical manual\nshared v2\n${END}\n`);
  commitAll(fixture.source);
  assertRefused(fixture, /^Error: AGENTS\.md: malformed region markers/);
});

test('a target with uncommitted changes at a manifest path is refused', (t) => {
  const fixture = syncFixture(t);
  put(fixture.target, 'scripts/run.sh', 'local edit\n');
  assertRefused(fixture, /the target has uncommitted changes at shared paths: .*scripts\/run\.sh/);
});

// Commits the source's manifest with its canonical replaced.
function recanonicalise(source, canonical) {
  put(source, MANIFEST, JSON.stringify({ ...readManifest(source), canonical }));
  commitAll(source);
}

test('a source manifest that names another canonical is refused', (t) => {
  const fixture = syncFixture(t);
  recanonicalise(fixture.source, 'example-owner/other');
  assertRefused(fixture, /the source's manifest names the canonical example-owner\/other, not example-owner\/example-repo/);
});

test('a source manifest naming the canonical in another case syncs and records the target\'s canonical', (t) => {
  const fixture = syncFixture(t);
  recanonicalise(fixture.source, 'Example-Owner/Example-Repo');
  fixture.sync();
  assert.equal(readManifest(fixture.target).canonical, CANONICAL);
});

// Runs fn with the given environment variables set, restoring the previous environment afterwards.
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// The source's committed scripts/run.sh, as syncFixture writes it.
const COMMITTED_RUN = '#!/bin/sh\necho v2\n';

// Rewrites the source's shared script and re-records the manifest over it, in the working tree only.
function tamper(source) {
  put(source, 'scripts/run.sh', '#!/bin/sh\necho tampered\n', 0o755);
  writeManifest(source, computeEntries(source, { entries: SOURCE_ENTRIES }));
}

// Runs the sync under env: it either refuses, writing nothing, or writes the source's committed bytes.
function assertCommittedOrRefused(fixture, env) {
  const before = [snapshot(fixture.target), snapshot(fixture.outside)];
  let refused = false;
  try {
    withEnv(env, () => fixture.sync());
  } catch {
    refused = true;
  }
  if (refused) assert.deepEqual([snapshot(fixture.target), snapshot(fixture.outside)], before, 'a refused sync must write nothing');
  else assert.equal(readFileSync(join(fixture.target, 'scripts/run.sh'), 'utf8'), COMMITTED_RUN, 'the sync wrote bytes the source never committed');
}

test('a tampered shared file and manifest hidden from git status by skip-worktree are never synced; the committed bytes are', (t) => {
  const fixture = syncFixture(t);
  const committed = JSON.parse(git(fixture.source, 'show', `HEAD:${MANIFEST}`));
  tamper(fixture.source);
  git(fixture.source, 'update-index', '--skip-worktree', 'scripts/run.sh', MANIFEST);
  assert.equal(git(fixture.source, 'status', '--porcelain'), '', 'the tamper must be hidden from git status');

  fixture.sync();

  assert.equal(readFileSync(join(fixture.target, 'scripts/run.sh'), 'utf8'), COMMITTED_RUN);
  assert.deepEqual(readManifest(fixture.target).entries, committed.entries);
});

// The hostile value is relative, so each repository reads its own copy: an absolute one would give the target the
// source's index, which fails the target's status check and hides whether the source's tamper was synced.
test('an inherited GIT_INDEX_FILE that hides a tamper cannot change what is synced', (t) => {
  const fixture = syncFixture(t);
  const hostile = { GIT_INDEX_FILE: '.git/hostile-index' };
  for (const root of [fixture.source, fixture.target]) cpSync(join(root, '.git', 'index'), join(root, hostile.GIT_INDEX_FILE));
  withEnv(hostile, () => git(fixture.source, 'update-index', '--skip-worktree', 'scripts/run.sh', MANIFEST));
  tamper(fixture.source);
  assertCommittedOrRefused(fixture, hostile);
});

// The hostile value is relative, so the target's copy can be the target's own repository while the source's is a
// copy whose main commits a tamper; an absolute one would point both at one repository, which the origin checks
// refuse whatever the environment.
test('an inherited GIT_DIR cannot redirect the sync to another repository', (t) => {
  const fixture = syncFixture(t);
  const hostile = { GIT_DIR: 'hostile.git' };
  cpSync(join(fixture.source, '.git'), join(fixture.source, hostile.GIT_DIR), { recursive: true });
  symlinkSync('.git', join(fixture.target, hostile.GIT_DIR));
  withEnv(hostile, () => {
    tamper(fixture.source);
    git(fixture.source, 'add', '--', 'scripts/run.sh', MANIFEST);
    git(fixture.source, 'commit', '-q', '-m', 'hostile');
  });
  assertCommittedOrRefused(fixture, hostile);
});

test('fetchMain returns the origin main tip of a clone that is behind it', (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sync-fetch-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const [origin, work, clone] = ['origin.git', 'work', 'clone'].map((name) => join(base, name));
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  repository(work, origin);
  put(work, 'a.txt', 'one\n');
  commitAll(work);
  git(work, 'push', '-q', 'origin', 'main');
  git(base, 'clone', '-q', origin, clone);
  put(work, 'a.txt', 'two\n');
  commitAll(work);
  git(work, 'push', '-q', 'origin', 'main');
  const tip = git(origin, 'rev-parse', 'main');
  assert.notEqual(git(clone, 'rev-parse', 'HEAD'), tip, 'the clone must start behind its origin');
  assert.equal(fetchMain(clone), tip);
});

// GIT_ALLOW_PROTOCOL=file makes the fixture's https origin unreachable without touching the network.
const NO_NETWORK = { GIT_ALLOW_PROTOCOL: 'file' };

test('fetchMain throws for an unreachable origin, and a sync that uses it writes nothing', (t) => {
  const fixture = syncFixture(t);
  withEnv(NO_NETWORK, () => {
    assert.throws(() => fetchMain(fixture.source), /transport 'https' not allowed/);
    assertRefused(fixture, /cannot fetch the source's origin main \(.*transport 'https' not allowed/, { fetchMain });
  });
});

// A successful --from cannot be proven here without the network: the origin check reads `git remote get-url`, which
// expands any insteadOf rewrite, so a local origin can never pass as github.com/<canonical>.
test('--from reaches the real fetch and, when it fails, exits 1 naming it and leaves the target unchanged', (t) => {
  const fixture = syncFixture(t);
  const before = snapshot(fixture.target);
  const run = spawnSync(process.execPath, [CLI, '--from', fixture.source], {
    cwd: fixture.target,
    encoding: 'utf8',
    env: { ...process.env, ...NO_NETWORK },
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /^factory-sync: cannot fetch the source's origin main \(.*transport 'https' not allowed/);
  assert.deepEqual(snapshot(fixture.target), before, 'a refused --from must write nothing');
});

test('--from with no value, or an unknown flag, prints the usage for both modes and exits 2', (t) => {
  const root = staleRepository(t, CANONICAL_URL);
  for (const args of [['--from'], ['--from', root, '--bogus', 'x'], ['--into', root]]) {
    const run = runCli(root, ...args);
    assert.equal(run.status, 2, args.join(' '));
    assert.match(run.stderr, /usage: .*--write .*--from <source> \[--into <target>\] \[--canonical <owner\/repo>\]/);
  }
});

test('--from the repository it runs in is refused as the same repository', (t) => {
  const root = staleRepository(t, ADOPTER_URL);
  const run = runCli(root, '--from', join(root, 'docs'));
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /^factory-sync: the source and target are the same repository/);
});

const LAG_MANIFEST = {
  canonical: CANONICAL,
  adopters: ['example-owner/adopter'],
  entries: [
    { path: 'a.txt', sha256: HELLO_SHA256 },
    { path: 'link', symlink: 'a.txt' },
    { path: 'AGENTS.md', region: 'factory-shared', sha256: REGION_SHA256 },
  ],
};

// Checks a local manifest (an object, raw text, or null for none) against the canonical's manifest text.
function lag(t, local, fetchCanonicalManifest) {
  const root = mkdtempSync(join(tmpdir(), 'factory-sync-lag-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (local !== null) put(root, MANIFEST, typeof local === 'string' ? local : JSON.stringify(local));
  return checkLag({ root, fetchCanonicalManifest });
}

const remote = (manifest) => () => JSON.stringify(manifest);
const withEntries = (entries) => ({ ...LAG_MANIFEST, entries });
const [A, LINK, REGION] = LAG_MANIFEST.entries;

test('a local manifest matching the canonical main, apart from syncedFrom, is in sync', (t) => {
  const asked = [];
  const fetch = (canonical) => {
    asked.push(canonical);
    return JSON.stringify(LAG_MANIFEST);
  };
  assert.deepEqual(lag(t, { ...LAG_MANIFEST, syncedFrom: 'abc123' }, fetch), { state: 'in-sync', differences: [], cause: null });
  assert.deepEqual(asked, [CANONICAL]);
});

for (const [name, canonicalMain, differences] of [
  ['a changed hash', withEntries([{ ...A, sha256: ZERO_SHA256 }, LINK, REGION]), ['a.txt: changed']],
  ['a changed symlink text', withEntries([A, { ...LINK, symlink: 'b.txt' }, REGION]), ['link: changed']],
  ['a changed executable bit', withEntries([{ ...A, executable: true }, LINK, REGION]), ['a.txt: changed']],
  ['an entry missing here', withEntries([A, LINK, REGION, { path: 'docs/new.md', sha256: HELLO_SHA256 }]), ['docs/new.md: missing here']],
  ['an entry no longer shared', withEntries([A, REGION]), ['link: no longer shared']],
  [
    'a different adopters list',
    { ...LAG_MANIFEST, adopters: ['example-owner/adopter', 'example-owner/other'] },
    ['adopters: example-owner/adopter here, example-owner/adopter, example-owner/other on main'],
  ],
  [
    'a different canonical',
    { ...LAG_MANIFEST, canonical: 'example-owner/renamed' },
    ['canonical: example-owner/example-repo here, example-owner/renamed on main'],
  ],
  [
    'several differences, listed by path',
    withEntries([{ path: 'z.txt', sha256: HELLO_SHA256 }, { ...REGION, sha256: ZERO_SHA256 }, A]),
    ['AGENTS.md: changed', 'link: no longer shared', 'z.txt: missing here'],
  ],
]) {
  test(`${name} is reported as drifted`, (t) => {
    assert.deepEqual(lag(t, LAG_MANIFEST, remote(canonicalMain)), { state: 'drifted', differences, cause: null });
  });
}

for (const [name, local, fetch, cause] of [
  [
    'a failed fetch of the canonical manifest',
    LAG_MANIFEST,
    () => {
      throw new Error('gh is not installed');
    },
    /^cannot fetch example-owner\/example-repo main's \.agents\/factory-manifest\.json \(gh is not installed\)$/,
  ],
  ['a canonical manifest that is not JSON', LAG_MANIFEST, () => '<html>', /main's \.agents\/factory-manifest\.json is not valid JSON/],
  [
    'a canonical manifest with a malformed entry',
    LAG_MANIFEST,
    remote(withEntries([A, { path: '../x', sha256: HELLO_SHA256 }])),
    /invalid manifest path "\.\.\/x"/,
  ],
  [
    'a canonical manifest that lists one path twice',
    LAG_MANIFEST,
    remote(withEntries([A, LINK, REGION, A])),
    /^example-owner\/example-repo main's \.agents\/factory-manifest\.json lists a\.txt more than once$/,
  ],
  [
    'a canonical manifest that lists two paths naming one file',
    LAG_MANIFEST,
    remote(withEntries([A, LINK, REGION, { ...A, path: 'A.txt' }])),
    /^example-owner\/example-repo main's \.agents\/factory-manifest\.json lists a\.txt and A\.txt, which name the same file on a case-insensitive or Unicode-normalising disk$/,
  ],
  [
    'a canonical manifest that lists one path under another',
    LAG_MANIFEST,
    remote(withEntries([A, LINK, REGION, { path: 'Link/x', sha256: HELLO_SHA256 }])),
    /^example-owner\/example-repo main's \.agents\/factory-manifest\.json lists link and Link\/x, and Link\/x lies under link$/,
  ],
  ['no local manifest', null, remote(LAG_MANIFEST), /^no factory manifest here; run the first sync with --from$/],
  ['a malformed local manifest', '{', remote(LAG_MANIFEST), /^\.agents\/factory-manifest\.json is not valid JSON/],
]) {
  test(`${name} leaves the sync state unknown, never in sync`, (t) => {
    const result = lag(t, local, fetch);
    assert.equal(result.state, 'unknown');
    assert.deepEqual(result.differences, []);
    assert.match(result.cause, cause);
  });
}

test('--check with any other argument prints the usage for all three modes and exits 2', (t) => {
  const run = runCli(staleRepository(t, ADOPTER_URL), '--check', 'extra');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^usage: node scripts\/factory-sync\.mjs --write \| --check \| --from <source>/);
});

test('--check without gh on the PATH reports the sync state unknown and exits 2', (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sync-check-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'adopter');
  repository(root, ADOPTER_URL);
  put(root, MANIFEST, JSON.stringify(LAG_MANIFEST));
  // A PATH holding git alone, so the check reaches the fetch and gh is the only thing missing.
  const bin = join(base, 'bin');
  mkdirSync(bin);
  symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), join(bin, 'git'));
  const run = spawnSync(process.execPath, [CLI, '--check'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin } });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /^factory-sync: sync state unknown: cannot fetch example-owner\/example-repo main's .*\(gh is not installed\)$/m);
});

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The arguments of the one gh call --check makes for canonical's manifest on main.
const contentsCall = (canonical) => [
  'api',
  '--hostname',
  'github.com',
  `repos/${canonical}/contents/${MANIFEST}?ref=main`,
  '-H',
  'Accept: application/vnd.github.raw+json',
];

// Runs --check in root with a fake gh first on the PATH. The fake logs every call's arguments and answers only the
// contents call for canonical's manifest, printing manifestText; any other call exits 1. Returns the run and the
// logged calls.
function checkWithFakeGh(t, root, canonical, manifestText) {
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sync-gh-')));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const [calls, answer] = [join(bin, 'calls'), join(bin, 'answer')];
  writeFileSync(answer, manifestText);
  put(
    bin,
    'gh',
    `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (JSON.stringify(args) !== ${JSON.stringify(JSON.stringify(contentsCall(canonical)))}) {
  process.stderr.write('unexpected gh call\\n');
  process.exit(1);
}
process.stdout.write(readFileSync(${JSON.stringify(answer)}, 'utf8'));
`,
    0o755,
  );
  const run = spawnSync(process.execPath, [CLI, '--check'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const logged = readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { run, calls: logged };
}

test('--check asks gh for the canonical manifest on github.com, never the configured default host', (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-sync-check-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'adopter');
  repository(root, ADOPTER_URL);
  put(root, MANIFEST, JSON.stringify(LAG_MANIFEST));
  const { run, calls } = checkWithFakeGh(t, root, CANONICAL, JSON.stringify(LAG_MANIFEST));
  assert.deepEqual(calls, [contentsCall(CANONICAL)]);
  assert.equal(run.status, 0, run.stderr);
});

test('--check exits 0 and prints in sync when the canonical main holds this repository\'s manifest', (t) => {
  const text = readFileSync(join(REPOSITORY_ROOT, MANIFEST), 'utf8');
  const { canonical } = JSON.parse(text);
  const { run } = checkWithFakeGh(t, REPOSITORY_ROOT, canonical, text);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^factory-sync: in sync with ${canonical} main$`, 'm'));
});

test('--check exits 1 and lists the changed path when one canonical entry differs', (t) => {
  const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, MANIFEST), 'utf8'));
  const changed = manifest.entries.find((entry) => 'sha256' in entry);
  const entries = manifest.entries.map((entry) => (entry === changed ? { ...entry, sha256: ZERO_SHA256 } : entry));
  const { run } = checkWithFakeGh(t, REPOSITORY_ROOT, manifest.canonical, JSON.stringify({ ...manifest, entries }));
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /^factory-sync: behind /m);
  assert.deepEqual(
    run.stderr.split('\n').filter((line) => line.startsWith('  ')),
    [`  ${changed.path}: changed`],
  );
});
