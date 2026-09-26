// run-log.mjs — run a command and append what happened to the branch's work log.
//
//   node scripts/run-log.mjs <label words> -- <command> [args...]
//
// The label is plain unquoted words; the first bare `--` ends it.
//
// The log lives at .claude/worklog/<branch>.md (gitignored, machine-local). Each line records
// the time, the label, the exact argument vector, the exit code the command actually returned, and
// the git state it ran against, so the evidence section of a pull request can quote lines a script
// wrote rather than lines a model asserted. A command that could not be started at all is
// logged as `spawn failed (<code>)` and exits 127, so it can never read as a red run.
// The state field `head=<H> tree=<T>` is sampled before and after the command: H is the commit, or
// `<before>-><after>` when it moved; T is `clean` only when both samples were clean against a known
// commit, `dirty` when either had changes (untracked files included), and `unknown` otherwise, so an
// unreadable state never reads as clean.
// Nothing else reads the log, and the script keeps nothing between runs.

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

// Output of a git command, or null when git is missing or the command fails.
function git(gitArgs) {
  const result = spawnSync('git', gitArgs, { encoding: 'utf8' });
  return result.error || result.status !== 0 ? null : result.stdout;
}

function snapshot() {
  const head = git(['rev-parse', '--verify', 'HEAD'])?.trim();
  return {
    head: /^[0-9a-f]{40}$/.test(head) ? head : null,
    status: git(['status', '--porcelain', '--untracked-files=normal']),
  };
}

function renderState(before, after) {
  let head = 'unknown';
  if (before.head && after.head) head = before.head === after.head ? before.head : `${before.head}->${after.head}`;
  let tree = 'unknown';
  if (head !== 'unknown' && before.status !== null && after.status !== null) {
    tree = before.status || after.status ? 'dirty' : 'clean';
  }
  return `head=${head} tree=${tree}`;
}

const branch = git(['branch', '--show-current'])?.trim() || 'detached';
const root = git(['rev-parse', '--show-toplevel'])?.trim() || process.cwd();
const dir = join(root, '.claude', 'worklog');
const logFile = join(dir, `${branch.replace(/[^A-Za-z0-9._-]+/g, '_')}.md`);

const started = new Date().toISOString();
const before = snapshot();
const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit', shell: false });
let outcome;
let exitCode;
let signal;
if (result.error) {
  outcome = `spawn failed (${result.error.code ?? result.error.message})`;
  exitCode = 127;
} else if (result.status === null) {
  outcome = `killed by ${result.signal}`;
  signal = result.signal;
} else {
  outcome = `exit ${result.status}`;
  exitCode = result.status;
}
const state = renderState(before, snapshot());
const recordedCommand = JSON.stringify(command).replaceAll('`', '\\u0060');
const line = `- ${started} | ${label} | \`${recordedCommand}\` | ${outcome} | ${state}`;
try {
  mkdirSync(dir, { recursive: true });
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
} catch (error) {
  console.error(`run-log: could not write receipt (${error?.code ?? error?.message ?? error})`);
  if (exitCode === 0) exitCode = 1;
}
if (signal) process.kill(process.pid, signal);
process.exit(exitCode);
