// board.mjs — pure parse/filter/format for the GitHub Projects board.
//
// Guards the recurring /resume Step-1 failure mode: board reads were ad-hoc
// `gh project item-list | python3 -c '…'` one-liners, re-improvised each session
// and breaking on shell quoting/globbing (zsh globbed the `[...]` in an inline
// parse and aborted the pick). This is the stable read+filter+format layer the
// rituals call instead. I/O lives in the CLI wrapper (scripts/board.mjs); this
// file is pure so it is unit-testable without touching `gh`.
//
// #461: `gh project item-list` costs a measured 203 GraphQL points per full-board
// read. boardQuery/parseBoardPage fetch only the fields the scripts consume — ~2
// points per 100-item page — and replaced parseBoard (deleted, no remaining
// callers). #1155: fetchBoard walks every page inside one
// `gh api graphql --paginate --slurp` process instead of spawning gh once per page.
//
// Do not migrate this read to the REST Projects API: at parity on these
// fields it sends 24.1x the payload, and the quota a migration would save is
// not scarce. Server-side filtering is not a reason either: ProjectV2.items
// takes the same `query` argument REST exposes as `q`.

import {
  BOARD_OWNER,
  BOARD_PROJECT_NUMBER,
  BOARD_REPOSITORY,
  PICKABLE_STATUSES,
  ROUTING_FIELD,
  ROUTING_OPTIONS,
  STATUS_OPTIONS,
} from './board-config.mjs';
import { rejectUnknownArgs } from './cli-flags.mjs';

// The one command's arguments, parsed before any gh call. A typo'd flag would otherwise
// be discarded into the DEFAULT read — a metered board read answering a question the
// operator never asked — and --closeout's exit code is a proof contract, so an
// unrecognised argument stops the command here rather than certifying a board nobody
// asked about (the #598 silent-substitution defect class).
export const BOARD_USAGE = 'usage: node scripts/board.mjs [--all | --status=<Column>] [--json] [--closeout]';

export function parseBoardArgs(argv) {
  // Checked before rejectUnknownArgs, which knows `--status=` as ONE positional and would
  // report a second as merely unrecognised: a repeat silently keeping the first is the same
  // wrong-question defect and earns its own sentence.
  const statusFlags = argv.filter((arg) => arg.startsWith('--status='));
  if (statusFlags.length > 1) {
    throw new Error(`only one --status= filter is allowed, got ${statusFlags.join(' ')} — ${BOARD_USAGE}`);
  }
  rejectUnknownArgs(argv, {
    flags: new Map([['--all', 0], ['--json', 0], ['--closeout', 0]]),
    // An empty `--status=` names no column, so it is rejected here rather than degrading
    // into the default selection.
    positionals: [(arg) => /^--status=.+$/.test(arg)],
    expectation: BOARD_USAGE,
  });
  // --all with --status= selects by --all but would label the header with the status.
  if (argv.includes('--all') && statusFlags.length > 0) {
    throw new Error(`--all and ${statusFlags[0]} are exclusive — ${BOARD_USAGE}`);
  }
  // --closeout is the strict proof gate and prints the scan alone, so any companion flag
  // would promise a listing or a JSON document the gate never emits.
  if (argv.includes('--closeout') && argv.length > 1) {
    throw new Error(`--closeout takes no other argument — ${BOARD_USAGE}`);
  }
  // STATUS_OPTIONS is the board's whole column vocabulary, so a value outside it selects
  // nothing: the same wrong-question defect, one step further in. Checked HERE because
  // the read below is metered — `--status=Rady` must never cost a board read to answer
  // `Rady: 0 of 171 item(s)`. Exact, including case: a near-miss this "corrected" would
  // answer a different question just as silently.
  const status = statusFlags[0]?.slice('--status='.length) ?? null;
  if (status !== null && !STATUS_OPTIONS.includes(status)) {
    throw new Error(
      `--status=${status} is not a board column, expected one of ${STATUS_OPTIONS.join(', ')} — ${BOARD_USAGE}`,
    );
  }
  return {
    all: argv.includes('--all'),
    status,
    json: argv.includes('--json'),
    closeout: argv.includes('--closeout'),
  };
}

