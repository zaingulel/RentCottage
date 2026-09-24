// board.test.mjs — mutation-proof unit tests for the board read+filter+format logic.
// Run: node --test scripts/lib/   (or `npm run test:scripts`)
//
// Guards the /resume Step-1 failure mode: ad-hoc board parsing broke on shell
// quoting and silently mis-filtered. These pin the contract the CLI depends on —
// pickable = Backlog+Ready only, one fused read that carries every field the board
// rules judge a card on, fail-loud with a remedy on every malformed or truncated
// response, and the routing view carrying #, status, title and labels.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leanBoardPage, leanNode } from './board-fixtures.mjs';
import {
  BOARD_OWNER,
  BOARD_OWNER_TYPE,
  BOARD_PROJECT_NUMBER,
  BOARD_REPOSITORY,
  PICKABLE_STATUSES,
  ROUTING_FIELD,
  ROUTING_OPTIONS,
  STATUS_OPTIONS,
} from './board-config.mjs';
import {
  fetchBoard,
  boardQuery,
  parseBoardArgs,
  parseBoardPage,
  parkedLine,
  pickable,
  isContentUnresolved,
  normalizeItem,
  sortForDisplay,
  formatRow,
  formatList,
  groupByRouting,
  formatGrouped,
} from './board.mjs';

// A representative board spanning pickable + non-pickable columns.
const BOARD = {
  items: [
    { status: 'Ready', title: 'Funnel reader CLI', routing: 'Product',
      labels: ['type:task', 'autonomy:autonomous'], content: { number: 266 } },
    { status: 'Backlog', title: 'Review batch 5',
      labels: ['tripwire', 'plan-first'], content: { number: 264 } },
    { status: 'Done', title: 'Already done', labels: [], content: { number: 293 } },
    { status: 'In review', title: 'Mid flight', content: { number: 296 } },
  ],
};

test('pickable keeps ONLY Backlog + Ready — excludes Done / In review', () => {
  const nums = pickable(BOARD.items).map((i) => i.content.number).sort();
  assert.deepEqual(nums, [264, 266]);
  // Mutation guard: a Done item must never be pickable.
  assert.equal(pickable(BOARD.items).some((i) => i.status === 'Done'), false);
});

test("parkedLine prints nothing under this repository's own config, which parks no lane", () => {
  const laned = { status: 'Ready', lane: 'To Sebastiano', content: { number: 12 } };
  assert.equal(parkedLine([...BOARD.items, laned], parseBoardArgs([])), null);
});

test('PICKABLE_STATUSES is exactly the two draw columns', () => {
  assert.deepEqual([...PICKABLE_STATUSES].sort(), ['Backlog', 'Ready']);
});

test('parseBoardArgs: the default read, each selection, and --closeout', () => {
  assert.deepEqual(parseBoardArgs([]), { all: false, status: null, json: false, closeout: false });
  assert.deepEqual(parseBoardArgs(['--all', '--json']), { all: true, status: null, json: true, closeout: false });
  assert.deepEqual(parseBoardArgs(['--status=Ready']), { all: false, status: 'Ready', json: false, closeout: false });
  assert.deepEqual(parseBoardArgs(['--closeout']), { all: false, status: null, json: false, closeout: true });
});

// #598's defect class: this command's exit code is a proof contract, so a typo must never
// be discarded into a read that then certifies the board clean — nor into a metered read
// that answers a question the operator did not ask.
test('parseBoardArgs: fails loud on an unrecognised argument or a valueless --status=', () => {
  for (const bad of ['--closout', '-closeout', '--closeout=true', '--status=', '--all=yes', 'Ready']) {
    assert.throws(
      () => parseBoardArgs([bad]),
      (err) => err.message.includes(bad) && err.message.includes('usage: node scripts/board.mjs'),
      bad,
    );
  }
  assert.throws(() => parseBoardArgs(['--json', '--verbose']), /--verbose/);
});

test('parseBoardArgs: --closeout is exclusive, --all and --status= are exclusive, and --status= may not repeat', () => {
  // --closeout prints the scan alone, so any companion flag would promise output it never
  // emits. Every pairing, so no single flag can slip through beside the proof gate.
  for (const other of ['--all', '--json', '--status=Ready']) {
    assert.throws(() => parseBoardArgs(['--closeout', other]), /--closeout takes no other argument/, other);
    assert.throws(() => parseBoardArgs([other, '--closeout']), /--closeout takes no other argument/, other);
  }
  // --all with --status= selects by --all but would label the header with the status.
  assert.throws(() => parseBoardArgs(['--all', '--status=Ready']), /--all and --status=Ready are exclusive/);
  // A repeat silently kept the FIRST, so the answer was never the question asked.
  assert.throws(
    () => parseBoardArgs(['--status=Ready', '--status=Done']),
    /only one --status= filter is allowed, got --status=Ready --status=Done/,
  );
});

// STATUS_OPTIONS is the board's whole column vocabulary, so a value outside it selects
// nothing — and the command would spend a metered read to report `Rady: 0 of 171
// item(s)`, an answer to a question nobody asked (the same #598 defect class the
// unrecognised-argument guard covers). Exact, never fuzzy: a near-miss the parser
// "corrected" would answer a different question just as silently.
test('parseBoardArgs: rejects a --status= value that is not a board column, and accepts every one that is', () => {
  assert.throws(
    () => parseBoardArgs(['--status=Rady']),
    (err) => err.message.includes('--status=Rady is not a board column')
      && STATUS_OPTIONS.every((column) => err.message.includes(column))
      && err.message.includes('usage: node scripts/board.mjs'),
  );
  // Case is part of the name: the board has no lower-case column.
  assert.throws(() => parseBoardArgs([`--status=${STATUS_OPTIONS[1].toLowerCase()}`]), /is not a board column/);
  for (const column of STATUS_OPTIONS) {
    assert.deepEqual(
      parseBoardArgs([`--status=${column}`]),
      { all: false, status: column, json: false, closeout: false },
      column,
    );
  }
});

