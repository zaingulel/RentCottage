// board-cli.test.mjs — end-to-end tests for the one board command, scripts/board.mjs.
// Run: node --test scripts/lib/   (or `npm run test:scripts`)
//
// parseBoardArgs, scanBoard and scanOutcome are each proven pure elsewhere; nothing
// there proves they are WIRED. main() could hand scanOutcome a hard-coded
// `closeout: false`, print the scan on the wrong stream, or drop the exit code, and
// every other test in this repository would stay green while the session-start and
// closeout bookends silently degraded to report-only. Only the real process can observe
// that, so these spawn it against a fake `gh` first on PATH.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installFakeGh } from './fake-gh.mjs';
import { leanBoardPage, leanNode } from './board-fixtures.mjs';
import { BOARD_OWNER, BOARD_PROJECT_NUMBER, BOARD_REPOSITORY } from './board-config.mjs';

const SCRIPT = fileURLToPath(new URL('../board.mjs', import.meta.url));
const UNQUALIFIED_CLEAN = 'board: no drift found.';

// Only the one call the command makes on these fixtures is answered — the
// single-process board walk, and only when it carries `--paginate --slurp` (#1155).
// Anything else fails the fake loud (exit 2) rather than being swallowed, so an
// unanticipated read surfaces here as a failed run instead of a quietly broadened fake.
// Every invocation is logged so a caller can assert that GitHub was never reached.
const fakeGh = installFakeGh('board-cli-', `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_CALLS, args.join(' ') + '\\n');
if (args[0] === 'api' && args[1] === 'graphql' && args.includes('--paginate') && args.includes('--slurp')) {
  process.stdout.write(process.env.FAKE_BOARD);
} else {
  process.stderr.write('unexpected gh invocation: ' + args.join(' '));
  process.exitCode = 2;
}
`);
after(() => fakeGh.cleanup());

// Returns the run plus every `gh` invocation the fake logged, so a caller can assert how
// many calls the command made, not only what it printed. A fresh calls file per run, so
// one run's log can never satisfy another's "no external call happened" assertion.
function runBoard(args, page) {
  const callsFile = fakeGh.newCallsFile();
  writeFileSync(callsFile, '');
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    // One slurped page: the array shape `--slurp` returns.
    env: fakeGh.env({ FAKE_BOARD: JSON.stringify([page]), FAKE_GH_CALLS: callsFile }),
  });
  return { ...run, calls: readFileSync(callsFile, 'utf8').split('\n').filter(Boolean) };
}

// One raw boardQuery page carrying exactly one nullable-content card. It has enough
// field values to fire no unfielded row, so `unreadable` is the only changed outcome.
const UNREADABLE_PAGE = leanBoardPage([
  leanNode({ id: 'PVTI_unresolved_e2e', content: null, status: 'In progress', routing: 'Product' }),
]);

// A shipped, correctly-parked card: nothing here drifts, so the page is the clean board
// the coverage guard needs to prove it accepts an exact read.
function cleanPage(totalCount) {
  return leanBoardPage([
    leanNode({
      id: 'PVTI_shipped_e2e',
      content: { __typename: 'Issue', number: 610, title: 'Fail loud on an incomplete board read', state: 'CLOSED' },
      status: 'Done',
      routing: 'Platform',
    }),
  ], { totalCount });
}

// The #272 shape, and a PICKABLE one so the same card is both in the default selection
// and in the drift channel — which is what lets the --json test prove the two go to
// different streams.
const DRIFTED_PAGE = leanBoardPage([
  leanNode({
    id: 'PVTI_closed_in_backlog',
    content: { __typename: 'Issue', number: 272, title: 'CVE sweep', state: 'CLOSED' },
    status: 'Backlog',
    routing: 'Product',
  }),
]);

test('board CLI: an unrecognised argument fails loud in the script idiom before any GitHub read', () => {
  // parseBoardArgs throws correctly, but main() must CATCH it: otherwise the operator
  // reads an unhandled-rejection dump above the clear message. The parse runs before the
  // read, so the fake logs nothing — a metered read must never be spent on a typo.
  const run = runBoard(['--closout'], UNREADABLE_PAGE);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /^board: unrecognised argument "--closout"/m);
  assert.match(run.stderr, /usage: node scripts\/board\.mjs/);
  assert.equal(/node:internal|at parseBoardArgs|\n\s+at /.test(run.stderr), false, run.stderr);
  assert.equal(run.stdout, '');
  assert.deepEqual(run.calls, []);
});

