// sweep-scope.mjs — pure logic for the pull-request guard over the inactive documentation sweep.
//
// The sweep lands its own pull request, so nobody reads it before it merges. Two rules in
// docs/DOC-SWEEP.md therefore need a mechanical owner rather than the owner's eyes: the diff modifies
// only files in the may-edit column of the manual's scope table, and it introduces no link the
// repository did not already carry. The table is parsed from the manual so the allowlist has one
// home. The caller reads the manual from the BASE commit, never the head, so a diff cannot widen its
// own scope. I/O lives in scripts/sweep-scope-check.mjs; this file is pure.

// The scope table is the one whose header row is exactly `| May edit | Never edit |`; the may-edit
// paths are every backtick-quoted entry in its left column, in table order. A manual without that table,
// or with an empty left column, is an error: an empty allowlist would fail every diff and read as a
// broken sweep rather than a broken parse.
export function parseMayEdit(manualText) {
  const lines = manualText.split('\n');
  const header = lines.findIndex((line) => line.trim() === '| May edit | Never edit |');
  if (header < 0) throw new Error('docs/DOC-SWEEP.md has no scope table headed `| May edit | Never edit |`');
  const paths = [];
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    const left = lines[i].split('|')[1] ?? '';
    for (const m of left.matchAll(/`([^`]+)`/g)) paths.push(m[1]);
  }
  if (paths.length === 0) throw new Error('the scope table\'s may-edit column is empty');
  return paths;
}

// Exact path match only. Every may-edit entry is a file, and a prefix match would let
// `docs/ARCHITECTURE.md.bak` or a directory sibling through on a name it shares.
export function outOfScope(changedPaths, mayEdit) {
  const allowed = new Set(mayEdit);
  return changedPaths.filter((path) => !allowed.has(path));
}

// Both patterns start and end at anything that is not a name character. `\b` and `\w` treat `_` as
// a word character, so a token wrapped in markdown underscore-italics would otherwise never match.
const START = '(?<![A-Za-z0-9.-])';
const END = '(?![A-Za-z0-9-])';
// A scheme followed by `//`, `mailto:` (the one schemeless form this repository uses), and `www.`,
// which GitHub autolinks without a scheme. Anything looser (`type:bug`, `Status:Done`) would read a
// label as a link.
const URI = new RegExp(`${START}(?:[a-z][a-z0-9+.-]*:\\/\\/|mailto:|www\\.)[^\\s<>()"'\`\\]]+`, 'gi');
// A bare host is a dotted name ending in a common top-level domain. File names (`package.json`,
// `board.mjs`) end in extensions that are not on the list; a host on a rarer domain is caught only as
// part of a full URI, which docs/DOC-SWEEP.md says in as many words.
const TLDS = 'com|org|net|io|dev|app|ai|co|uk|eu|us|ca|au|de|fr|nl|ch|se|me|info|biz|xyz|top|site|online|' +
  'cloud|sh|pro|tech|link|click|cc|tv|gg|ly|to|in|jp|cn|ru|br|it|es|pl|no|fi|dk|ie|pt|cz|at|be';
// A host may be written as a wildcard or with a leading dot (`*.example.com`, `.example.com`); the
// marker is admitted so the lookbehind cannot hide it, then dropped from the reported token.
const HOST = new RegExp(`${START}(?:\\*\\.|\\.)?(?:[a-z0-9-]+\\.)+(?:${TLDS})${END}`, 'gi');

// The ADDED content lines of a unified diff. Header lines (`+++ b/path`) are recognised by position,
// between a `diff --git` line and its first `@@` hunk, because a content line can be made to start
// with `++ b/` and a pattern on the text alone would treat it as a header.
function addedLines(unifiedDiff) {
  const added = [];
  let inHeader = false;
  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('diff --git ')) inHeader = true;
    else if (line.startsWith('@@')) inHeader = false;
    if (!inHeader && line.startsWith('+')) added.push(line.slice(1));
  }
  return added;
}

// Every URI and bare host name on an added line, in order of first appearance. Removed and context
// lines are ignored: a token that was already in the tree is not new, and the caller settles whether
// an added one already appears in the base tree.
export function addedNetworkTokens(unifiedDiff) {
  const tokens = [];
  for (const text of addedLines(unifiedDiff)) {
    // Sentence punctuation and closing italics or bold markers belong to the prose, not the link.
    const uris = [...text.matchAll(URI)].map((m) => m[0].replace(/[.,;:_*]+$/, ''));
    tokens.push(...uris);
    let rest = text;
    for (const uri of uris) rest = rest.split(uri).join(' ');
    tokens.push(...[...rest.matchAll(HOST)].map((m) => m[0].replace(/^\*?\./, '')));
  }
  return [...new Set(tokens)];
}

// Markup GitHub renders into a live link or image while the text shows no URI or host. The may-edit
// documents use none of these forms, so each is refused outright rather than checked against the tree:
// a character reference beyond the five ordinary ones (`&#47;` spells a slash); a markdown link whose
// destination does not start right after the parenthesis (CommonMark allows whitespace, an angle
// bracket, or a line break there, and this scan reads one line at a time); and, in a markdown link, a
// reference definition, or an `href` or `src` attribute, a destination that is protocol-relative or
// carries a backslash.
const CHARACTER_REFERENCE = /&(?:#x?[0-9a-f]+|(?!(?:amp|lt|gt|quot|nbsp);)[a-z]+);/gi;
const INDIRECT_LINK_OPENING = /\]\((?=\s|<|$)/gm;
const DESTINATION = /(?:\]\(|^\s*\[[^\]\n]+\]:\s*|\b(?:href|src)\s*=\s*["']?)<?([^\s)>"']*)/gim;

// Every fragment on an added line that matches one of those shapes, in order of first appearance.
export function renderedLinkMarkup(unifiedDiff) {
  const fragments = [];
  for (const text of addedLines(unifiedDiff)) {
    fragments.push(...[...text.matchAll(CHARACTER_REFERENCE)].map((m) => m[0]));
    fragments.push(...[...text.matchAll(INDIRECT_LINK_OPENING)].map((m) => m[0]));
    for (const m of text.matchAll(DESTINATION)) {
      if (m[1].startsWith('//') || m[1].includes('\\')) fragments.push(m[1]);
    }
  }
  return [...new Set(fragments)];
}
