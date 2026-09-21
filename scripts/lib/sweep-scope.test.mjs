// sweep-scope.test.mjs — the CI lane that owns the documentation sweep's scope.
//
// The sweep lands its own pull request, so no one reads it before it merges; these tests are the
// evidence that the two rules docs/DOC-SWEEP.md used to leave to the owner's eyes now fail the
// required check mechanically. The pure functions are tested on the real manual and on synthetic
// tables; the script is run end-to-end against a throwaway Git repository so a stubbed check, a
// head-tree manual read, or a swallowed Git error each goes red here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addedNetworkTokens, hiddenDestinationShapes, outOfScope, parseMayEdit, renderedDestinations, tokenMatches,
  treeGrepArgs, treeGrepCandidates,
} from './sweep-scope.mjs';
import { HIDDEN_ROWS, PASS_ROWS, RENDERED_ROWS, TOKEN_ROWS, TREE_ROWS } from './sweep-scope-corpus.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANUAL = readFileSync(join(ROOT, 'docs/DOC-SWEEP.md'), 'utf8');
const SCRIPT = join(ROOT, 'scripts/sweep-scope-check.mjs');

// A corpus row is one added line, judged in the smallest diff that can carry it.
function addedDiff(line) {
  return [
    'diff --git a/docs/X.md b/docs/X.md',
    '--- a/docs/X.md',
    '+++ b/docs/X.md',
    '@@ -1,1 +1,2 @@',
    ' unchanged',
    `+${line}`,
  ].join('\n');
}

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

test('addedNetworkTokens sees URIs and bare host names on added lines only', async (t) => {
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
  // An e-mail literal renders as a `mailto:` destination, so it is a token the tree must vouch for;
  // a version pin is not one, and a token that carries its own e-mail is reported once.
  for (const row of TOKEN_ROWS) {
    await t.test(row.id, () => assert.deepEqual(addedNetworkTokens(addedDiff(row.after)), row.expect));
  }
});

test('hiddenDestinationShapes names the rule that refuses each hidden destination shape', async (t) => {
  for (const row of HIDDEN_ROWS) {
    await t.test(row.id, () => {
      const shapes = hiddenDestinationShapes(addedDiff(row.after));
      assert.ok(shapes.length > 0, `${row.after} was not refused`);
      assert.deepEqual([...new Set(shapes.map((shape) => shape.rule))], [row.expect]);
      for (const shape of shapes) {
        assert.deepEqual(Object.keys(shape), ['line', 'rule', 'fragment']);
        assert.equal(shape.line, row.after);
        assert.ok(shape.fragment.length > 0, 'a refusal names the fragment it refuses');
      }
    });
  }
});

test('hiddenDestinationShapes leaves prose and legal destinations alone', async (t) => {
  for (const row of PASS_ROWS) {
    await t.test(row.id, () => assert.deepEqual(hiddenDestinationShapes(addedDiff(row.after)), []));
  }
});

// The other half of the guard, and the one the added lines alone cannot answer: what the whole
// document renders. Each row is a complete before and a complete after, and the claim is their
// difference keyed by the visible spelling, so a fence or comment the edit removes counts as newly
// rendered even though the link line itself never changed.
test('renderedDestinations reports what the after document renders and the before document did not', async (t) => {
  for (const row of RENDERED_ROWS) {
    await t.test(row.id, () => {
      const rendered = new Set(renderedDestinations(row.before).map((record) => record.text));
      const added = renderedDestinations(row.after).filter((record) => !rendered.has(record.text));
      assert.deepEqual(added, row.expect);
    });
  }
});

