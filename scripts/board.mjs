#!/usr/bin/env node
// board.mjs — the one Flowgauge board command: it lists the board and judges it from
// the SAME single read, so a session never pays twice for one answer and the listing
// can never disagree with the drift verdict printed under it.
//
//   node scripts/board.mjs                 # pickable candidates, then the scan
//   node scripts/board.mjs --all           # every column
//   node scripts/board.mjs --status=Ready  # one column
//   node scripts/board.mjs --json          # the normalized selection on stdout, scan on stderr
//   node scripts/board.mjs --closeout      # the strict proof gate: the scan alone
//
// Fail-loud (self-improvement-loop rule): a gh error, malformed JSON, or a zero-item
// read exits non-zero — a broken board read never prints an empty "nothing to pick"
// and returns success. The exit code of every mode is scanOutcome's, so an ordinary
// read exits 1 on drift too: the session-start bookend exists to surface exactly that,
// and only --closeout spares the advisory rows (one merge's proof gate is not a sibling
// lane's business).
//
// #461: reads the board via the lean GraphQL page query (scripts/lib/board.mjs), not
// `gh project item-list` (a measured 203 GraphQL points per read). #1155: the whole
// walk runs inside one `gh api graphql --paginate --slurp` process, and every rule in
// scripts/lib/board-rules.mjs is answered off those pages.
//
// A thin shell: every decision (what to select, what to print, what to exit with) lives
// in the pure parseBoardArgs/scanBoard/scanOutcome, so this file holds no judgment of
// its own and the whole contract is unit-testable.

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ghExec } from './lib/gh-exec.mjs';
import { BOARD_OWNER, BOARD_PROJECT_NUMBER, BOARD_REPOSITORY, PICKABLE_STATUSES } from './lib/board-config.mjs';
import { fetchBoard, formatGrouped, normalizeItem, parseBoardArgs, pickable } from './lib/board.mjs';
import { scanBoard, scanOutcome } from './lib/board-rules.mjs';

function main() {
  let args;
  try {
    args = parseBoardArgs(process.argv.slice(2));
  } catch (err) {
    // The same one-line idiom as the read failure below, so the operator reads the
    // message and not an unhandled-rejection stack trace above it.
    console.error(`board: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let items;
  try {
    items = fetchBoard(ghExec);
  } catch (err) {
    console.error(`board: failed to read the GitHub Projects board — ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (items.length === 0) {
    console.error('board: gh returned 0 items — auth/network/project problem, not an empty backlog.');
    process.exitCode = 1;
    return;
  }

  // --closeout certifies the board and nothing else, so it prints no listing at all.
  if (!args.closeout) {
    const selected = args.all
      ? items
      : args.status
        ? items.filter((i) => i.status === args.status)
        : pickable(items);
    const label = args.status || (args.all ? 'all columns' : PICKABLE_STATUSES.join('/'));
    if (args.json) {
      console.log(JSON.stringify(selected.map(normalizeItem), null, 2));
    } else {
      console.log(`Board ${BOARD_OWNER}/${BOARD_REPOSITORY} project ${BOARD_PROJECT_NUMBER} — ${label}: ${selected.length} of ${items.length} item(s)\n`);
      console.log(formatGrouped(selected));
    }
  }

  const { lines, exitCode } = scanOutcome({ ...scanBoard(items), closeout: args.closeout });
  // Under --json stdout is a document a caller parses, so the scan goes to stderr rather
  // than corrupting it; the verdict still reaches the operator and still sets the exit code.
  const report = args.json ? console.error : console.log;
  for (const line of lines) report(line);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
