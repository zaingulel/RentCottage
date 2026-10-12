// runtimes.mjs — which runtimes a repository runs, which shared path belongs to which, and the one read of the
// seat settings file.
//
// A leaf: it imports only node:fs and node:path, because seat-settings.mjs imports the agent check and the agent check
// must be able to import this module. For the same reason it is the only place the settings file is read from disk, so
// the agent check and the manifest check refuse the same linked file or linked parent before any read, and the only
// home of the file's top-level rules (readSettingsHeader), so no reader takes its runtimes from a file whose top level
// the sync refuses.
//
// RUNTIMES: the two runtimes a repository may run. The settings file's `runtimes` key names the ones present; with
// no key, or no file, both are.
// runtimeOf: a shared path belongs to Claude Code (everything under .claude/, CLAUDE.md, and the files of the script
// only its hooks run), to Codex (everything under .codex/, and the files of the scripts only its hooks run), or to
// every install (null). A shared file of every install never imports one of those five script files.
// isGreptilePath: the Greptile add-on's files are everything under .agents/skills/greptile/, .claude/skills/greptile/
// and .greptile/. A tree installs them only where its settings file holds `"greptile": true` (greptileOn).
// SWEEP_DEFAULT: the settings file's `docSweep` key turns the documentation sweep's files off with `false`; with no
// key it is on.
// isSweepPath: the documentation sweep's shared files are the six the sweep-scope check owns. A tree whose sweep is
// off (sweepOn) leaves them out, and the two manuals the sweep runs by, from its shared set (sweepOmits).

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SETTINGS_PATH = '.agents/factory-settings.json';

export const RUNTIMES = Object.freeze(['claude', 'codex']);

export const SWEEP_DEFAULT = true;

export const SEATS = Object.freeze({
  claude: Object.freeze({ directory: '.claude/agents', extension: '.md' }),
  codex: Object.freeze({ directory: '.codex/agents', extension: '.toml' }),
});

const CLAUDE_PATHS = new Set(['CLAUDE.md', 'scripts/lib/test-output-filter.mjs', 'scripts/lib/test-output-filter.test.mjs']);
const CODEX_PATHS = new Set(['scripts/lib/codex-hook-adapters.mjs', 'scripts/lib/codex-hook-adapters.test.mjs', 'scripts/lib/codex-hooks-windows.test.mjs']);

/** The runtime a shared path belongs to, or null where it belongs to every install. Exact string comparison. */
export function runtimeOf(path) {
  if (path.startsWith('.claude/') || CLAUDE_PATHS.has(path)) return 'claude';
  if (path.startsWith('.codex/') || CODEX_PATHS.has(path)) return 'codex';
  return null;
}

/** Whether a shared path is installed where `runtimes` are the ones present. */
export function installs(runtimes, path) {
  const runtime = runtimeOf(path);
  return runtime === null || runtimes.includes(runtime);
}

const GREPTILE_FOLDERS = ['.agents/skills/greptile/', '.claude/skills/greptile/', '.greptile/'];

/** Whether a shared path is one of the Greptile add-on's files. Exact string comparison. */
export const isGreptilePath = (path) => GREPTILE_FOLDERS.some((folder) => path.startsWith(folder));

const SWEEP_PATHS = new Set([
  '.github/workflows/sweep-scope.yml',
  'scripts/lib/sweep-scope-corpus.mjs',
  'scripts/lib/sweep-scope-evaluate.mjs',
  'scripts/lib/sweep-scope.mjs',
  'scripts/lib/sweep-scope.test.mjs',
  'scripts/sweep-scope-check.mjs',
]);
const SWEEP_MANUALS = ['docs/DOC-SWEEP.md', 'docs/SWEEP-TRIAGE.md'];

/** Whether a shared path is one of the documentation sweep's six files. Exact string comparison. */
export const isSweepPath = (path) => SWEEP_PATHS.has(path);

/** Whether a tree whose sweep is `docSweep` leaves the path out: the sweep's six files and its two manuals, only where it is off. */
export const sweepOmits = (docSweep, path) => !docSweep && (isSweepPath(path) || SWEEP_MANUALS.includes(path));

const RECOVERY = 'if a newer copy of the shared workflow admits this, undo the edit, run the sync that installs that copy, then make the edit again';

export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A settings refusal naming the file, the place in it and the offending value; `recovery` appends the newer-copy sentence. */
export function refusal(label, place, cause, found, recovery = false) {
  return new Error(`${label}: ${place}: ${cause}; found ${JSON.stringify(found)}${recovery ? `; ${RECOVERY}` : ''}`);
}

