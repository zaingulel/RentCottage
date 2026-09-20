// run-log.mjs — run a command and append what happened to the branch's work log.
//
//   node scripts/run-log.mjs <label words> -- <command> [args...]
//
// The label is plain unquoted words; the first bare `--` ends it.
//
// The log lives at .claude/worklog/<branch>.md (gitignored, machine-local). Each line records
// the time, the label, the exact command, and the exit code the command actually returned, so
// the evidence section of a pull request can quote lines a script wrote rather than lines a
// model asserted. A command that could not be started at all is
// logged as `spawn failed (<code>)` and exits 127, so it can never read as a red run.
// Nothing else reads the log; there is no state.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator < 1 || separator === args.length - 1) {
  console.error('usage: node scripts/run-log.mjs <label words> -- <command> [args...]');
  process.exit(2);
}
const label = args.slice(0, separator).join(' ');
const command = args.slice(separator + 1);

const branch = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim() || 'detached';
const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
const dir = join(root, '.claude', 'worklog');
mkdirSync(dir, { recursive: true });
const logFile = join(dir, `${branch.replace(/[^A-Za-z0-9._-]+/g, '_')}.md`);

const started = new Date().toISOString();
const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: false });
let outcome;
let exitCode;
if (result.error) {
  outcome = `spawn failed (${result.error.code ?? result.error.message})`;
  exitCode = 127;
} else if (result.status === null) {
  outcome = `killed by ${result.signal}`;
  exitCode = 128;
} else {
  outcome = `exit ${result.status}`;
  exitCode = result.status;
}
const line = `- ${started} | ${label} | \`${command.join(' ')}\` | ${outcome}`;
appendFileSync(logFile, `${line}\n`);
console.log(line);
process.exit(exitCode);