// #461: boardQuery/parseBoardPage replaced `gh project item-list` (203 GraphQL
// points/read) with a ~2-points-per-page hand-rolled query. These values come from a
// REAL captured page-1 response (2026-07-20, project 2). The shared builder supplies
// the current connection counts and queried typenames; the empty `{}` unmatched-fragment
// field values remain captured exactly, and so do the Model/Effort values the board
// still carries and this reader deliberately ignores.
const REAL_ISSUE_NODE = leanNode({
  id: 'PVTI_lAHOA50uGs4BcfoOzgx01fY',
  content: {
    __typename: 'Issue',
    number: 319,
    title: 'Move refresh() and upsertChart into their own source pieces',
    labels: [],
  },
  fieldValues: [
    {},
    { text: 'Move refresh() and upsertChart into their own source pieces', field: { name: 'Title' } },
    { name: 'Done', field: { name: 'Status' } },
    { name: 'Product', field: { name: 'Workstream' } },
    { name: 'Sonnet 5', field: { name: 'Model' } },
  ],
});
const REAL_LABELLED_NODE = leanNode({
  id: 'PVTI_lAHOA50uGs4BcfoOzgxw3wE',
  content: {
    __typename: 'Issue',
    number: 263,
    title: 'Review batch 4 — interaction/desktop breaks',
    labels: ['type:feature', 'area:ui', 'area:desktop', 'autonomy:supervised'],
    assignees: [BOARD_OWNER],
    blockers: [{ number: 261, state: 'OPEN' }, { number: 262, state: 'CLOSED' }],
    closingPullRequests: [{ number: 1133 }],
    subIssuesSummary: { total: 2, completed: 1 },
  },
  fieldValues: [
    {},
    {},
    { text: 'Review batch 4 — interaction/desktop breaks', field: { name: 'Title' } },
    { name: 'Done', field: { name: 'Status' } },
    { name: 'Opus 4.8', field: { name: 'Model' } },
    { name: 'high', field: { name: 'Effort' } },
    { name: 'Product', field: { name: 'Workstream' } },
  ],
});
// Captured before the query asked for `content { __typename }`. The typename is restored here
// because a draft is numberless BY DESIGN: without it isContentUnresolved() would call this fixture an
// unresolved read, so the canonical draft node would silently exercise the lagging-read path instead (#572).
const REAL_DRAFT_NODE = leanNode({
  id: 'PVTI_lAHOA50uGs4BcfoOzgx0mxg',
  content: { __typename: 'DraftIssue' },
  fieldValues: [
    { text: 'Trial Blacksmith CI runners (free 3k min/mo) — maybe for a future project', field: { name: 'Title' } },
    { name: 'Backlog', field: { name: 'Status' } },
    { name: 'Platform', field: { name: 'Workstream' } },
  ],
});
const BOARD_PAGE = leanBoardPage(
  [REAL_ISSUE_NODE, REAL_LABELLED_NODE, REAL_DRAFT_NODE],
  {
    pageInfo: {
      hasNextPage: true,
      endCursor: 'Y3Vyc29yOnYyOpK5MDAwMDAwMDAuMDA5MzQ1Nzk0MzkyNTIzM84Mz1dk',
    },
  },
);