/** The runtimes a settings file's `runtimes` value names, in RUNTIMES order; every runtime when there is no value. */
export function readRuntimes(value, label) {
  if (value === undefined) return RUNTIMES;
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || !value.every((name) => RUNTIMES.includes(name))) {
    throw new Error(`${label}: runtimes: must be a non-empty array naming claude, codex or both, each once; found ${JSON.stringify(value)}`);
  }
  return RUNTIMES.filter((runtime) => value.includes(runtime));
}

export function kindOf(stat) {
  if (stat.isSymbolicLink()) return 'a symlink';
  if (stat.isDirectory()) return 'a directory';
  return stat.isFile() ? 'a regular file' : 'a special file';
}

// Refuses a path with a symlink among its existing parent directories in the target, whatever the symlink points
// to: a write below it would land away from the manifest path, possibly outside the target. Refuses a path whose
// existing parent is a file, as a former shared symlink is on a checkout that writes symlinks as plain files.
export function checkContained(root, path) {
  const parts = path.split('/');
  let dir = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    dir = join(dir, parts[i]);
    const prefix = parts.slice(0, i + 1).join('/');
    let stat;
    try {
      stat = lstatSync(dir);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${path}: its parent ${dir} is a symlink, so a write there would not land at the manifest path and could land outside the target ${root}; if it is a former shared symlink, remove it first: git rm ${prefix}, commit, then sync`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${path}: its parent ${dir} is a file, not a directory, so the entry cannot be written there; if it is a former shared symlink checked out as a file, remove it first: git rm ${prefix}, commit, then sync`);
    }
  }
}

/** The settings file's parsed object, the runtimes it names, whether it turns the Greptile add-on on and whether it leaves the documentation sweep on, once its top-level shape holds: one JSON object, version 1, no key besides version, runtimes, seats, planApproval, greptile and docSweep, a valid `runtimes` value, a `planApproval`, a `greptile` and a `docSweep` that are each true or false when present. Throws a refusal naming `label`. */
export function readSettingsHeader(text, label) {
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    throw new Error(`${label}: is not valid JSON`);
  }
  if (!isRecord(settings)) throw refusal(label, 'file', 'must hold one JSON object', settings);
  if (settings.version !== 1) throw refusal(label, 'version', 'is unsupported by this copy of the sync (only 1)', settings.version, true);
  for (const key of Object.keys(settings)) {
    if (key !== 'version' && key !== 'runtimes' && key !== 'seats' && key !== 'planApproval' && key !== 'greptile' && key !== 'docSweep') throw refusal(label, 'file', 'holds a key besides version, runtimes, seats, planApproval, greptile and docSweep', key, true);
  }
  if (settings.planApproval !== undefined && typeof settings.planApproval !== 'boolean') throw refusal(label, 'planApproval', 'must be true or false', settings.planApproval);
  if (settings.greptile !== undefined && typeof settings.greptile !== 'boolean') throw refusal(label, 'greptile', 'must be true or false', settings.greptile);
  if (settings.docSweep !== undefined && typeof settings.docSweep !== 'boolean') throw refusal(label, 'docSweep', 'must be true or false', settings.docSweep);
  return { settings, runtimes: readRuntimes(settings.runtimes, label), greptile: settings.greptile === true, docSweep: settings.docSweep ?? SWEEP_DEFAULT };
}

/** The text of the settings file of the tree at `root`, or undefined when the tree has none. Refuses one under a symlinked directory or one that is not a regular file, before any read. */
export function readSettingsFile(root) {
  checkContained(root, SETTINGS_PATH);
  const full = join(root, SETTINGS_PATH);
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile()) throw new Error(`${SETTINGS_PATH} is not a regular file (${kindOf(stat)})`);
  return readFileSync(full, 'utf8');
}

/** The runtimes the tree at `root` runs: those its settings file names, or both. Applies the top-level rules of readSettingsHeader; the seats are validated by parseSettings (seat-settings.mjs), which the manifest check runs. */
export function presentRuntimes(root) {
  const text = readSettingsFile(root);
  return text === undefined ? RUNTIMES : readSettingsHeader(text, SETTINGS_PATH).runtimes;
}

/** Whether the tree at `root` turns the Greptile add-on on: its settings file holds `"greptile": true`. Off where the tree has no settings file. Applies the top-level rules of readSettingsHeader. */
export function greptileOn(root) {
  const text = readSettingsFile(root);
  return text === undefined ? false : readSettingsHeader(text, SETTINGS_PATH).greptile;
}

/** Whether the tree at `root` leaves the documentation sweep on: on unless its settings file holds `"docSweep": false`. On where the tree has no settings file. Applies the top-level rules of readSettingsHeader. */
export function sweepOn(root) {
  const text = readSettingsFile(root);
  return text === undefined ? SWEEP_DEFAULT : readSettingsHeader(text, SETTINGS_PATH).docSweep;
}