// The board's own Status column field. Its option list lives in board-config.mjs;
// only the field's name is needed here, to read one card's value off fieldValues.
const STATUS_FIELD = 'Status';

// The one fused board query: the project's identity and field schema, then its items
// 100 per page, each carrying every fact the board rules judge a card on — Status and
// the routing field off fieldValues, and state, labels, assignees, native blockers,
// closing pull requests and the sub-issue summary off the Issue content.
//
// It declares the `$endCursor` variable and one `pageInfo { hasNextPage endCursor }`
// because that pair is what lets `gh api graphql --paginate` walk every page inside ONE
// gh process (#1155): gh re-sends the query with the last page's endCursor until
// hasNextPage is false. Only the items connection may carry a pageInfo; gh takes the
// first one it finds in a response, so a pageInfo on labels or fieldValues would page
// the wrong list.
//
// `state` and `subIssuesSummary { total completed }` ride on the Issue content so the
// drift check's epic and pickable-closed passes read them off this page (#1154, #1155):
// before, they cost two sequential gh calls per non-terminal epic and one closed-issue
// list of every closed issue in the repository, for fields GitHub attaches to the issue
// node for free.
//
// `__typename` is a free meta field and the ONLY thing that separates a card that is
// legitimately numberless (a draft, a pull request) from one whose content did not
// resolve on this read. Without it both arrive as `number: null` and a just-added card
// reads as never added (#572).
export function boardQuery() {
  return `query($endCursor: String) { user(login:"${BOARD_OWNER}") { login projectV2(number:${BOARD_PROJECT_NUMBER}) { id number closed fields(first:50) { totalCount nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } } } items(first:100, after:$endCursor) { totalCount pageInfo { hasNextPage endCursor } nodes { id content { __typename ... on Issue { number title state repository { nameWithOwner } subIssuesSummary { total completed } labels(first:20) { totalCount nodes { name } } assignees(first:20) { totalCount nodes { login } } blockedBy(first:20) { totalCount nodes { number state } } closedByPullRequestsReferences(first:20) { totalCount nodes { number merged } } } } fieldValues(first:20) { totalCount nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`;
}

const RERUN = 'rerun the board read, and if it repeats inspect the GitHub Projects API response';

// The one repository this board's cards may belong to, spelled the way GitHub does.
const BOARD_NAME_WITH_OWNER = `${BOARD_OWNER}/${BOARD_REPOSITORY}`;

// The two single-select fields the reader has a vocabulary for, and the option list
// board-config.mjs configures for each. A live board that no longer matches is judged
// against names it does not have, so the read stops instead (the 2026-07-28 incident:
// one field mutation replaced a whole option list and cleared 218 cards).
const CONFIGURED_OPTIONS = new Map([
  [STATUS_FIELD, STATUS_OPTIONS],
  [ROUTING_FIELD, ROUTING_OPTIONS],
]);

// Every connection in the response either came back whole or the read stops here:
// `totalCount` is the ONLY evidence of that, so a missing or non-integer one is a
// broken read rather than a quiet pass, and a card narrowed to its `first:` cap
// (#464 review) would be the exact silent truncation this file's fail-loud
// philosophy forbids — a dropped closing reference can hide the one merged pull
// request a shipped verdict turns on.
function assertConnectionShape(connection, what, where) {
  if (!Number.isInteger(connection?.totalCount) || connection.totalCount < 0 || !Array.isArray(connection.nodes)) {
    throw new Error(
      `${where} returned a malformed ${what} connection — expected a non-negative integer totalCount and a nodes[] array; ${RERUN}`,
    );
  }
}

// The capped sub-lists are fetched WHOLE, so the count and the nodes must agree in both
// directions. Fewer nodes than the count is the truncation above; a count SMALLER than
// the nodes is an under-reporting response, and it is not harmless either — one merged
// closing reference arriving under `totalCount: 0` is what would manufacture a false
// "shipped but open" verdict against a card that is correctly parked.
function assertWholeConnection(connection, what, where) {
  assertConnectionShape(connection, what, where);
  if (connection.totalCount > connection.nodes.length) {
    throw new Error(
      `${where} has ${connection.totalCount} ${what} but only ${connection.nodes.length} fetched — raise the ${what} first: cap in boardQuery`,
    );
  }
  if (connection.totalCount < connection.nodes.length) {
    throw new Error(
      `${where} returned ${connection.nodes.length} ${what} but reports totalCount ${connection.totalCount} — the count contradicts the nodes; ${RERUN}`,
    );
  }
}