// #1155: `gh api graphql --paginate` walks the pages itself, on exactly this contract —
// a declared `$endCursor` variable fed to the items connection, and ONE pageInfo it can
// find. A second pageInfo (say on labels) would have gh page the wrong connection.
test('boardQuery declares the $endCursor variable gh --paginate walks on, and carries exactly one pageInfo', () => {
  const q = boardQuery();
  assert.match(q, /^query\(\$endCursor: String\) \{/);
  assert.match(q, /items\(first:100, after:\$endCursor\)/);
  assert.equal(q.split('pageInfo').length - 1, 1);
  assert.match(q, /pageInfo \{ hasNextPage endCursor \}/);
});

test('boardQuery asks for every field the fused read carries, each capped sub-list with its totalCount', () => {
  const q = boardQuery();
  // Drop state or the summary and the epic passes fail the scan loud instead of two gh
  // calls per epic quietly coming back (#1154).
  assert.match(q, /\.\.\. on Issue \{ number title state repository \{ nameWithOwner \} subIssuesSummary \{ total completed \}/);
  assert.match(q, /labels\(first:20\) \{ totalCount nodes \{ name \} \}/);
  assert.match(q, /assignees\(first:20\) \{ totalCount nodes \{ login \} \}/);
  assert.match(q, /blockedBy\(first:20\) \{ totalCount nodes \{ number state \} \}/);
  assert.match(q, /closedByPullRequestsReferences\(first:20\) \{ totalCount nodes \{ number \} \}/);
  assert.match(q, /items\(first:100, after:\$endCursor\) \{ totalCount/);
  assert.match(q, /fieldValues\(first:20\) \{ totalCount/);
});

test('boardQuery asks for the project identity and field schema every page is checked against', () => {
  const q = boardQuery();
  assert.match(q, new RegExp(`user\\(login:"${BOARD_OWNER}"\\) \\{ login`));
  assert.match(q, new RegExp(`projectV2\\(number:${BOARD_PROJECT_NUMBER}\\) \\{ id number closed`));
  assert.match(q, /fields\(first:50\) \{ totalCount nodes \{ \.\.\. on ProjectV2FieldCommon \{ name dataType \}/);
  assert.match(q, /\.\.\. on ProjectV2SingleSelectField \{ options \{ name \} \}/);
});

// #1155: the whole walk is ONE gh process. The executor is called once, with
// `--paginate --slurp` and the $endCursor query, and hands back the slurped page
// array; every walk check the page-by-page loop used to make now runs over that array.
test('fetchBoard walks the slurped pages of one gh call in order and fails loud on malformed or failed reads', () => {
  const firstPage = structuredClone(BOARD_PAGE);
  firstPage.data.user.projectV2.items.totalCount = 2;
  firstPage.data.user.projectV2.items.nodes = [REAL_ISSUE_NODE];
  firstPage.data.user.projectV2.items.pageInfo = { hasNextPage: true, endCursor: 'page-one-cursor' };
  const secondPage = structuredClone(BOARD_PAGE);
  secondPage.data.user.projectV2.items.totalCount = 2;
  secondPage.data.user.projectV2.items.nodes = [REAL_DRAFT_NODE];
  secondPage.data.user.projectV2.items.pageInfo = { hasNextPage: false, endCursor: null };
  const calls = [];
  const items = fetchBoard((args) => {
    calls.push(args);
    return JSON.stringify([firstPage, secondPage]);
  });

  assert.deepEqual(items, [
    {
      id: 'PVTI_lAHOA50uGs4BcfoOzgx01fY', status: 'Done',
      title: 'Move refresh() and upsertChart into their own source pieces',
      routing: 'Product', labels: [], assignees: [], blockers: [], closingPullRequests: [],
      content: { __typename: 'Issue', number: 319, state: 'OPEN', subIssuesSummary: { total: 0, completed: 0 } },
    },
    {
      id: 'PVTI_lAHOA50uGs4BcfoOzgx0mxg', status: 'Backlog',
      title: 'Trial Blacksmith CI runners (free 3k min/mo) — maybe for a future project',
      routing: 'Platform', labels: [], assignees: [], blockers: [], closingPullRequests: [],
      content: { __typename: 'DraftIssue' },
    },
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 5), ['api', 'graphql', '--paginate', '--slurp', '-f']);
  assert.equal(calls[0][5], `query=${boardQuery()}`);

  // Unslurped output: a bare page object (what a one-page board yields without --slurp)
  // or an empty walk is never a board.
  assert.throws(() => fetchBoard(() => JSON.stringify(firstPage)), /--slurp/);
  assert.throws(() => fetchBoard(() => '[]'), /--slurp/);
  assert.throws(() => fetchBoard(() => '[[]]'), /--slurp/);
  assert.throws(() => fetchBoard(() => '[{}]'), /board page/);
  assert.throws(() => fetchBoard(() => { throw new Error('offline'); }), /offline/);

  const missingCursorPage = structuredClone(firstPage);
  missingCursorPage.data.user.projectV2.items.pageInfo.endCursor = null;
  assert.throws(
    () => fetchBoard(() => JSON.stringify([missingCursorPage, secondPage])),
    /pagination.*endCursor/,
  );
  assert.throws(
    () => fetchBoard(() => JSON.stringify([firstPage, firstPage, secondPage])),
    /pagination.*repeated.*page-one-cursor/,
  );
  // gh stopped early: the final page still points onward.
  assert.throws(
    () => fetchBoard(() => JSON.stringify([firstPage])),
    /incomplete board items read.*last page still reports hasNextPage.*rerun/i,
  );
  // A page after the one gh should have stopped on.
  assert.throws(
    () => fetchBoard(() => JSON.stringify([secondPage, secondPage])),
    /incomplete board items read.*page 1 of 2 reports no next page.*rerun/i,
  );
});

test('fetchBoard rejects a short read and accepts an exact one', () => {
  const page = ({ totalCount, nodes = [REAL_ISSUE_NODE], hasNextPage = false, endCursor = null }) =>
    leanBoardPage(nodes, { totalCount, pageInfo: { hasNextPage, endCursor } });
  const fetchPages = (...pages) => fetchBoard(() => JSON.stringify(pages));

  assert.equal(fetchPages(page({ totalCount: 1 })).length, 1);
  assert.throws(
    () => fetchPages(page({ totalCount: 2 })),
    /incomplete board items read.*2.*1.*rerun/i,
  );

  assert.throws(
    () => fetchPages(
      page({ totalCount: 2, hasNextPage: true, endCursor: 'next' }),
      page({ totalCount: 3, nodes: [REAL_DRAFT_NODE] }),
    ),
    /incomplete board items read.*totalCount.*2.*3.*rerun/i,
  );
});

// Guard 6: the walk must be one project's, read against one field schema. A page
// answered for a different project, or read after the Status/routing options changed
// mid-walk, is two half-boards spliced together — every rule downstream would judge
// cards against a schema the read never saw whole.
test('fetchBoard throws when the project identity or the field schema changes across pages', () => {
  const first = leanBoardPage([REAL_ISSUE_NODE], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'c1' } });
  const second = leanBoardPage([REAL_DRAFT_NODE], { totalCount: 2 });
  const fetchPages = (...pages) => fetchBoard(() => JSON.stringify(pages));

  assert.equal(fetchPages(first, second).length, 2);

  const otherProject = structuredClone(second);
  otherProject.data.user.projectV2.id = 'PVT_someone_else';
  assert.throws(() => fetchPages(first, otherProject), /project identity changed across pages.*rerun/i);

  // A field added mid-walk: the per-page schema guard passes it (it is neither Status
  // nor the routing field), so only the across-pages comparison can see it.
  const otherSchema = structuredClone(second);
  otherSchema.data.user.projectV2.fields.nodes.push({ name: 'Notes', dataType: 'TEXT' });
  otherSchema.data.user.projectV2.fields.totalCount += 1;
  assert.throws(() => fetchPages(first, otherSchema), /field schema changed across pages.*rerun/i);
});

test('parseBoardPage maps a fully-fielded issue card to the exact raw shape', () => {
  const { items } = parseBoardPage(BOARD_PAGE);
  assert.deepEqual(items[0], {
    id: 'PVTI_lAHOA50uGs4BcfoOzgx01fY',
    status: 'Done',
    title: 'Move refresh() and upsertChart into their own source pieces',
    routing: 'Product',
    labels: [],
    assignees: [],
    blockers: [],
    closingPullRequests: [],
    content: { __typename: 'Issue', number: 319, state: 'OPEN', subIssuesSummary: { total: 0, completed: 0 } },
  });
});

test('parseBoardPage carries labels, assignees, blockers and closing pull requests through one read', () => {
  const { items } = parseBoardPage(BOARD_PAGE);
  assert.deepEqual(items[1], {
    id: 'PVTI_lAHOA50uGs4BcfoOzgxw3wE',
    status: 'Done',
    title: 'Review batch 4 — interaction/desktop breaks',
    routing: 'Product',
    labels: ['type:feature', 'area:ui', 'area:desktop', 'autonomy:supervised'],
    assignees: [BOARD_OWNER],
    blockers: [{ number: 261, state: 'OPEN' }, { number: 262, state: 'CLOSED' }],
    closingPullRequests: [{ number: 1133 }],
    content: { __typename: 'Issue', number: 263, state: 'OPEN', subIssuesSummary: { total: 2, completed: 1 } },
  });
  // The normalized card keeps only the OPEN blockers: a closed blocker blocks nothing.
  assert.deepEqual(normalizeItem(items[1]).openBlockers, [261]);
});

test('parseBoardPage carries a draft\'s __typename through with the Title fieldValue text fallback (no content.number)', () => {
  const { items } = parseBoardPage(BOARD_PAGE);
  assert.deepEqual(items[2], {
    id: 'PVTI_lAHOA50uGs4BcfoOzgx0mxg',
    status: 'Backlog',
    title: 'Trial Blacksmith CI runners (free 3k min/mo) — maybe for a future project',
    routing: 'Platform',
    labels: [],
    assignees: [],
    blockers: [],
    closingPullRequests: [],
    content: { __typename: 'DraftIssue' },
  });
  // Feeds normalizeItem exactly like a real board item: no linked issue → null number. The typename
  // is what keeps that numberlessness a DESIGN fact rather than an unresolved read (#572).
  assert.equal(normalizeItem(items[2]).number, null);
  assert.equal(isContentUnresolved(items[2]), false);
});

// NOT guards, deliberately: this board legitimately holds draft cards, pull-request
// cards, and cards an item-add left with no Status and no routing value. They are
// reported as drift rows downstream, so a parser that threw on them would strand
// every session instead.
test('parseBoardPage accepts the numberless and unfielded cards this board legitimately holds', () => {
  const { items } = parseBoardPage(leanBoardPage([
    leanNode({ id: 'PVTI_draft', content: { __typename: 'DraftIssue' }, title: 'a draft note', status: 'Backlog', routing: 'Product' }),
    leanNode({ id: 'PVTI_pr', content: { __typename: 'PullRequest' }, title: 'a pull request card', status: 'Ready', routing: 'Product' }),
    leanNode({ id: 'PVTI_no_status', content: { __typename: 'Issue', number: 11, title: 'no status' }, routing: 'Product' }),
    leanNode({ id: 'PVTI_no_routing', content: { __typename: 'Issue', number: 12, title: 'no routing' }, status: 'Ready' }),
  ]));

  assert.deepEqual(items.map((i) => [i.id, i.status, i.routing]), [
    ['PVTI_draft', 'Backlog', 'Product'],
    ['PVTI_pr', 'Ready', 'Product'],
    ['PVTI_no_status', null, 'Product'],
    ['PVTI_no_routing', 'Ready', null],
  ]);
});

test('fixture keeps unresolved content null until the board parser normalizes it', () => {
  const unresolvedNode = leanNode({ id: 'PVTI_unresolved', content: null, status: 'In progress' });

  assert.equal(unresolvedNode.content, null);
  const { items } = parseBoardPage(leanBoardPage([unresolvedNode]));
  assert.deepEqual(items[0].content, {});
  assert.equal(isContentUnresolved(items[0]), true);
});

test('fixture rejects explicit field values mixed with named field shorthands', () => {
  assert.throws(
    () => leanNode({ fieldValues: [], status: 'Ready' }),
    /either fieldValues or named field shorthands/,
  );
});

test('parseBoardPage passes pageInfo through as hasNextPage/endCursor', () => {
  const page = parseBoardPage(BOARD_PAGE);
  assert.equal(page.hasNextPage, true);
  assert.equal(page.endCursor, 'Y3Vyc29yOnYyOpK5MDAwMDAwMDAuMDA5MzQ1Nzk0MzkyNTIzM84Mz1dk');
  assert.equal(page.totalCount, 3);
});

// One numbered issue card, fully fielded — the base every guard test below mutates
// into the malformed shape it is about.
const guardNode = (content = {}, node = {}) => leanNode({
  id: 'PVTI_guard',
  content: { __typename: 'Issue', number: 9, title: 'a card', ...content },
  status: 'Ready',
  routing: 'Product',
  ...node,
});
const parseNodes = (...nodes) => parseBoardPage(leanBoardPage(nodes));
const parseMutated = (mutate, nodes = [guardNode()]) => {
  const page = leanBoardPage(nodes);
  mutate(page.data.user.projectV2, page.data.user, page);
  return parseBoardPage(page);
};

// Guard 1. A read that came back as anything but one GraphQL data object is a failed
// read, and must never be parsed into a small board.
test('parseBoardPage throws on unparseable JSON, on a non-object, and on a response carrying GraphQL errors', () => {
  assert.throws(() => parseBoardPage('{not json'), /board page JSON could not be parsed.*rerun the board read/s);
  assert.throws(() => parseBoardPage('"a string"'), /board page.*not a GraphQL data object.*rerun the board read/s);
  assert.throws(() => parseBoardPage(null), /board page.*not a GraphQL data object.*rerun the board read/s);
  assert.throws(() => parseBoardPage({ data: null }), /board page carried no user data.*rerun the board read/s);
  assert.throws(
    () => parseBoardPage({ errors: [{ message: 'Could not resolve to a User' }] }),
    /board read returned GraphQL errors: Could not resolve to a User/,
  );
});

// Guard 2. `totalCount` is the only evidence a connection came back whole, so a
// missing or non-integer one is a broken read, never a pass.
test('parseBoardPage throws when a connection has no integer totalCount or no nodes array', () => {
  for (const broken of [undefined, '1', -1, 1.5, null]) {
    assert.throws(
      () => parseMutated((project) => { project.items.totalCount = broken; }),
      /malformed items connection.*integer totalCount.*rerun the board read/s,
    );
  }
  assert.throws(
    () => parseMutated((project) => { project.items.nodes = null; }),
    /malformed items connection.*nodes\[\] array.*rerun the board read/s,
  );
  assert.throws(
    () => parseNodes(guardNode({ labels: { totalCount: '2', nodes: [] } })),
    /malformed labels connection.*integer totalCount/s,
  );
  assert.throws(
    () => parseMutated((project) => { project.fields.totalCount = undefined; }),
    /malformed project fields connection.*integer totalCount/s,
  );
});

// Guard 3. A card with more labels/assignees/blockers/closing references than the
// `first:` cap would otherwise be silently narrowed (#464 review) — and a dropped
// closing reference would make an in-flight claim read as stalled.
test('parseBoardPage throws when any capped sub-list is truncated, naming the cap to raise', () => {
  const truncated = (make) => ({ totalCount: 25, nodes: Array.from({ length: 20 }, (_, i) => make(i)) });
  const cases = [
    ['labels', guardNode({ labels: truncated((i) => ({ name: `l${i}` })) })],
    ['assignees', guardNode({ assignees: truncated((i) => ({ login: `u${i}` })) })],
    ['blockedBy', guardNode({ blockers: truncated((i) => ({ number: i + 1, state: 'OPEN' })) })],
    ['closedByPullRequestsReferences', guardNode({ closingPullRequests: truncated((i) => ({ number: i + 1 })) })],
  ];
  for (const [what, node] of cases) {
    assert.throws(
      () => parseNodes(node),
      new RegExp(`board item PVTI_guard has 25 ${what} but only 20 fetched — raise the ${what} first: cap in boardQuery`),
    );
  }

  const fieldValuesNode = guardNode();
  fieldValuesNode.fieldValues = { totalCount: 25, nodes: fieldValuesNode.fieldValues.nodes };
  assert.throws(() => parseNodes(fieldValuesNode), /has 25 fieldValues but only 2 fetched.*raise the fieldValues first: cap in boardQuery/);

  // Exactly at the cap → fine.
  const full = { totalCount: 20, nodes: Array.from({ length: 20 }, (_, i) => ({ name: `l${i}` })) };
  assert.equal(parseNodes(guardNode({ labels: full })).items[0].labels.length, 20);
});

// Guard 3b. The capped sub-lists are fetched WHOLE, so the count and the nodes must
// agree in BOTH directions. A totalCount SMALLER than the nodes returned is an
// under-reporting response, and it is not harmless: a closing reference arriving under
// `totalCount: 0` comes from a response that contradicts itself, and closing references
// are what decide whether an in-flight claim reads as stalled.
test('parseBoardPage throws when a capped sub-list reports FEWER than the nodes it carries', () => {
  const cases = [
    ['closedByPullRequestsReferences', 0, 1, guardNode({
      closingPullRequests: { totalCount: 0, nodes: [{ number: 1133 }] },
    })],
    ['labels', 1, 2, guardNode({
      labels: { totalCount: 1, nodes: [{ name: 'type:task' }, { name: 'plan-first' }] },
    })],
  ];
  for (const [what, totalCount, fetched, node] of cases) {
    assert.throws(
      () => parseNodes(node),
      new RegExp(
        `board item PVTI_guard returned ${fetched} ${what} but reports totalCount ${totalCount}.*rerun the board read`,
        's',
      ),
      what,
    );
  }
});

// Guard 3c. gh --paginate decides whether to ask for another page from this pair alone,
// so a coerced one is a page decision made on a malformed value: a string "false" reads
// as true, a missing hasNextPage as false, and either silently truncates or loops the
// walk. A next page also has to say WHERE, so hasNextPage without a usable cursor is a
// broken read rather than a walk that quietly stops.
test('parseBoardPage throws on a non-boolean hasNextPage and on a next page with no usable cursor', () => {
  for (const bad of ['true', 'false', 1, 0, null, undefined]) {
    assert.throws(
      () => parseMutated((project) => { project.items.pageInfo = { hasNextPage: bad, endCursor: 'c1' }; }),
      /board page pagination carried no boolean hasNextPage.*rerun the board read/s,
      String(bad),
    );
  }
  assert.throws(
    () => parseMutated((project) => { delete project.items.pageInfo; }),
    /board page pagination carried no boolean hasNextPage/,
  );
  for (const cursor of [null, undefined, '', '   ', 7]) {
    assert.throws(
      () => parseMutated((project) => { project.items.pageInfo = { hasNextPage: true, endCursor: cursor }; }),
      /board page pagination reports hasNextPage without a non-empty endCursor.*rerun the board read/s,
      String(cursor),
    );
  }
  // The final page legitimately carries a null cursor.
  const last = parseMutated((project) => { project.items.pageInfo = { hasNextPage: false, endCursor: null }; });
  assert.equal(last.hasNextPage, false);
  assert.equal(last.endCursor, null);
});

// Guard 4. A single-select field holds one value per card. Two would make which one
// the reader picked an accident of node order.
test('parseBoardPage throws on a duplicate Status or routing value on one card', () => {
  const duplicated = (name) => leanNode({
    id: 'PVTI_guard',
    content: { __typename: 'Issue', number: 9, title: 'a card' },
    fieldValues: [
      { name: name === 'Status' ? 'Ready' : 'Product', field: { name } },
      { name: name === 'Status' ? 'Backlog' : 'Platform', field: { name } },
    ],
  });
  assert.throws(() => parseNodes(duplicated('Status')), /board item PVTI_guard carried 2 "Status" values.*one value per card/s);
  assert.throws(
    () => parseNodes(duplicated(ROUTING_FIELD)),
    new RegExp(`board item PVTI_guard carried 2 "${ROUTING_FIELD}" values`),
  );
});

// Guard 5. Every page must be the configured project's. #572: an absence probe once
// asked a different project than the board read it was confirming.
test('parseBoardPage throws when a page is not the configured, open project', () => {
  assert.throws(
    () => parseMutated((project, user) => { user.login = 'someone-else'; }),
    new RegExp(`answered for user "someone-else".*BOARD_OWNER is "${BOARD_OWNER}".*board-config\\.mjs`, 's'),
  );
  assert.throws(
    () => parseMutated((project) => { project.number = 7; }),
    new RegExp(`answered for project 7.*BOARD_PROJECT_NUMBER is ${BOARD_PROJECT_NUMBER}.*board-config\\.mjs`, 's'),
  );
  assert.throws(
    () => parseMutated((project) => { project.id = '   '; }),
    /carried no project id.*rerun the board read/s,
  );
  assert.throws(
    () => parseMutated((project) => { project.closed = true; }),
    /board project .* is closed.*reopen it.*board-config\.mjs/s,
  );
  assert.throws(
    () => parseMutated((project) => { delete project.closed; }),
    /carried no boolean closed flag.*rerun the board read/s,
  );
});

// Guard 9. The reader's whole vocabulary is board-config's option lists; a live board
// that no longer matches them is judged against names it does not have.
test('parseBoardPage throws when Status or the routing field is missing, not single-select, or offers other options', () => {
  const fieldIndex = { Status: 1, [ROUTING_FIELD]: 2 };
  for (const [name, index] of Object.entries(fieldIndex)) {
    assert.throws(
      () => parseMutated((project) => { project.fields.nodes.splice(index, 1); project.fields.totalCount -= 1; }),
      new RegExp(`board has no "${name}" field.*board-config\\.mjs`, 's'),
    );
    assert.throws(
      () => parseMutated((project) => { project.fields.nodes[index].dataType = 'TEXT'; }),
      new RegExp(`"${name}" is a TEXT field, not SINGLE_SELECT.*board-config\\.mjs`, 's'),
    );
    assert.throws(
      () => parseMutated((project) => { project.fields.nodes[index].options.push({ name: 'Nope' }); }),
      new RegExp(`"${name}" field offers .*Nope.*board-config\\.mjs configures`, 's'),
    );
  }
  // The message names both sets so the operator can see which side moved.
  assert.throws(
    () => parseMutated((project) => { project.fields.nodes[1].options.pop(); }),
    new RegExp(STATUS_OPTIONS.join(', ')),
  );
  assert.throws(
    () => parseMutated((project) => { project.fields.nodes[2].options.pop(); }),
    new RegExp(ROUTING_OPTIONS.join(', ')),
  );
});

// Guard 10. A numbered Issue card is the shape every downstream rule judges, so a
// field it came back malformed in stops the read rather than being defaulted: an
// unnumbered closing reference or a missing state would silently flip a verdict.
test('parseBoardPage throws on a malformed numbered Issue card', () => {
  assert.throws(
    () => parseNodes(guardNode({ state: 'DRAFT' })),
    /board card #9 came back with state "DRAFT".*expected OPEN or CLOSED.*rerun the board read/s,
  );
  assert.throws(
    () => parseNodes(guardNode({ state: null })),
    /board card #9 came back with state "null".*expected OPEN or CLOSED/s,
  );
  for (const summary of [null, { total: 2 }, { total: 1, completed: 2 }, { total: -1, completed: 0 }]) {
    assert.throws(
      () => parseNodes(guardNode({ subIssuesSummary: summary })),
      /board card #9 carried no usable sub-issue summary.*total.*completed.*rerun the board read/s,
    );
  }
  for (const reference of [{}, { number: 0 }, { number: '5' }]) {
    assert.throws(
      () => parseNodes(guardNode({ closingPullRequests: [reference] })),
      /board card #9 carried a closing pull-request reference without a number.*rerun the board read/s,
    );
  }
  for (const blocker of [{ number: 5 }, { state: 'OPEN' }, { number: 5, state: 'MERGED' }]) {
    assert.throws(
      () => parseNodes(guardNode({ blockers: [blocker] })),
      /board card #9 carried a blocker without a number and an OPEN or CLOSED state.*rerun the board read/s,
    );
  }
  assert.throws(
    () => parseNodes(guardNode({ repository: { nameWithOwner: `${BOARD_OWNER}/other-repo` } })),
    new RegExp(`board card #9 belongs to ${BOARD_OWNER}/other-repo, not ${BOARD_OWNER}/${BOARD_REPOSITORY}.*board-config\\.mjs`, 's'),
  );
  assert.throws(
    () => parseNodes(guardNode({ repository: null })),
    new RegExp(`board card #9 belongs to no repository, not ${BOARD_OWNER}/${BOARD_REPOSITORY}`, 's'),
  );
});

// Guard 11. One issue, one card. Two cards for the same number make every count and
// every per-card verdict ambiguous, and one of them is stale by definition.
test('parseBoardPage and fetchBoard throw when the same issue number appears on two cards', () => {
  const twice = [
    guardNode({}, { id: 'PVTI_a' }),
    guardNode({}, { id: 'PVTI_b' }),
  ];
  assert.throws(() => parseNodes(...twice), /issue #9 appears on 2 board cards.*remove the duplicate card/s);

  // Across pages too: neither page is duplicated on its own.
  const first = leanBoardPage([twice[0]], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'c1' } });
  const second = leanBoardPage([twice[1]], { totalCount: 2 });
  assert.throws(
    () => fetchBoard(() => JSON.stringify([first, second])),
    /issue #9 appears on 2 board cards.*remove the duplicate card/s,
  );
});

// Guard 12. The item id is the card's own identity, so the SAME id twice is not two
// cards but one card the response repeated — a doubled row and a doubled count out of a
// read that never saw two. Distinct issue numbers, so guard 11 cannot be what fires.
test('parseBoardPage and fetchBoard throw when the same item id is returned on two cards', () => {
  const twice = [
    guardNode({ number: 9 }, { id: 'PVTI_same' }),
    guardNode({ number: 10 }, { id: 'PVTI_same' }),
  ];
  assert.throws(() => parseNodes(...twice), /board item PVTI_same was returned on 2 cards.*rerun the board read/s);

  // Across pages too: neither page repeats the id on its own.
  const first = leanBoardPage([twice[0]], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'c1' } });
  const second = leanBoardPage([twice[1]], { totalCount: 2 });
  assert.throws(
    () => fetchBoard(() => JSON.stringify([first, second])),
    /board item PVTI_same was returned on 2 cards.*rerun the board read/s,
  );
});

test('normalizeItem flattens exactly the fields the board rules judge a card on', () => {
  const { items } = parseBoardPage(BOARD_PAGE);
  assert.deepEqual(normalizeItem(items[1]), {
    number: 263,
    status: 'Done',
    title: 'Review batch 4 — interaction/desktop breaks',
    routing: 'Product',
    parked: false,
    labels: ['type:feature', 'area:ui', 'area:desktop', 'autonomy:supervised'],
    state: 'OPEN',
    assignees: [BOARD_OWNER],
    openBlockers: [261],
    closingPullRequests: [{ number: 1133 }],
    subIssues: { total: 2, completed: 1 },
  });
  // Missing fields default, never throw (the "In review" item carries nothing but a number).
  const bare = normalizeItem(BOARD.items[3]);
  assert.equal(bare.number, 296);
  assert.equal(bare.routing, null);
  assert.equal(bare.state, null);
  assert.equal(bare.subIssues, null);
  assert.deepEqual(bare.labels, []);
  assert.deepEqual(bare.openBlockers, []);
});

test('normalizeItem publishes the routing view only — no Model, no Effort, no internal unresolved-content flag', () => {
  // `board --json` prints normalizeItem's output verbatim, so an internal flag added for
  // issue-publish must never widen that published shape (#572), and the board's Model and
  // Effort fields have left this reader entirely.
  assert.deepEqual(Object.keys(normalizeItem(BOARD.items[0])).sort(), [
    'assignees', 'closingPullRequests', 'labels', 'number', 'openBlockers',
    'parked', 'routing', 'state', 'status', 'subIssues', 'title',
  ]);
});

test('sortForDisplay ranks Ready before Backlog, then ascending number', () => {
  const sorted = sortForDisplay(pickable(BOARD.items)).map((i) => i.content.number);
  assert.deepEqual(sorted, [266, 264]); // Ready(266) before Backlog(264) despite 266>264
});

test('formatRow renders #num, [status], title and labels — and no Model/Effort suffix', () => {
  const row = formatRow(BOARD.items[1]);
  assert.equal(row, '#264 [Backlog] Review batch 5\n    tripwire, plan-first');
});

test('formatRow degrades gracefully with no labels (— placeholder)', () => {
  assert.equal(formatRow(BOARD.items[3]), '#296 [In review] Mid flight\n    —');
});

test('formatList orders then renders the given selection', () => {
  const out = formatList(pickable(BOARD.items));
  // #266 (Ready) block appears before #264 (Backlog) block.
  assert.ok(out.indexOf('#266') < out.indexOf('#264'));
  // It renders only what it was given — Done #293 is absent.
  assert.equal(out.includes('#293'), false);
});

// Product outnumbers Go-to-market (2 vs 1) and sorts earlier by number —
// the mutation guard: a flat/number-ordered list would put #200 before #391.
const ROUTED_ITEMS = [
  { status: 'Backlog', title: 'Product A', routing: 'Product', content: { number: 100 } },
  { status: 'Backlog', title: 'Product B', routing: 'Product', content: { number: 200 } },
  { status: 'Backlog', title: 'GTM item', routing: 'Go-to-market', content: { number: 391 } },
  { status: 'Backlog', title: 'No routing', routing: null, content: { number: 500 } },
  { status: 'Backlog', title: 'New field', routing: 'Legal', content: { number: 600 } },
];

test('groupByRouting puts Go-to-market FIRST even though Product outnumbers it and sorts earlier by number', () => {
  const groups = groupByRouting(ROUTED_ITEMS);
  assert.equal(groups[0].routing, 'Go-to-market');
  assert.deepEqual(groups[0].items.map((i) => i.content.number), [391]);
});

test('groupByRouting keeps an unfielded item in the trailing Unfielded group — never dropped', () => {
  const groups = groupByRouting(ROUTED_ITEMS);
  const unfielded = groups.find((g) => g.routing === 'Unfielded');
  assert.ok(unfielded);
  assert.deepEqual(unfielded.items.map((i) => i.content.number), [500]);
  // No item lost across the split.
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, ROUTED_ITEMS.length);
});