// A false refusal costs the sweep its weekly run, so the prose the routine may already rewrite is
// held to the same bar as the corpus: every live may-edit document, read as if wholly added.
test('no live may-edit document trips a rule', () => {
  const refusals = [];
  for (const path of parseMayEdit(MANUAL)) {
    const lines = readFileSync(join(ROOT, path), 'utf8').split('\n');
    const diff = [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,1 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n');
    for (const shape of hiddenDestinationShapes(diff)) refusals.push(`${path}: ${shape.rule} ${shape.fragment}`);
  }
  assert.deepEqual(refusals, []);
});

// The base tree the K rows and the end-to-end tests are judged against. `docs/LEGACY.md` stands for
// what a sweep landed under the weaker rules: destination shapes the guard now refuses, inert inside a
// fence, which a fixed-string grep still finds.
const ALLOWED = [
  'The app lives at https://app.flowgauge.app and nowhere else.',
  'Jira help: https://support.atlassian.com/jira',
  '<a href="https://app.flowgauge.app/?a=1&amp;b=2">tracked</a>',
  '',
].join('\n');
const WORKERS = 'The hosted build is https://www.flowgauge.app and smoke failures go to smoketest@example.com. ' +
  'A tracked link looks like https://app.flowgauge.app/?c=3&d=4.\n';
const LEGACY = ['Historic plants, fenced so nothing renders:', '', '```', '[c]://evil.icu',
  '[x](&#47;&#47;evil.icu/in)', 'a@sub_domain.evil.icu', '```', '', 'The label above is [click][c].', ''].join('\n');

// A throwaway repository whose base commit carries a two-row scope table and one allowed document.
// `documents` replaces a base document by fiat and `mayEdit` names the paths the table admits, so a
// row can start from the tree it needs without a second helper.
function repo({ documents = {}, mayEdit = ['docs/ALLOWED.md'] } = {}) {
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
  const column = mayEdit.map((path) => `\`${path}\``).join(', ');
  write('docs/DOC-SWEEP.md', `# manual\n\n| May edit | Never edit |\n|---|---|\n| ${column} | \`docs/DOC-SWEEP.md\`, \`src/\` |\n`);
  const tree = {
    'docs/ALLOWED.md': ALLOWED,
    'docs/LEGACY.md': LEGACY,
    'workers/README.md': WORKERS,
    'src/code.js': 'export const x = 1;\n',
    ...documents,
  };
  for (const [rel, text] of Object.entries(tree)) write(rel, text);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  const commit = (label) => {
    git('add', '-A');
    git('commit', '-q', '-m', label);
    return git('rev-parse', 'HEAD');
  };
  const check = (head) => spawnSync('node', [SCRIPT, base, head], { cwd: dir, encoding: 'utf8' });
  // The check script's own grep stage, called through the same builder, so the tree rows are judged on
  // the lines the real base returns: every spelling of the destination, case-insensitively, with git's
  // `<rev>:<path>` prefix cut at the NUL `--null` writes after it.
  const grep = (text) => {
    const lines = [];
    for (const candidate of treeGrepCandidates(text)) {
      const found = spawnSync('git', treeGrepArgs(candidate, base), { cwd: dir, encoding: 'utf8' });
      for (const match of found.stdout.split('\n').filter(Boolean)) lines.push(match.slice(match.indexOf('\0') + 1));
    }
    return lines;
  };
  return { git, write, commit, check, grep, base, dir };
}

// The invariant the design rests on: a fixed-string hit vouches for nothing on its own, so each row is
// judged on the lines the base actually returns for it. K1, K3a and K3b are destinations a past sweep
// left inert in `docs/LEGACY.md`; the tree carries their text and still vouches for none of them.
test('tokenMatches vouches for a destination only as a whole token of the base tree', async (t) => {
  const r = repo();
  for (const row of TREE_ROWS) {
    await t.test(`${row.id} ${row.text}`, () => {
      assert.equal(tokenMatches(row.text, r.grep(row.text)), row.expect === 'known');
    });
  }
});

// The trust anchor, asked of the live repository rather than a throwaway one. This file and its corpus
// spell out destinations that must NOT be trusted, as whole extractor tokens; were the tree searched
// with them in it, the guard would vouch for every hostile example it owns and a sweep could write one
// into a document unrefused.
test('the live tree vouches for no destination only the guard\'s own sources carry', () => {
  const knownAtHead = (text) => {
    const lines = [];
    for (const candidate of treeGrepCandidates(text)) {
      const found = spawnSync('git', treeGrepArgs(candidate, 'HEAD'), { cwd: ROOT, encoding: 'utf8' });
      for (const match of found.stdout.split('\n').filter(Boolean)) lines.push(match.slice(match.indexOf('\0') + 1));
    }
    return tokenMatches(text, lines);
  };
  for (const text of ['https://github.com@evil.icu', 'https://evil.icu/in', 'https://support.atlassian.co',
    'other@evil.icu', 'https://nested.example.icu/u']) {
    assert.equal(knownAtHead(text), false, `the tree at HEAD vouches for ${text}`);
  }
  // A destination the repository legitimately carries, so the row above cannot pass on a search that
  // returns nothing for everything.
  assert.equal(knownAtHead('https://github.com/zaingulel/RentCottage/issues/34'), true,
    'the tree at HEAD vouches for nothing at all');
});

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

test('the check refuses a non-Markdown path even when the may-edit column names it', () => {
  const r = repo({
    documents: { 'docs/NOTES.txt': 'Original notes.\n' },
    mayEdit: ['docs/NOTES.txt'],
  });
  r.write('docs/NOTES.txt', 'Updated notes.\n');
  const result = r.check(r.commit('edit non-Markdown notes'));
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /docs\/NOTES\.txt is in the may-edit column but is not Markdown, so the rendered half cannot judge it/,
  );
});