// The same #598 defect class one step further in: `--status=Rady` is a well-formed flag,
// so only the column vocabulary can reject it — and it has to reject it HERE, before the
// metered read, or the command spends a board read to report `Rady: 0 of N item(s)`.
test('board CLI: a --status= value that is not a board column fails loud before any GitHub read', () => {
  const run = runBoard(['--status=Rady'], UNREADABLE_PAGE);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /^board: --status=Rady is not a board column/m);
  assert.match(run.stderr, /usage: node scripts\/board\.mjs/);
  assert.equal(run.stdout, '');
  assert.deepEqual(run.calls, []);
});

test('ANTI-REGRESSION (#600 closeout gate, end to end): the real command fails an unreadable board ONLY when --closeout is passed', () => {
  const ordinary = runBoard([], UNREADABLE_PAGE);

  // An ordinary interactive read reports the unread card but is never stranded by it.
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.match(ordinary.stdout, /⚠ BOARD READ INCOMPLETE/);
  assert.match(ordinary.stdout, /PVTI_unresolved_e2e/);
  // …and still never claims coverage it does not have.
  assert.equal(ordinary.stdout.includes(UNQUALIFIED_CLEAN), false, ordinary.stdout);
  // One read answers both halves: the listing and the scan come off the same walk.
  assert.equal(ordinary.calls.length, 1, ordinary.calls.join('\n'));
  assert.match(
    ordinary.stdout,
    new RegExp(`^Board ${BOARD_OWNER}/${BOARD_REPOSITORY} project ${BOARD_PROJECT_NUMBER} — Backlog/Ready: 0 of 1 item\\(s\\)$`, 'm'),
  );

  // The closeout gate certifies the board, so an admittedly partial read cannot pass.
  // This is the run that dies if `closeout` stops reaching scanOutcome.
  const closeout = runBoard(['--closeout'], UNREADABLE_PAGE);

  assert.equal(closeout.status, 1, closeout.stdout);
  assert.match(closeout.stdout, /⚠ BOARD READ INCOMPLETE/);
  assert.match(closeout.stdout, /PVTI_unresolved_e2e/);
  // The gate prints the scan and nothing else — no listing, no header.
  assert.equal(closeout.stdout.includes(`Board ${BOARD_OWNER}`), false, closeout.stdout);
});

test('ANTI-REGRESSION (#610 board coverage, end to end): closeout fails when the board read returns fewer items than totalCount and accepts an exact read', () => {
  const incomplete = runBoard(['--closeout'], cleanPage(2));

  assert.equal(incomplete.status, 1, incomplete.stdout);
  assert.match(incomplete.stderr, /board: failed to read the GitHub Projects board — incomplete board items read:/);
  assert.match(incomplete.stderr, /GitHub reported 2 board items but 1 were fetched/);

  const exact = runBoard(['--closeout'], cleanPage(1));

  assert.equal(exact.status, 0, exact.stderr);
  assert.equal(exact.stderr, '');
  assert.equal(exact.stdout, `${UNQUALIFIED_CLEAN}\n`);
});

// --json's stdout is a document a caller parses, so a scan line printed there would
// corrupt it — and a verdict withheld entirely would be the silent-clean defect the scan
// exists to prevent. Both halves are asserted, plus the exit code the ordinary read now
// carries: drift fails the session-start bookend.
test('board CLI: --json puts the selection on stdout and the scan on stderr, and drift still exits 1', () => {
  const run = runBoard(['--json'], DRIFTED_PAGE);

  assert.equal(run.status, 1, run.stderr);
  const selection = JSON.parse(run.stdout);
  assert.deepEqual(selection.map((card) => [card.number, card.status]), [[272, 'Backlog']]);
  assert.equal(run.stdout.includes('BOARD DRIFT'), false, run.stdout);
  assert.match(run.stderr, /⚠ BOARD DRIFT/);
  assert.match(run.stderr, /^#272 \[Backlog\] CVE sweep — issue closed but card still in "Backlog" \(not Done\)$/m);
});