// A fieldValues.nodes[] entry names its field via a fragment (single-select or
// text) — an unmatched fragment type parses as `{}`, which this skips naturally
// (no `field.name` to match). A single-select field holds ONE value per card, so
// two is a malformed read: which one the reader picked would be an accident of
// node order.
function fieldValue(fieldValues, name, cardId) {
  const matches = fieldValues.filter((fv) => fv?.field?.name === name);
  if (matches.length > 1) {
    throw new Error(
      `board item ${cardId} carried ${matches.length} "${name}" values — the board holds one value per card; ${RERUN}`,
    );
  }
  if (matches.length === 0) return null;
  return matches[0].name ?? matches[0].text ?? null;
}

// One `nodes[]` entry from boardQuery → the flat raw item: Status, title and the
// routing value off fieldValues, the issue's own facts off content. A draft card keeps
// its `DraftIssue` typename with no number, and a content that did not resolve arrives
// as `{}` — that is the distinction normalizeItem and isContentUnresolved read.
function parseNode(node) {
  assertWholeConnection(node.fieldValues, 'fieldValues', `board item ${node.id}`);
  const fieldValues = node.fieldValues.nodes;
  const content = node.content ?? {};
  const issue = content.__typename === 'Issue' ? content : null;
  if (issue) assertIssueContent(issue, node.id);
  const connectionNodes = (connection) => connection?.nodes ?? [];
  return {
    id: node.id ?? null,
    status: fieldValue(fieldValues, STATUS_FIELD, node.id),
    title: content.title ?? fieldValue(fieldValues, 'Title', node.id) ?? '',
    routing: fieldValue(fieldValues, ROUTING_FIELD, node.id),
    labels: connectionNodes(issue?.labels).map((l) => l.name),
    assignees: connectionNodes(issue?.assignees).map((a) => a.login),
    blockers: connectionNodes(issue?.blockedBy).map((b) => ({ number: b.number, state: b.state })),
    closingPullRequests: connectionNodes(issue?.closedByPullRequestsReferences)
      .map((pr) => ({ number: pr.number, merged: pr.merged })),
    content: {
      ...(content.__typename != null ? { __typename: content.__typename } : {}),
      ...(content.number != null ? { number: content.number } : {}),
      ...(content.state != null ? { state: content.state } : {}),
      ...(content.subIssuesSummary != null ? { subIssuesSummary: content.subIssuesSummary } : {}),
    },
  };
}

// A numbered Issue card is the shape every board rule judges, so a field that came
// back malformed stops the read rather than being defaulted: a missing state would
// silence the epic passes, an unusable summary would forge an undecomposed-epic row,
// and a closing reference read as unmerged would hide the one merged pull request a
// shipped verdict turns on.
function assertIssueContent(issue, cardId) {
  const where = `board item ${cardId}`;
  assertWholeConnection(issue.labels, 'labels', where);
  assertWholeConnection(issue.assignees, 'assignees', where);
  assertWholeConnection(issue.blockedBy, 'blockedBy', where);
  assertWholeConnection(issue.closedByPullRequestsReferences, 'closedByPullRequestsReferences', where);

  const card = `board card #${issue.number}`;
  if (issue.state !== 'OPEN' && issue.state !== 'CLOSED') {
    throw new Error(`${card} came back with state "${issue.state}" — expected OPEN or CLOSED; ${RERUN}`);
  }
  const { total, completed } = issue.subIssuesSummary ?? {};
  if (!Number.isInteger(total) || !Number.isInteger(completed) || total < 0 || completed < 0 || completed > total) {
    throw new Error(`${card} carried no usable sub-issue summary — expected whole total and completed counts; ${RERUN}`);
  }
  const repository = issue.repository?.nameWithOwner ?? 'no repository';
  if (repository !== BOARD_NAME_WITH_OWNER) {
    throw new Error(
      `${card} belongs to ${repository}, not ${BOARD_NAME_WITH_OWNER} — this reader judges only ${BOARD_NAME_WITH_OWNER} cards; check BOARD_REPOSITORY in scripts/lib/board-config.mjs`,
    );
  }
  const numbered = (node) => Number.isInteger(node?.number) && node.number > 0;
  for (const reference of issue.closedByPullRequestsReferences.nodes) {
    if (!numbered(reference) || typeof reference.merged !== 'boolean') {
      throw new Error(`${card} carried a closing pull-request reference without a number and a boolean merged flag; ${RERUN}`);
    }
  }
  for (const blocker of issue.blockedBy.nodes) {
    if (!numbered(blocker) || (blocker.state !== 'OPEN' && blocker.state !== 'CLOSED')) {
      throw new Error(`${card} carried a blocker without a number and an OPEN or CLOSED state; ${RERUN}`);
    }
  }
}