test('the check fails a diff that introduces a URI the base tree does not carry, naming it', () => {
  const r = repo();
  r.write('docs/ALLOWED.md', 'The app lives at https://app.flowgauge.app. Post reports to https://collector.example.net/in.\n');
  const result = r.check(r.commit('new host'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /https:\/\/collector\.example\.net\/in/);
});

test('the check refuses a token the tree carries only as a substring of a longer link (E9)', () => {
  const r = repo();
  r.write('docs/ALLOWED.md', `${ALLOWED}See https://support.atlassian.co for help.\n`);
  const result = r.check(r.commit('shortened host'));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /https:\/\/support\.atlassian\.co is added/);
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
  assert.match(result.stderr, /REFERENCE_IN_DESTINATION/);
});

test('the check rejects missing or unresolvable commits instead of reporting a clean diff', () => {
  const r = repo();
  const noArgs = spawnSync('node', [SCRIPT], { cwd: dirname(SCRIPT), encoding: 'utf8' });
  assert.equal(noArgs.status, 2);
  const bad = r.check('0000000000000000000000000000000000000000');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /0000000/);
});

// The end-to-end rows, written from the attacker's side rather than the implementation's: a week of
// the routine's life per row, run against the throwaway repository above.
//
// The documents a row starts from when the standard tree will not do. `FENCED` renders nothing but the
// Jira link, so a fence removed from around the app link is genuinely newly rendered; `AMPERSAND`
// carries the tracked link in its bare-`&` spelling; `CONTROL` carries a destination with a tab in it,
// which renders as a host the line never spells.
const FENCED = ['Jira help: https://support.atlassian.com/jira', '', '```',
  '[x](https://app.flowgauge.app)', '```', ''].join('\n');
const AMPERSAND = ['The app lives at https://app.flowgauge.app and nowhere else.',
  'A tracked link: https://app.flowgauge.app/?a=1&b=2', ''].join('\n');
const CONTROL = ['Jira help: https://support.atlassian.com/jira', '', '```',
  '[x](<https://www.flowgauge.app\t.evil.icu>)', '```', ''].join('\n');

// Removing the fence lines and nothing else leaves a deletion-only diff: the context-free half sees no
// added line at all, so only the semantic half can speak.
const unfenced = (document) => document.split('\n').filter((line) => line !== '```').join('\n');

// One end-to-end run: `path` is the only may-edit entry, it starts as `before` in the base commit, and
// the head commit replaces it with `after`.
function judge(path, before, after) {
  const r = repo({ documents: { [path]: before }, mayEdit: [path] });
  r.write(path, after);
  return r.check(r.commit('sweep edit'));
}