// An empty-string field is absent, not a group named "" — else the reader
// renders a nameless `── (1) ──` heading.
test('groupByRouting treats an empty-string routing value as Unfielded, not an unnamed group', () => {
  const groups = groupByRouting([
    { status: 'Backlog', title: 'Blank field', routing: '', content: { number: 700 } },
  ]);
  assert.deepEqual(groups.map((g) => g.routing), ['Unfielded']);
});

test('groupByRouting omits empty groups (no Platform group when nothing is on it)', () => {
  const groups = groupByRouting(ROUTED_ITEMS);
  assert.equal(groups.some((g) => g.routing === 'Platform'), false);
});

test('groupByRouting surfaces an unrecognised routing value after the known ones, before Unfielded', () => {
  const groups = groupByRouting(ROUTED_ITEMS);
  assert.deepEqual(groups.map((g) => g.routing), ['Go-to-market', 'Product', 'Legal', 'Unfielded']);
});

// Every routing option carries a card, plus Brand, which is not an option and must
// still reach the unrecognised-value fallback AFTER all of them. Brand sorts
// alphabetically before two of the three names, so a grouping that fell back to
// alphabetical order would flip the head of this list.
const ALL_ROUTED_ITEMS = [
  { status: 'Backlog', title: 'Brand item', routing: 'Brand', content: { number: 602 } },
  { status: 'Backlog', title: 'Platform item', routing: 'Platform', content: { number: 603 } },
  { status: 'Backlog', title: 'Product item', routing: 'Product', content: { number: 604 } },
  { status: 'Backlog', title: 'GTM item', routing: 'Go-to-market', content: { number: 605 } },
];

