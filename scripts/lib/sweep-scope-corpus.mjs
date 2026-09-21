// sweep-scope-corpus.mjs — the rows scripts/lib/sweep-scope.test.mjs judges the sweep-scope guard by.
//
// Data only, no assertions: the expectations are the contract, written before the implementation and
// shared byte for byte with the same guard in RentCottage. A row that turns out to be wrong is
// corrected in both repositories as its own decision, never edited to make an implementation pass.
// `evil.icu` and `example.icu` hosts are deliberate: `icu` is not on the extractor's top-level domain
// list, so only the rule under test can catch them.
//
// A rule of the design that carries several lines becomes one row per line (H2a, H2b), because each
// line is judged alone; the letters are the design's own row names.

// Added lines `hiddenDestinationShapes` must refuse, each with the one rule that must name it.
export const HIDDEN_ROWS = [
  { id: 'H1', after: '[x](//evil.icu/in)', expect: 'PROTOCOL_RELATIVE' },
  { id: 'H2a', after: '[x](&#47;&#47;evil.icu/in)', expect: 'REFERENCE_IN_DESTINATION' },
  { id: 'H2b', after: '<a href="&#x2f;&#x2f;evil.icu">', expect: 'REFERENCE_IN_DESTINATION' },
  { id: 'H3a', after: '[x](&sol;&sol;evil.icu/in)', expect: 'REFERENCE_IN_DESTINATION' },
  { id: 'H3b', after: '[x](https://www.flowgauge.app&Tab;.evil.icu)', expect: 'REFERENCE_IN_DESTINATION' },
  { id: 'H4a', after: '[x](', expect: 'NEXT_LINE_DESTINATION' },
  { id: 'H4b', after: '[c]:', expect: 'NEXT_LINE_DESTINATION' },
  { id: 'H5a', after: '[x](\\/\\/evil.icu/in)', expect: 'BACKSLASH' },
  { id: 'H5b', after: '<a href="\\\\evil.icu">', expect: 'BACKSLASH' },
  { id: 'H8', after: '<a href="https://www.flowgauge.app', expect: 'OPEN_ATTRIBUTE' },
  { id: 'H9', after: '//evil.icu"', expect: 'PROTOCOL_RELATIVE' },
  { id: 'H12a', after: '<img srcset="//evil.icu/x 1x">', expect: 'PROTOCOL_RELATIVE' },
  { id: 'H12b', after: "<q cite='//evil.icu'>", expect: 'PROTOCOL_RELATIVE' },
  { id: 'H12c', after: '<a href=//evil.icu>', expect: 'PROTOCOL_RELATIVE' },
  { id: 'H13a', after: '[c]://evil.icu', expect: 'PROTOCOL_RELATIVE' },
  { id: 'H13b', after: '[c]: //evil.icu', expect: 'PROTOCOL_RELATIVE' },
  { id: 'H13c', after: '[x](<//evil.icu>)', expect: 'PROTOCOL_RELATIVE' },
  // A list-valued attribute is judged candidate by candidate, so the second candidate cannot hide
  // behind the relative first one: read whole, the value starts with `docs/` and names no host.
  { id: 'H14', after: '<img src="docs/a.png" srcset="docs/a.png 1x,//evil.icu/t.png 2x">', expect: 'PROTOCOL_RELATIVE' },
  // A reference glued to an autolink literal is a destination position too: GitHub decodes it before it
  // autolinks, so it extends the host without changing the token the extractor reads.
  { id: 'H15a', after: 'Write to smoketest@example.com&#46;evil.icu today.', expect: 'REFERENCE_IN_DESTINATION' },
  { id: 'H15b', after: 'See example.com&#46;evil.icu for more.', expect: 'REFERENCE_IN_DESTINATION' },
];