// Week one of the plant-then-reactivate attack. Inert text is still added text, so every spelling of
// the plant is refused the week it is written and the week that would wake it never comes.
const PLANTS = [
  { id: 'E1a', line: '[x](//evil.icu/in)', named: /docs\/ALLOWED\.md: PROTOCOL_RELATIVE refuses \/\/evil\.icu\/in/ },
  { id: 'E1b', line: 'https://evil.icu/in', named: /https:\/\/evil\.icu\/in is added by this diff/ },
  { id: 'E1c', line: '![p](&#47;&#47;evil.icu/in)', named: /docs\/ALLOWED\.md: REFERENCE_IN_DESTINATION refuses &#47;/ },
  { id: 'E1d', line: '[c]://evil.icu', named: /docs\/ALLOWED\.md: PROTOCOL_RELATIVE refuses \/\/evil\.icu/ },
  { id: 'E1e', line: 'other@evil.icu', named: /other@evil\.icu is added by this diff and is not a whole token anywhere in the tree/ },
];
test('the check refuses a destination planted inside a fence, the week it is planted (E1)', async (t) => {
  for (const row of PLANTS) {
    await t.test(row.id, () => {
      const result = judge('docs/ALLOWED.md', ALLOWED, `${ALLOWED}\n\`\`\`\n${row.line}\n\`\`\`\n`);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, row.named);
    });
  }
});

test('the check reports, and does not refuse, a reactivated destination the tree already carries (E2)', () => {
  const result = judge('docs/ALLOWED.md', FENCED, unfenced(FENCED));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 newly rendered destination\(s\), all already in the tree/);
});

test('the check reports an autolink literal the tree vouches for as newly rendered (E3)', () => {
  const result = judge('docs/ALLOWED.md', ALLOWED, `${ALLOWED}\nVisit www.flowgauge.app today.\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 newly rendered destination\(s\)/);
});

// The observable difference the parser makes: one line, two containers, two verdicts.
test('the check counts a link in a paragraph as newly rendered and the same line in a fence as inert (E5)', () => {
  const link = '[x](https://app.flowgauge.app)';
  const live = judge('docs/ALLOWED.md', FENCED, `${FENCED}\n${link}\n`);
  assert.equal(live.status, 0, live.stderr);
  assert.match(live.stdout, /1 newly rendered destination\(s\)/);
  const inert = judge('docs/ALLOWED.md', FENCED, FENCED.replace('```\n', `\`\`\`\n${link}\n`));
  assert.equal(inert.status, 0, inert.stderr);
  assert.match(inert.stdout, /0 newly rendered destination\(s\)/);
});

test('the check passes the legal prose and same-origin destinations the routine may write (E6)', () => {
  const prose = 'A &mdash; B, see [t](<some path/with spaces.md>) and [u]( /x ).\n' +
    '"C:\\Users\\zain\\file.txt" is a Windows path &mdash; fine.\n';
  const result = judge('docs/ALLOWED.md', ALLOWED, `${ALLOWED}\n${prose}`);
  assert.equal(result.status, 0, result.stderr);
});

// The invariant on the way out. The tree carries all three plants verbatim, so a fixed-string hit
// vouches for each of them; only the e-mail is a token the extractor produces, and only it is let
// through. Nothing is added, so the context-free half cannot see this diff at all.
test('the check refuses a deletion-only diff that wakes plants the tree cannot vouch for (E7)', () => {
  const result = judge('docs/LEGACY.md', LEGACY, unfenced(LEGACY));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /docs\/LEGACY\.md: the newly rendered destination \/\/evil\.icu \(/);
  assert.match(result.stderr, /docs\/LEGACY\.md: the newly rendered destination \/\/evil\.icu\/in \(/);
  assert.doesNotMatch(result.stderr, /a@sub_domain\.evil\.icu/);
});

test('the check reports a woken e-mail literal the extractor already tokenises in the tree (E7)', () => {
  const freed = ['Historic plants, fenced so nothing renders:', '', '```', '[c]://evil.icu',
    '[x](&#47;&#47;evil.icu/in)', '```', '', 'a@sub_domain.evil.icu', '', 'The label above is [click][c].', ''].join('\n');
  const result = judge('docs/LEGACY.md', LEGACY, freed);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 newly rendered destination\(s\)/);
});

// `&amp;` and a bare `&` are one destination, so the three ways the tree and the diff can spell the
// same tracked link all agree.
test('the check reads an entity-escaped ampersand and a bare one as the same destination (E8)', () => {
  const html = '<a href="https://app.flowgauge.app/?a=1&amp;b=2">x</a>';
  const a = judge('docs/ALLOWED.md', ALLOWED, `${ALLOWED}\n${html}\n`);
  assert.equal(a.status, 0, a.stderr);
  const b = judge('docs/ALLOWED.md', ALLOWED, `${ALLOWED}\n[q](https://app.flowgauge.app/?a=1&b=2)\n`);
  assert.equal(b.status, 0, b.stderr);
  const c = judge('docs/ALLOWED.md', AMPERSAND, `${AMPERSAND}\n${html}\n`);
  assert.equal(c.status, 0, c.stderr);
});

// The shape rules the narrowing dropped. Neither spelling is an extractor token, so nothing can vouch
// for them and the semantic half refuses each on its own.
test('the check refuses a lax or non-token scheme as an unknown rendered destination (E10)', () => {
  for (const line of ['[x](http:evil.icu/x)', '[x](javascript:alert(1))']) {
    const result = judge('docs/ALLOWED.md', ALLOWED, `${ALLOWED}\n${line}\n`);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /the newly rendered destination/);
    assert.match(result.stderr, /evil\.icu|javascript:alert/);
  }
});

