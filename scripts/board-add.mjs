#!/usr/bin/env node
// board-add.mjs — put an issue on the board with its Status AND Workstream set in one step.
// Run: node scripts/board-add.mjs <issue#> <Status> <Workstream>

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ghExec } from './lib/gh-exec.mjs';
import { addIssueToBoard } from './lib/board-add.mjs';

export function main(args = process.argv.slice(2), dependencies = {}) {
  const output = dependencies.output ?? console;
  const executor = dependencies.ghExec ?? ghExec;

  try {
    if (args.length !== 3) {
      throw new Error('usage: node scripts/board-add.mjs <issue#> <Status> <Workstream>');
    }
    const [numRaw, statusName, workstreamName] = args;
    const result = addIssueToBoard(
      { issueNumber: Number(numRaw), statusName, workstreamName },
      executor,
    );
    output.log(`board-add: #${result.issueNumber} on the board (item ${result.itemId})`);
    output.log(`board-add: Status = ${result.statusName}, Workstream = ${result.workstreamName}`);
    return 0;
  } catch (err) {
    output.error(`board-add: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