test('groupByRouting orders groups by ROUTING_OPTIONS and still falls back for a value outside it', () => {
  // The live board's routing field offers exactly these three. Pinned literally
  // so adding a fourth option, or reordering them, fails here first.
  assert.deepEqual(ROUTING_OPTIONS, ['Go-to-market', 'Product', 'Platform']);
  // The live board belongs to a personal account, so it is read under the `user` root.
  assert.equal(BOARD_OWNER_TYPE, 'user');
  const groups = groupByRouting(ALL_ROUTED_ITEMS);
  assert.deepEqual(groups.map((g) => g.routing), [
    'Go-to-market',
    'Product',
    'Platform',
    'Brand',
  ]);
  // The fallback survives the enumerated options: Brand is still caught, and is its
  // own named group rather than being swept into Unfielded.
  assert.deepEqual(
    groups.find((g) => g.routing === 'Brand').items.map((i) => i.content.number),
    [602],
  );
});

test('formatGrouped renders the Go-to-market heading before the Product heading', () => {
  const out = formatGrouped(ROUTED_ITEMS);
  assert.ok(out.indexOf('Go-to-market') < out.indexOf('Product'));
  assert.match(out, /── Go-to-market \(1\) ──/);
  assert.match(out, /── Product \(2\) ──/);
});