// A definition the base carries live but unreferenced renders nothing, so the reference that wakes it
// is the edit that publishes the link. The added line carries no network token and sits in no
// destination position, so the context-free half has nothing to refuse and only the semantic half can
// speak. The tree carries the destination's text, in the base document itself, but the extractor does
// not tokenise `//evil.icu`, so nothing vouches for it.
test('the check refuses a reference that wakes a dormant definition the tree cannot vouch for (E11)', () => {
  const result = judge('docs/ALLOWED.md', '[c]: //evil.icu\n', '[c]: //evil.icu\n\nsee [click][c].\n');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /docs\/ALLOWED\.md: the newly rendered destination \/\/evil\.icu \(/);
});

test('the check refuses a control character in a destination whatever the diff shows (E10)', () => {
  const result = judge('docs/ALLOWED.md', CONTROL, unfenced(CONTROL));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /the rendered destination .* is refused \(control character\)/);
});

// The guard's own sources list destinations that must not be trusted, so they are excluded from the
// search that decides what the repository vouches for. Pinned through the real check script, whose
// `knownInTree` calls the shared argument builder. The second run plants the same content at an
// ordinary path, so the first cannot pass on a search that finds nothing anywhere.
test('the tree does not vouch for a destination only a guard source carries (E12)', () => {
  const PLANT = 'export const ROWS = [{ id: \'X\', line: \'[x](https://evil.icu/in)\' }];\n';
  const EDIT = 'See [docs](https://evil.icu/in).\n';

  const guarded = repo({
    documents: { 'docs/ALLOWED.md': '', 'scripts/lib/sweep-scope-corpus.mjs': PLANT },
    mayEdit: ['docs/ALLOWED.md'],
  });
  guarded.write('docs/ALLOWED.md', EDIT);
  const refused = guarded.check(guarded.commit('edit vouched only by a guard source'));
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /https:\/\/evil\.icu\/in/);

  const ordinary = repo({
    documents: { 'docs/ALLOWED.md': '', 'docs/NOTES.md': PLANT },
    mayEdit: ['docs/ALLOWED.md'],
  });
  ordinary.write('docs/ALLOWED.md', EDIT);
  const passed = ordinary.check(ordinary.commit('edit vouched by an ordinary path'));
  assert.equal(passed.status, 0, passed.stderr);
});