// Every page must be the SAME configured, open project (#572: an absence probe once
// asked a different project than the board read it was confirming). Returns the
// project node plus the identity string fetchBoard compares the next page against.
function assertProject(data) {
  const user = data?.data?.user;
  const project = user?.projectV2;
  if (!project) {
    throw new Error(`board page carried no user data; ${RERUN}`);
  }
  if (user.login !== BOARD_OWNER) {
    throw new Error(
      `board page answered for user "${user.login}" but BOARD_OWNER is "${BOARD_OWNER}" — point the read at the configured owner in scripts/lib/board-config.mjs`,
    );
  }
  if (project.number !== BOARD_PROJECT_NUMBER) {
    throw new Error(
      `board page answered for project ${project.number} but BOARD_PROJECT_NUMBER is ${BOARD_PROJECT_NUMBER} — point the read at the configured project in scripts/lib/board-config.mjs`,
    );
  }
  if (typeof project.id !== 'string' || project.id.trim() === '') {
    throw new Error(`board page carried no project id; ${RERUN}`);
  }
  if (typeof project.closed !== 'boolean') {
    throw new Error(`board page carried no boolean closed flag; ${RERUN}`);
  }
  if (project.closed) {
    throw new Error(
      `board project ${BOARD_PROJECT_NUMBER} is closed — reopen it, or point BOARD_PROJECT_NUMBER at the live board in scripts/lib/board-config.mjs`,
    );
  }
  return { project, identity: `${user.login} project ${project.number} (${project.id})` };
}

// The live Status and routing fields must be single-selects offering exactly the
// options board-config.mjs configures. Compared as sets: ROUTING_OPTIONS is a display
// order, not the board's own. Returns the schema signature fetchBoard compares the
// next page against.
function assertFieldSchema(fields) {
  assertWholeConnection(fields, 'project fields', 'board page');
  for (const [name, configured] of CONFIGURED_OPTIONS) {
    const field = fields.nodes.find((f) => f?.name === name);
    if (!field) {
      throw new Error(`the board has no "${name}" field — add it to the project, or correct the name in scripts/lib/board-config.mjs`);
    }
    if (field.dataType !== 'SINGLE_SELECT') {
      throw new Error(
        `the board's "${name}" is a ${field.dataType} field, not SINGLE_SELECT — restore the single-select field, or correct scripts/lib/board-config.mjs`,
      );
    }
    const live = (field.options ?? []).map((o) => o?.name);
    const wanted = [...configured].sort();
    const seen = [...live].sort();
    if (seen.length !== wanted.length || seen.some((option, i) => option !== wanted[i])) {
      throw new Error(
        `the board's "${name}" field offers ${live.join(', ')} but scripts/lib/board-config.mjs configures ${configured.join(', ')} — reconcile the board field with board-config.mjs`,
      );
    }
  }
  return fields.nodes
    .map((f) => `${f?.name}:${f?.dataType}:${(f?.options ?? []).map((o) => o?.name).join('|')}`)
    .join(';');
}

