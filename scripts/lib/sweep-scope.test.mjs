// sweep-scope.test.mjs — the pull-request guard for the inactive documentation sweep's scope.
//
// The sweep lands its own pull request, so no one reads it before it merges; these tests are the
// evidence that the two rules docs/DOC-SWEEP.md used to leave to the owner's eyes now fail the
// guard mechanically. The pure functions are tested on the real manual and on synthetic
// tables; the script is run end-to-end against a throwaway Git repository so a stubbed check, a
// head-tree manual read, or a swallowed Git error each goes red here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedNetworkTokens, outOfScope, parseMayEdit, renderedLinkMarkup } from './sweep-scope.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANUAL = readFileSync(join(ROOT, 'docs/DOC-SWEEP.md'), 'utf8');
const SCRIPT = join(ROOT, 'scripts/sweep-scope-check.mjs');

test('parseMayEdit reads exactly the may-edit column of the live manual', () => {
  assert.deepEqual(parseMayEdit(MANUAL), [
    'CONTEXT.md',
    'docs/AI-WORKFLOW.md',
  ]);
});

test('parseMayEdit takes only the left column and fails loud on a missing or empty table', () => {
  const table = [
    '| May edit | Never edit |',
    '|---|---|',
    '| plain prose, **planned.md**, **important**, `a.md`, `b/c.md` | `d.md` |',
    '| | `e.md`, `f/` |',
    '',
    '| Area | Owning document |',
    '|---|---|',
    '| x | `z.md` |',
  ].join('\n');
  assert.deepEqual(parseMayEdit(table), ['a.md', 'b/c.md']);
  assert.throws(() => parseMayEdit('# no table here'), /scope table/);
  assert.throws(() => parseMayEdit('| May edit | Never edit |\n|---|---|\n| | `d.md` |\n'), /empty/);
});

test('outOfScope is an exact-path match, so a shared prefix never admits a never-edit path', () => {
  const mayEdit = ['workers/README.md', 'docs/ARCHITECTURE.md'];
  assert.deepEqual(outOfScope(['workers/README.md', 'docs/ARCHITECTURE.md'], mayEdit), []);
  assert.deepEqual(
    outOfScope(['workers/events-relay.js', 'docs/ARCHITECTURE.md.bak', 'docs/DOC-SWEEP.md'], mayEdit),
    ['workers/events-relay.js', 'docs/ARCHITECTURE.md.bak', 'docs/DOC-SWEEP.md'],
  );
});

test('addedNetworkTokens sees URIs and bare host names on added lines only', () => {
  const diff = [
    'diff --git a/docs/X.md b/docs/X.md',
    '--- a/docs/X.md',
    '+++ b/docs/X.md https://in-a-header.example.com is not content',
    '@@ -1,3 +1,4 @@',
    ' unchanged https://kept.example.com/path',
    '-removed https://gone.example.org',
    '+added https://new.example.com/a?b=1 and mailto:someone@example.io twice: https://new.example.com/a?b=1',
    '+a bare host flowgauge.app and registry.npmjs.org, but not package.json, index.html, or board.mjs',
    '+a label such as type:bug or Status:Done is not a link',
    '+italics hide nothing: _collector.example.net_ and _https://evil.example.org/x_ are seen',
    '+++ b/an added line forged to look like a header is content, so https://plus.example.com counts',
    '+a rarer domain is seen only inside a full URI: https://drop.example.zw/in but not drop.example.zw',
    '+a widened domain counts bare: tracker.example.eu; wildcards too: *.wild.example.org and .dot.example.net',
    '+bold markers are prose: **https://bold.example.com** and *https://star.example.com*',
    '+GitHub autolinks www.auto.example.com without a scheme',
  ].join('\n');
  assert.deepEqual(addedNetworkTokens(diff), [
    'https://new.example.com/a?b=1',
    'mailto:someone@example.io',
    'flowgauge.app',
    'registry.npmjs.org',
    'https://evil.example.org/x',
    'collector.example.net',
    'https://plus.example.com',
    'https://drop.example.zw/in',
    'tracker.example.eu',
    'wild.example.org',
    'dot.example.net',
    'https://bold.example.com',
    'https://star.example.com',
    'www.auto.example.com',
  ]);
});

test('renderedLinkMarkup refuses the shapes GitHub renders into a link the text does not show', () => {
  const diff = [
    'diff --git a/docs/X.md b/docs/X.md',
    '--- a/docs/X.md',
    '+++ b/docs/X.md',
    '@@ -1,2 +1,6 @@',
    ' context [kept](https:&#47;&#47;kept.example.com) is not added',
    '+ordinary entities are prose: a &amp; b &lt; c &gt; d &quot;e&quot; f&nbsp;g',
    '+an encoded destination: [the collector](https:&#47;&#47;collector&#46;example&#46;com&#47;in) and &#x2F; and &sol;',
    '+a backslash destination: [x](https:\\/\\/collector.example.icu/in) but a regex \\. in prose is fine',
    '+a protocol-relative destination: [x](//collector.example.icu/in)',
    '+a spaced destination [x]( //spaced.example.icu) and an angled one [y](<//angled.example.icu>)',
    '+a destination on the next line: [z](',
    '+//split.example.icu/in) closes it',
    '+[ref]: //reference.example.icu/in',
    '+[esc]: <https:\\/\\/escaped.example.icu>',
    '+raw html <a href="//raw.example.icu/in">x</a> and <img src=\'https:\\/\\/img.example.icu/p.gif\'>',
    '+a plain link [ok](https://plain.example.com/path) and a plain definition [fine]: https://fine.example.com are not markup',
  ].join('\n');
  assert.deepEqual([...renderedLinkMarkup(diff)].sort(), [
    '&#46;', '&#47;', '&#x2F;', '&sol;',
    '//angled.example.icu', '//collector.example.icu/in', '//raw.example.icu/in', '//reference.example.icu/in',
    '](', '](',
    'https:\\/\\/collector.example.icu/in', 'https:\\/\\/escaped.example.icu', 'https:\\/\\/img.example.icu/p.gif',
  ].filter((v, i, a) => a.indexOf(v) === i).sort());
});