// Added lines `hiddenDestinationShapes` must leave alone: legal CommonMark the routine may write, and
// prose that only looks like a destination. Each is a false refusal the narrowing to P1-P4 retires.
export const PASS_ROWS = [
  { id: 'N1', after: 'A &mdash; B &copy; C', expect: 'pass' },
  { id: 'N2', after: '[t](<some path/with spaces.md>)', expect: 'pass' },
  { id: 'N3', after: '[t]( /path )', expect: 'pass' },
  { id: 'N4a', after: '    // comment', expect: 'pass' },
  { id: 'N4b', after: 'a path//file', expect: 'pass' },
  { id: 'N4c', after: 'see https://app.flowgauge.app now', expect: 'pass' },
  { id: 'N5', after: '<a href="https://www.flowgauge.app">', expect: 'pass' },
  { id: 'N6', after: '[x](evil.icu/in)', expect: 'pass' },
  { id: 'N7', after: '<a href="https://app.flowgauge.app/?a=1&amp;b=2">', expect: 'pass' },
  { id: 'N8', after: 'See [the note](docs/NOTE.md) &mdash; later.', expect: 'pass' },
  { id: 'N9', after: '"C:\\Users\\zain\\file.txt" is a Windows path &mdash; fine.', expect: 'pass' },
  { id: 'N10', after: '<p>it&#39;s</p>', expect: 'pass' },
  { id: 'N11a', after: '[x](http:evil.icu/x)', expect: 'pass' },
  { id: 'N11b', after: '[x](javascript:alert(1))', expect: 'pass' },
  // A prose entity later in the line is not glued to an earlier host: the P5 rule anchors at the
  // literal's end and must not keep searching the rest of the line for something to refuse over.
  { id: 'N12', after: 'Visit app.flowgauge.app &mdash; it is free.', expect: 'pass' },
];

// Added lines and the exact tokens `addedNetworkTokens` must yield from them. The extractor does not
// fold case (T1 keeps the line's own bytes, so the tree grep and the failure message both read as
// written); the comparison against the tree is what lower-cases. An e-mail literal's own span leaves
// the line before the bare-host pattern runs, so `mailto:` and userinfo URIs yield one token (T7).
export const TOKEN_ROWS = [
  { id: 'T1', after: 'HTTPS://EVIL.ICU/x', expect: ['HTTPS://EVIL.ICU/x'] },
  { id: 'T2', after: 'https://support.atlassian.co', expect: ['https://support.atlassian.co'] },
  { id: 'T4', after: 'www.flowgauge.app', expect: ['www.flowgauge.app'] },
  { id: 'T5a', after: 'smoketest@example.com', expect: ['smoketest@example.com'] },
  { id: 'T5b', after: 'other@evil.icu', expect: ['other@evil.icu'] },
  { id: 'T6', after: '<someone@evil.icu>', expect: ['someone@evil.icu'] },
  { id: 'T7a', after: 'mailto:x@evil.icu', expect: ['mailto:x@evil.icu'] },
  { id: 'T7b', after: 'https://github.com@evil.icu', expect: ['https://github.com@evil.icu'] },
  { id: 'T8a', after: 'a@sub_domain.evil.icu', expect: ['a@sub_domain.evil.icu'] },
  { id: 'T8b', after: 'xmpp:a@sub_domain.evil.icu', expect: ['a@sub_domain.evil.icu'] },
  { id: 'T8c', after: '[c]:https://evil.icu', expect: ['https://evil.icu'] },
  { id: 'T9', after: 'Pinned playwright@1.56.0 and lodash@4.17.15.', expect: [] },
];

// Destinations judged against the base tree of the throwaway repository the end-to-end tests build:
// `workers/README.md` carries `https://www.flowgauge.app`, `smoketest@example.com` and
// `https://app.flowgauge.app/?c=3&d=4`; `docs/ALLOWED.md` carries `https://support.atlassian.com/jira`,
// `https://app.flowgauge.app` and `<a href="https://app.flowgauge.app/?a=1&amp;b=2">`; `docs/LEGACY.md`
// carries, inside one fence, the verbatim lines `[c]://evil.icu`, `[x](&#47;&#47;evil.icu/in)` and
// `a@sub_domain.evil.icu`. A fixed-string grep hits several of the unknown rows verbatim, which is the
// whole point: a hit vouches for nothing until the extractor produces the destination from the matched
// line as a whole token.
export const TREE_ROWS = [
  { id: 'K1', text: '//evil.icu', expect: 'unknown' },
  { id: 'K2', text: 'a@sub_domain.evil.icu', expect: 'known' },
  { id: 'K3a', text: '//evil.icu/in', expect: 'unknown' },
  { id: 'K3b', text: '&#47;&#47;evil.icu/in', expect: 'unknown' },
  { id: 'K4', text: 'https://app.flowgauge.app/?a=1&b=2', expect: 'known' },
  { id: 'K5', text: 'https://www.flowgauge.app', expect: 'known' },
  { id: 'K6', text: 'www.flowgauge.app', expect: 'known' },
  { id: 'K7', text: 'flowgauge.app', expect: 'known' },
  { id: 'K8', text: 'smoketest@example.com', expect: 'known' },
  { id: 'K9', text: 'HTTPS://WWW.FLOWGAUGE.APP', expect: 'known' },
  { id: 'K10', text: 'https://support.atlassian.co', expect: 'unknown' },
  { id: 'K11', text: 'https://app', expect: 'unknown' },
  { id: 'K12', text: 'other@evil.icu', expect: 'unknown' },
  { id: 'K13', text: 'evil.flowgauge.app', expect: 'unknown' },
  { id: 'K14', text: 'https://app.flowgauge.app@evil.icu', expect: 'unknown' },
  { id: 'K15', text: 'https://app.flowgauge.app/?c=3&amp;d=4', expect: 'known' },
];