const countBy = (items, key) => {
  const counts = new Map();
  for (const item of items) {
    const value = key(item);
    if (value == null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

// One issue, one card, one id. Two cards for the same number make every count and every
// per-card verdict ambiguous, and one of the two is stale by definition. The id is the
// card's own identity, so the same id twice is not two cards at all but one card the
// response repeated — a doubled row out of a read that never saw two, which no board
// edit can repair.
function assertNoDuplicateCards(items) {
  for (const [number, count] of countBy(items, (i) => i.content?.number)) {
    if (count > 1) {
      throw new Error(
        `issue #${number} appears on ${count} board cards — remove the duplicate card from the board, then rerun the read`,
      );
    }
  }
  for (const [id, count] of countBy(items, (i) => i.id)) {
    if (count > 1) {
      throw new Error(`board item ${id} was returned on ${count} cards in one read; ${RERUN}`);
    }
  }
}

// Parse one boardQuery response page (one element of the --slurp array) into
// `{ items, totalCount, hasNextPage, endCursor, identity, fieldSignature }`. Throws
// (fail-loud) rather than returning [] on a malformed shape, so a broken read never
// masquerades as an empty board; the identity and signature are what fetchBoard holds
// the rest of the walk to.
//
// A draft card, a pull-request card, a card with no Status and a card with no routing
// value are NOT malformed: this board legitimately holds all four, and they are
// reported as drift rows downstream. A parser that threw on them would strand every
// session instead.
export function parseBoardPage(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (err) {
    throw new Error(`board page JSON could not be parsed: ${err.message}; ${RERUN}`);
  }
  if (data === null || typeof data !== 'object') {
    throw new Error(`board page is not a GraphQL data object; ${RERUN}`);
  }
  if (data.errors != null) {
    const messages = (Array.isArray(data.errors) ? data.errors : [data.errors])
      .map((e) => e?.message ?? JSON.stringify(e))
      .join('; ');
    throw new Error(
      `the board read returned GraphQL errors: ${messages} — fix the query or the token's project scope, then rerun the board read`,
    );
  }

  const { project, identity } = assertProject(data);
  const fieldSignature = assertFieldSchema(project.fields);
  const itemsNode = project.items;
  assertConnectionShape(itemsNode, 'items', 'board page');
  const items = itemsNode.nodes.map(parseNode);
  assertNoDuplicateCards(items);
  const { hasNextPage, endCursor } = assertPageInfo(itemsNode.pageInfo);
  return {
    items,
    totalCount: itemsNode.totalCount,
    hasNextPage,
    endCursor,
    identity,
    fieldSignature,
  };
}

// gh --paginate decides whether to ask for another page from this pair alone, so a
// coerced value is a page decision made on a malformed one: `Boolean("false")` is true
// and a missing hasNextPage is false, silently looping or truncating the walk. A next
// page also has to say WHERE, so hasNextPage without a usable cursor is a broken read.
function assertPageInfo(pageInfo) {
  const hasNextPage = pageInfo?.hasNextPage;
  if (typeof hasNextPage !== 'boolean') {
    throw new Error(`board page pagination carried no boolean hasNextPage; ${RERUN}`);
  }
  const endCursor = pageInfo.endCursor ?? null;
  if (hasNextPage && (typeof endCursor !== 'string' || endCursor.trim() === '')) {
    throw new Error(`board page pagination reports hasNextPage without a non-empty endCursor; ${RERUN}`);
  }
  return { hasNextPage, endCursor };
}

const boardItemsReadError = (detail) =>
  `incomplete board items read: ${detail}; rerun the board read, and if it repeats inspect the GitHub Projects API response`;

// Raw `gh api graphql --paginate --slurp` output → the page objects in walk order.
// Slurp wraps the pages in one array; without it gh concatenates one JSON object per
// page, which JSON.parse rejects on page 2+ but accepts as a bare object on a
// one-page board — passing that through would silently drop every later page. An
// empty array is a walk that fetched nothing, which is never a board.
function parseSlurpedBoardPages(out) {
  const pages = JSON.parse(out);
  const isPageObject = (p) => p !== null && typeof p === 'object' && !Array.isArray(p);
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(isPageObject)) {
    throw new Error('expected --slurp page objects ([{…},{…}]) — is --slurp missing from the gh call?');
  }
  return pages;
}

// Read the whole board in one `gh` process: `--paginate` walks the pages on the
// query's `$endCursor`, `--slurp` returns them as one array, and this checks the
// walk it was handed the way the page-by-page loop it replaced did (#1155): a
// constant totalCount, a fresh cursor behind every hasNextPage (parseBoardPage has
// already required a usable one), no hasNextPage left on the final page, and an exact
// item count at the end. The
// injected executor keeps the board transport at the CLI edge while making the
// walk checks testable without `gh`.
export function fetchBoard(exec) {
  const out = exec(['api', 'graphql', '--paginate', '--slurp', '-f', `query=${boardQuery()}`]);
  const pages = parseSlurpedBoardPages(out).map(parseBoardPage);
  const items = [];
  let expected;
  const usedCursors = new Set();
  pages.forEach((page, index) => {
    // One walk is one project read against one field schema. Two half-boards spliced
    // together would have every rule judge cards against a schema the read never saw
    // whole, and a totalCount that moved mid-walk is a board that changed under it.
    if (expected === undefined) {
      expected = page;
    } else if (page.identity !== expected.identity) {
      throw new Error(
        boardItemsReadError(`project identity changed across pages from ${expected.identity} to ${page.identity}`),
      );
    } else if (page.fieldSignature !== expected.fieldSignature) {
      throw new Error(boardItemsReadError('the project field schema changed across pages'));
    } else if (page.totalCount !== expected.totalCount) {
      throw new Error(
        boardItemsReadError(`item totalCount changed across pages from ${expected.totalCount} to ${page.totalCount}`),
      );
    }
    items.push(...page.items);
    // gh stops on hasNextPage:false and continues on true, so a final page still
    // pointing onward is a walk cut short, and a page that follows a hasNextPage:false
    // page is one the walk should never have been handed.
    const isLast = index === pages.length - 1;
    if (page.hasNextPage === isLast) {
      throw new Error(boardItemsReadError(
        isLast ? 'the last page still reports hasNextPage' : `page ${index + 1} of ${pages.length} reports no next page`,
      ));
    }
    if (page.hasNextPage) {
      if (usedCursors.has(page.endCursor)) {
        throw new Error(`board pagination received repeated endCursor: ${page.endCursor}`);
      }
      usedCursors.add(page.endCursor);
    }
  });
  // This catches a pagination or short-read mismatch against GitHub's totalCount,
  // but not a server omission already excluded from GitHub's own totalCount.
  if (items.length !== expected.totalCount) {
    throw new Error(
      boardItemsReadError(`GitHub reported ${expected.totalCount} board items but ${items.length} were fetched`),
    );
  }
  // Each page is duplicate-free on its own; the same issue or the same id on two PAGES
  // is only visible here, once the whole walk is in hand.
  assertNoDuplicateCards(items);
  return items;
}

// The PICKABLE_STATUSES columns only — never an in-flight or terminal one.
export function pickable(items) {
  return items.filter((i) => PICKABLE_STATUSES.includes(i.status));
}

// `ProjectV2ItemContent` is a closed union of DraftIssue | Issue | PullRequest, and
// boardQuery asks for `number` only `... on Issue`: a draft or a pull-request card
// is numberless by design. Any other numberless card is a content that did not resolve
// on this read, which a caller must never read as "no such card" (#572).
const NUMBERLESS_CONTENT_TYPES = new Set(['DraftIssue', 'PullRequest']);

// A predicate, not a normalizeItem field: `board --json` prints normalizeItem's output
// verbatim, so this internal read-quality signal stays out of that published shape.
export function isContentUnresolved(i) {
  return (i.content?.number ?? null) == null && !NUMBERLESS_CONTENT_TYPES.has(i.content?.__typename);
}

// Flatten a raw board item to the fields the board rules judge a card on. Only the
// OPEN blockers survive: a closed blocker blocks nothing, and every caller asks the
// same question of the list.
export function normalizeItem(i) {
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    number: i.content?.number ?? null,
    status: i.status ?? null,
    title: i.title ?? '',
    routing: i.routing ?? null,
    labels: list(i.labels),
    state: i.content?.state ?? null,
    assignees: list(i.assignees),
    openBlockers: list(i.blockers).filter((b) => b.state === 'OPEN').map((b) => b.number),
    closingPullRequests: list(i.closingPullRequests),
    subIssues: i.content?.subIssuesSummary ?? null,
  };
}

// The last pickable column first — PICKABLE_STATUSES is in board order, so that is the
// one nearest being worked — then ascending issue number (nulls last). Every other
// column keeps the rank it had: this orders a pick view, it does not rank the board.
const NEXT_UP_STATUS = PICKABLE_STATUSES[PICKABLE_STATUSES.length - 1];

export function sortForDisplay(items) {
  const rank = (s) => (s === NEXT_UP_STATUS ? 0 : 1);
  const num = (i) => (i.content?.number ?? Number.MAX_SAFE_INTEGER);
  return [...items].sort((a, b) => rank(a.status) - rank(b.status) || num(a) - num(b));
}

// One item → the two-line routing view (`#N [Status] Title` + its labels).
export function formatRow(i) {
  const n = normalizeItem(i);
  const num = n.number == null ? '#?' : `#${n.number}`;
  const labels = n.labels.length ? n.labels.join(', ') : '—';
  return `${num} [${n.status}] ${n.title}\n    ${labels}`;
}

// A pre-selected list → the sorted, formatted block. Selection (pickable/status)
// is the caller's job; this only orders + renders what it is given.
export function formatList(items) {
  return sortForDisplay(items).map(formatRow).join('\n');
}

// The FIRST routing option leads, deliberately: /resume Step 1 ranks candidates by
// code-parallelization, which is blind to work with no src/ file — that option's items
// never win a candidate slot even when top priority. Grouping surfaces every front each
// session instead of letting the code-less one disappear behind the code-heavy ones.
// That priority is why ROUTING_OPTIONS is a display order, not the board's own.

// Item list → ordered `{ routing, items }` groups: known ROUTING_OPTIONS
// values first (in that order), then unrecognised values (alphabetical, so a
// new board field value still surfaces rather than vanishing), then a
// trailing `Unfielded` group for items with no routing value. Empty groups are
// omitted; no item is ever dropped.
export function groupByRouting(items) {
  const known = new Map(ROUTING_OPTIONS.map((w) => [w, []]));
  const unknown = new Map();
  const unfielded = [];

  for (const i of items) {
    // Through normalizeItem, never `i.routing` directly — that flatten is the
    // ONE place the raw gh payload shape is decoded (formatRow goes through it
    // too). A second decoder here would silently group everything as Unfielded
    // if the field ever moves. `|| null` not `??`: an empty-string field is
    // unfielded, not an unnamed group.
    const w = normalizeItem(i).routing || null;
    if (w == null) {
      unfielded.push(i);
    } else if (known.has(w)) {
      known.get(w).push(i);
    } else {
      if (!unknown.has(w)) unknown.set(w, []);
      unknown.get(w).push(i);
    }
  }

  const groups = [];
  for (const w of ROUTING_OPTIONS) {
    const its = known.get(w);
    if (its.length > 0) groups.push({ routing: w, items: its });
  }
  for (const w of [...unknown.keys()].sort()) {
    groups.push({ routing: w, items: unknown.get(w) });
  }
  if (unfielded.length > 0) groups.push({ routing: 'Unfielded', items: unfielded });

  return groups;
}

// Grouped pretty block: a labelled heading per routing value, then that group's
// rows via the EXISTING formatList (keeps per-group sorting + render logic
// single-sourced — no duplicated row rendering).
export function formatGrouped(items) {
  const groups = groupByRouting(items);
  const body = groups
    .map((g) => `── ${g.routing} (${g.items.length}) ──\n${formatList(g.items)}`)
    .join('\n\n');
  const unknown = [...new Set(
    items.map(normalizeItem)
      .map((i) => i.routing)
      .filter((w) => w && !ROUTING_OPTIONS.includes(w)),
  )].sort();
  if (unknown.length === 0) return body;

  // Keep the repository-owned priority and low-cost read; newly seen values must fail loud.
  const values = unknown.join(', ');
  const label = unknown.length === 1 ? 'value' : 'values';
  return `${body}\n\nWARNING: unrecognised ${ROUTING_FIELD} ${label}: ${values}; add ${values} to ROUTING_OPTIONS and update .agents/skills/to-issues/SKILL.md.`;
}