test('formatGrouped warns when an unrecognised routing value is rendered without dropping or reordering its cards', () => {
  const items = [
    { status: 'Backlog', title: 'Go-to-market card', routing: 'Go-to-market', content: { number: 701 } },
    { status: 'Ready', title: 'Product card', routing: 'Product', content: { number: 702 } },
    { status: 'Backlog', title: 'Research card', routing: 'Research', content: { number: 703 } },
    { status: 'Backlog', title: 'Unfielded card', content: { number: 704 } },
  ];

  const out = formatGrouped(items);
  const headings = ['Go-to-market', 'Product', 'Research', 'Unfielded'];
  const headingPositions = headings.map((routing) => out.indexOf(`── ${routing} (1) ──`));
  assert.ok(headingPositions.every((position) => position >= 0));
  assert.deepEqual([...headingPositions].sort((a, b) => a - b), headingPositions);
  for (const number of [701, 702, 703, 704]) {
    assert.equal(out.split(`#${number}`).length - 1, 1);
  }
  assert.match(out, /WARNING: unrecognised Workstream value: Research/);
  assert.match(out, /add Research to ROUTING_OPTIONS in scripts\/lib\/board-config\.mjs\./);
  // The skill is one repository's file and this toolkit is copied verbatim into another; the
  // warning must name the config that travels with it, never a path that may not exist there.
  assert.doesNotMatch(out, /\.agents\/skills\/to-issues\/SKILL\.md/);
  assert.doesNotMatch(out, /unrecognised Workstream value: Unfielded/);

  const multipleUnknown = formatGrouped([
    { status: 'Backlog', title: 'Zulu card', routing: 'Zulu', content: { number: 707 } },
    { status: 'Backlog', title: 'Alpha card', routing: 'Alpha', content: { number: 708 } },
  ]);
  assert.match(multipleUnknown, /WARNING: unrecognised Workstream values: Alpha, Zulu/);
  assert.ok(multipleUnknown.indexOf('── Alpha (1) ──') < multipleUnknown.indexOf('── Zulu (1) ──'));
  for (const number of [707, 708]) {
    assert.equal(multipleUnknown.split(`#${number}`).length - 1, 1);
  }

  const syntheticUnfielded = formatGrouped([
    { status: 'Backlog', title: 'Missing routing card', content: { number: 705 } },
  ]);
  assert.match(syntheticUnfielded, /── Unfielded \(1\) ──/);
  assert.equal(syntheticUnfielded.split('#705').length - 1, 1);
  assert.doesNotMatch(syntheticUnfielded, /WARNING: unrecognised Workstream/);

  const literalUnfielded = formatGrouped([
    { status: 'Backlog', title: 'Literal Unfielded card', routing: 'Unfielded', content: { number: 706 } },
  ]);
  assert.match(literalUnfielded, /── Unfielded \(1\) ──/);
  assert.equal(literalUnfielded.split('#706').length - 1, 1);
  assert.match(literalUnfielded, /WARNING: unrecognised Workstream value: Unfielded/);
});