// Whole documents the semantic half judges: `renderedDestinations(after)` minus
// `renderedDestinations(before)`, keyed by `text`, must equal `expect`. Each `before` is the `after`
// without its link line, so the difference is what the edit newly renders. `text` is the visible
// spelling, because that is what a fixed-string search of the tree can find; `href` is where a browser
// would go. `\t` is a literal tab: R5 needs one to continue a list item, R14 one to hide a host from
// the URL parser, which strips it before resolving. R7 and R8 add no link line at all — they only
// remove the fence or the comment that was keeping one inert, the edit no line-based rule can see.
export const RENDERED_ROWS = [
  {
    id: 'R1',
    before: '- outer\n  - middle\n',
    after: '- outer\n  - middle\n    - inner [x](https://nested.example.icu/u)\n',
    expect: [{ text: 'https://nested.example.icu/u', href: 'https://nested.example.icu/u' }],
  },
  {
    id: 'R2',
    before: '1. outer\n   1. middle\n',
    after: '1. outer\n   1. middle\n      1. inner [x](https://ordered.example.icu/o)\n',
    expect: [{ text: 'https://ordered.example.icu/o', href: 'https://ordered.example.icu/o' }],
  },
  {
    id: 'R3',
    before: '- item\n',
    after: '- item\n- > [x](https://quoted.example.icu/q)\n',
    expect: [{ text: 'https://quoted.example.icu/q', href: 'https://quoted.example.icu/q' }],
  },
  {
    id: 'R4',
    before: 'See [the collector][c].\n\n',
    after: 'See [the collector][c].\n\n> - [c]: https://defined.example.icu/d\n',
    expect: [{ text: 'https://defined.example.icu/d', href: 'https://defined.example.icu/d' }],
  },
  {
    id: 'R5',
    before: '- item\n\n',
    after: '- item\n\n\tcontinued [x](https://tabbed.example.icu/t)\n',
    expect: [{ text: 'https://tabbed.example.icu/t', href: 'https://tabbed.example.icu/t' }],
  },
  // A definition 198 lines from its reference, separated by a blank line so it is its own block and
  // the record comes from a `definition` node, not from the bare URL rendering as an autolink literal.
  {
    id: 'R6',
    before: `Intro.\nRead [the note][n].\n${'filler\n'.repeat(198)}`,
    after: `Intro.\nRead [the note][n].\n${'filler\n'.repeat(198)}\n[n]: https://far.example.icu/n\n`,
    expect: [{ text: 'https://far.example.icu/n', href: 'https://far.example.icu/n' }],
  },
  {
    id: 'R7',
    before: '```\n[x](https://fenced.example.icu/f)\n```\n',
    after: '[x](https://fenced.example.icu/f)\n',
    expect: [{ text: 'https://fenced.example.icu/f', href: 'https://fenced.example.icu/f' }],
  },
  {
    id: 'R8',
    before: '<!--\n<img src="https://hidden.example.icu/h">\n-->\n',
    after: '<img src="https://hidden.example.icu/h">\n',
    expect: [{ text: 'https://hidden.example.icu/h', href: 'https://hidden.example.icu/h' }],
  },
  // An autolink literal shows no scheme, so its visible spelling and its destination differ.
  {
    id: 'R9',
    before: '',
    after: 'Visit www.flowgauge.app today.\n',
    expect: [{ text: 'www.flowgauge.app', href: 'http://www.flowgauge.app/' }],
  },
  {
    id: 'R10a',
    before: '',
    after: 'Write to smoketest@example.com.\n',
    expect: [{ text: 'smoketest@example.com', href: 'mailto:smoketest@example.com' }],
  },
  {
    id: 'R10b',
    before: '',
    after: 'Ask a@sub_domain.evil.icu.\n',
    expect: [{ text: 'a@sub_domain.evil.icu', href: 'mailto:a@sub_domain.evil.icu' }],
  },
  {
    id: 'R11',
    before: '',
    after: '<a href="https://app.flowgauge.app/?a=1&amp;b=2">x</a>\n',
    expect: [{ text: 'https://app.flowgauge.app/?a=1&b=2', href: 'https://app.flowgauge.app/?a=1&b=2' }],
  },
  {
    id: 'R12',
    before: '',
    after: '[t](<https://www.flowgauge.app/a b>)\n',
    expect: [{ text: 'https://www.flowgauge.app/a b', href: 'https://www.flowgauge.app/a%20b' }],
  },
  {
    id: 'R13',
    before: '',
    after: '[a](evil.icu/in) [b](/x) [c](#f) [d](<some path/with spaces.md>) [e](https:/evil.icu/x)\n',
    expect: [],
  },
  {
    id: 'R14',
    before: '',
    after: '[x](<https://www.flowgauge.app\t.evil.icu>)\n',
    expect: [{
      text: 'https://www.flowgauge.app\t.evil.icu',
      href: 'https://www.flowgauge.app.evil.icu/',
      problem: 'control character',
    }],
  },
  {
    id: 'R15',
    before: '',
    after: '[x](http:evil.icu/x)\n',
    expect: [{ text: 'http:evil.icu/x', href: 'http://evil.icu/x' }],
  },
  {
    id: 'R16',
    before: '',
    after: '[x](javascript:alert(1)) [y](data:text/html,x) <xmpp:a@evil.icu>\n',
    expect: [
      { text: 'javascript:alert(1)', href: 'javascript:alert(1)' },
      { text: 'data:text/html,x', href: 'data:text/html,x' },
      { text: 'xmpp:a@evil.icu', href: 'xmpp:a@evil.icu' },
    ],
  },
  {
    id: 'R17',
    before: '',
    after: '[x](\\/\\/evil.icu/in)\n',
    expect: [{ text: '//evil.icu/in', href: 'https://evil.icu/in' }],
  },
  {
    id: 'R18',
    before: '[click][c]\n\n',
    after: '[click][c]\n\n[c]://evil.icu\n',
    expect: [{ text: '//evil.icu', href: 'https://evil.icu/' }],
  },
  {
    id: 'R19',
    before: '',
    after: 'Pinned playwright@1.56.0 and lodash@4.17.15.\n',
    expect: [],
  },
  // A list-valued attribute holds one destination per candidate. Read whole, each of these resolves
  // relative and drops as same-origin, so only the candidate the renderer would fetch is a record.
  {
    id: 'R20a',
    before: '',
    after: '<img src="docs/a.png" srcset="docs/a.png 1x,//evil.icu/t.png 2x">\n',
    expect: [{ text: '//evil.icu/t.png', href: 'https://evil.icu/t.png' }],
  },
  {
    id: 'R20b',
    before: '',
    after: '<picture><source media="(prefers-color-scheme: dark)" srcset="docs/a.png 1x,//evil.icu/t.png 2x"><img src="docs/a.png"></picture>\n',
    expect: [{ text: '//evil.icu/t.png', href: 'https://evil.icu/t.png' }],
  },
  {
    id: 'R21',
    before: '',
    after: '<a ping="/a https://evil.icu/p">x</a>\n',
    expect: [{ text: 'https://evil.icu/p', href: 'https://evil.icu/p' }],
  },
  // A value whose first candidate is absolute must yield that candidate and nothing else: reading the
  // value whole invents a URL no renderer fetches, out of the candidate plus the descriptor and the
  // candidates after it.
  {
    id: 'R20c',
    before: '',
    after: '<img src="docs/a.png" srcset="https://cdn.example.com/a.png 2x">\n',
    expect: [{ text: 'https://cdn.example.com/a.png', href: 'https://cdn.example.com/a.png' }],
  },
  {
    id: 'R20d',
    before: '',
    after: '<img src="docs/a.png" srcset="https://cdn.example.com/a.png 1x, docs/b.png 2x">\n',
    expect: [{ text: 'https://cdn.example.com/a.png', href: 'https://cdn.example.com/a.png' }],
  },
  {
    id: 'R21a',
    before: '',
    after: '<a ping="https://cdn.example.com/p /b">x</a>\n',
    expect: [{ text: 'https://cdn.example.com/p', href: 'https://cdn.example.com/p' }],
  },
  // A comma inside a URL and a character HTML does not call whitespace both keep the candidate whole:
  // cutting either one reports a prefix the tree may vouch for while the browser fetches the rest.
  {
    id: 'R20e',
    before: '',
    after: '<img src="docs/a.png" srcset="https://cdn.example.com/a,b.png">\n',
    expect: [{ text: 'https://cdn.example.com/a,b.png', href: 'https://cdn.example.com/a,b.png' }],
  },
  {
    id: 'R20f',
    before: '',
    after: '<img src="docs/a.png" srcset="https://app.flowgauge.app,@evil.icu/x 1x">\n',
    expect: [{ text: 'https://app.flowgauge.app,@evil.icu/x', href: 'https://app.flowgauge.app,@evil.icu/x' }],
  },
  {
    id: 'R20g',
    before: '',
    after: '<img src="docs/a.png" srcset="https://cdn.example.com/a.png,">\n',
    expect: [{ text: 'https://cdn.example.com/a.png', href: 'https://cdn.example.com/a.png' }],
  },
  {
    id: 'R21b',
    before: '',
    after: '<a ping="https://cdn.example.com/a\vb">x</a>\n',
    expect: [{
      text: 'https://cdn.example.com/a\vb',
      href: 'https://cdn.example.com/a%0Bb',
      problem: 'control character',
    }],
  },
  // A comma inside a descriptor's parentheses does not end the candidate, so the candidate after it is
  // still collected and a vouched-for first candidate cannot stand in for it.
  {
    id: 'R20h',
    before: '',
    after: '<img src="docs/a.png" srcset="http://app.flowgauge.app 1x(foo,bar),http:app.flowgauge.app.evil.icu/x">\n',
    expect: [
      { text: 'http://app.flowgauge.app', href: 'http://app.flowgauge.app/' },
      { text: 'http:app.flowgauge.app.evil.icu/x', href: 'http://app.flowgauge.app.evil.icu/x' },
    ],
  },
  // A definition renders nothing on its own, so the reference that wakes a dormant one is the edit
  // that newly renders its destination (R22b). CommonMark keeps the first definition of a repeated
  // identifier and leaves the rest inert (R22c); an image reference resolves like a link one (R22d).
  {
    id: 'R22a',
    before: '',
    after: '[c]: https://lone.example.icu/d\n',
    expect: [],
  },
  {
    id: 'R22b',
    before: '[c]: https://lone.example.icu/d\n',
    after: '[c]: https://lone.example.icu/d\n\nsee [x][c]\n',
    expect: [{ text: 'https://lone.example.icu/d', href: 'https://lone.example.icu/d' }],
  },
  {
    id: 'R22c',
    before: '',
    after: '[c]: https://first.example.icu/a\n[c]: https://second.example.icu/b\n\nsee [x][c]\n',
    expect: [{ text: 'https://first.example.icu/a', href: 'https://first.example.icu/a' }],
  },
  {
    id: 'R22d',
    before: '',
    after: '![n]\n\n[n]: https://img.example.icu/i\n',
    expect: [{ text: 'https://img.example.icu/i', href: 'https://img.example.icu/i' }],
  },
  // The autolink extension re-finds these spellings inside text it has already decoded and emits a link
  // node with no source position, so the visible spelling cannot be read back and the node is judged by
  // its resolved url. GitHub links only the first of the two.
  {
    id: 'R23a',
    before: '',
    after: 'Write to x&#64;evil.icu today.\n',
    expect: [{ text: 'mailto:x@evil.icu', href: 'mailto:x@evil.icu' }],
  },
  {
    id: 'R23b',
    before: '',
    after: 'See www&#46;evil.icu today.\n',
    expect: [{ text: 'http://www.evil.icu', href: 'http://www.evil.icu/' }],
  },
];