// A throwaway repository whose base commit carries a two-row scope table and one allowed document.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-scope-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  write('docs/DOC-SWEEP.md', '# manual\n\n| May edit | Never edit |\n|---|---|\n| `docs/ALLOWED.md` | `docs/DOC-SWEEP.md`, `src/` |\n');
  write('docs/ALLOWED.md', 'The app lives at https://app.flowgauge.app and nowhere else.\n');
  write('src/code.js', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  const commit = (label) => {
    git('add', '-A');
    git('commit', '-q', '-m', label);
    return git('rev-parse', 'HEAD');
  };
  const check = (head) => spawnSync('node', [SCRIPT, base, head], { cwd: dir, encoding: 'utf8' });
  return { git, write, commit, check, base, dir };
}

test('the check passes a diff confined to the may-edit column that reuses a known host', () => {
  const r = repo();
  r.write('docs/ALLOWED.md', 'The app lives at https://app.flowgauge.app; see app.flowgauge.app for the hosted build.\n');
  const result = r.check(r.commit('allowed edit'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 modified path/);
});

test('the check fails a diff that touches a path outside the may-edit column, naming the path', () => {
  const r = repo();
  r.write('src/code.js', 'export const x = 2;\n');
  const result = r.check(r.commit('code edit'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/code\.js/);
});

test('the check fails a diff that introduces a URI the base tree does not carry, naming it', () => {
  const r = repo();
  r.write('docs/ALLOWED.md', 'The app lives at https://app.flowgauge.app. Post reports to https://collector.example.net/in.\n');
  const result = r.check(r.commit('new host'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /https:\/\/collector\.example\.net\/in/);
});

test('the check reads the scope table from the base commit, so a diff cannot widen its own scope', () => {
  const r = repo();
  r.write('docs/DOC-SWEEP.md', '# manual\n\n| May edit | Never edit |\n|---|---|\n| `docs/ALLOWED.md`, `src/code.js` | `docs/DOC-SWEEP.md` |\n');
  r.write('src/code.js', 'export const x = 2;\n');
  const result = r.check(r.commit('widen and edit'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/DOC-SWEEP\.md/);
  assert.match(result.stderr, /src\/code\.js/);
});

test('the check judges the branch from its merge base, so changes main gained since are not the sweep\'s', () => {
  const r = repo();
  r.write('docs/ALLOWED.md', 'The app lives at https://app.flowgauge.app, and that is all.\n');
  const head = r.commit('sweep edit');
  r.git('checkout', '-q', '-b', 'later', r.base);
  r.write('src/code.js', 'export const x = 3; // https://later.example.com\n');
  const tip = r.commit('main moved on');
  const result = spawnSync('node', [SCRIPT, tip, head], { cwd: r.dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 modified path/);
});

test('the check refuses a deleted, added, or renamed file even inside the may-edit column', () => {
  const r = repo();
  r.git('rm', '-q', 'docs/ALLOWED.md');
  const deleted = r.check(r.commit('delete allowed'));
  assert.equal(deleted.status, 1);
  assert.match(deleted.stderr, /docs\/ALLOWED\.md is deleted/);
  const r2 = repo();
  r2.write('docs/NEW.md', 'brand new\n');
  const added = r2.check(r2.commit('add new'));
  assert.equal(added.status, 1);
  assert.match(added.stderr, /docs\/NEW\.md is added/);
  const r3 = repo();
  r3.git('mv', 'docs/ALLOWED.md', 'docs/RENAMED.md');
  const renamed = r3.check(r3.commit('rename allowed'));
  assert.equal(renamed.status, 1);
  assert.match(renamed.stderr, /docs\/ALLOWED\.md -> docs\/RENAMED\.md is renamed/);
});

test('the check refuses rendered-link markup outright, naming the fragment', () => {
  const r = repo();
  r.write('docs/ALLOWED.md', 'The app lives at https://app.flowgauge.app; see [the collector](https:&#47;&#47;collector&#46;example&#46;com).\n');
  const result = r.check(r.commit('encoded link'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /&#47; is markup GitHub would render/);
});

test('the check rejects missing or unresolvable commits instead of reporting a clean diff', () => {
  const r = repo();
  const noArgs = spawnSync('node', [SCRIPT], { cwd: dirname(SCRIPT), encoding: 'utf8' });
  assert.equal(noArgs.status, 2);
  const bad = r.check('0000000000000000000000000000000000000000');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /0000000/);
});
