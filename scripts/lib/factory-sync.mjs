// factory-sync.mjs — read and verify the factory manifest, `.agents/factory-manifest.json`: the shared
// workflow files every adopter carries byte for byte, each pinned in one of exactly two entry kinds.
//
//   { path, sha256[, executable: true] }         a regular file, hashed over its bytes; executable marks git mode
//                                                100755 and is absent for 100644
//   { path, region: 'factory-shared', sha256 }   the text strictly between the file's two region marker lines
//
// Every path is relative, POSIX and free of `.`, `..` and empty segments, and is checked before any read.
// Disk state is read with lstat, so a symlink or directory where a file is expected is drift, never followed.
// No two paths name the same file on a case-insensitive or Unicode-normalising disk, and no path lies under another.
// Every malformed input throws with a named cause.
//
// syncInto copies the entries from a canonical source checkout into an adopter target. Everything it writes comes
// from the source's freshly fetched origin main commit, never from the source's working tree, index or disk
// manifest, and every git call ignores inherited repository-scoped variables such as GIT_DIR and GIT_INDEX_FILE.
// It validates everything before it writes any byte, so every refusal leaves the target untouched: the canonical
// comes from the target's committed manifest or, only when there is none, the caller, and the fetched manifest
// names it too, in any letter case; the source's origin is that canonical and the target's is not; the source's
// HEAD is the fetched commit; source and target are clean at every shared path, so the source's uncommitted edits
// are refused loudly rather than silently left out, and the target's are never overwritten; the fetched commit
// matches its own manifest in kind, mode and content; no existing directory on an entry's path in the target is a
// symlink, even one pointing inside the target, so every write lands at its manifest path and never through a
// symlink; and each region file, in the commit and as a regular file in the target, carries well-formed region
// markers. It then writes each file with the commit's bytes and mode and each region between the target's own markers, and records the commit's manifest, with the target's canonical, plus
// `syncedFrom`, the fetched commit. Files the manifest no longer lists are left in place.
//
// checkLag compares this repository's manifest on disk with the canonical's manifest on main, never
// the working-tree files (local file drift is the workflow contract test's job). It ignores `syncedFrom` and
// compares `canonical`, `adopters` and each entry by path: only on main is "missing here", only here is "no
// longer shared", and a different kind, hash or executable bit is "changed", one line each, sorted by
// path. The state is 'in-sync' only when nothing differs, 'drifted' when something does, and 'unknown', with its
// cause, whenever the answer cannot be known: no or a malformed local manifest, a failed fetch, or a canonical
// manifest that fails the same validation as a local one. Unknown is never reported as in sync.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const MANIFEST_PATH = '.agents/factory-manifest.json';
const REGION_START = '<!-- factory-shared:start -->';
const REGION_END = '<!-- factory-shared:end -->';
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;
const GITHUB_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/;

// Whether a remote URL, in https or ssh form, is github.com/<repository>.
export function isGithubRepository(url, repository) {
  return url?.match(GITHUB_REMOTE)?.[1].toLowerCase() === repository.toLowerCase();
}

export function checkManifestPath(path) {
  if (typeof path !== 'string' || path.split('/').some((segment) => ['', '.', '..'].includes(segment))) {
    throw new Error(
      `invalid manifest path ${JSON.stringify(path)}: it must be a relative POSIX path with no empty, "." or ".." segment`,
    );
  }
  return path;
}

function checkEntry(entry) {
  const keys = entry && typeof entry === 'object' ? Object.keys(entry).sort().join(',') : '';
  const shaped =
    (keys === 'path,sha256' && SHA256.test(entry.sha256)) ||
    (keys === 'executable,path,sha256' && entry.executable === true && SHA256.test(entry.sha256)) ||
    (keys === 'path,region,sha256' && entry.region === 'factory-shared' && SHA256.test(entry.sha256));
  if (!shaped) {
    throw new Error(
      `malformed manifest entry ${JSON.stringify(entry)}: it must be { path, sha256[, executable: true] } or { path, region: "factory-shared", sha256 }`,
    );
  }
  checkManifestPath(entry.path);
}

export function readManifest(root) {
  let text;
  try {
    text = readFileSync(join(root, MANIFEST_PATH), 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${MANIFEST_PATH} (${error.code ?? error.message})`, { cause: error });
  }
  return parseManifest(text, MANIFEST_PATH);
}

// The manifest held in text, validated; label names where the text came from in every error.
function parseManifest(text, label) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${error.message})`);
  }
  const { canonical, adopters, entries } = manifest ?? {};
  if (
    !REPOSITORY.test(canonical) ||
    !Array.isArray(adopters) ||
    !adopters.every((adopter) => REPOSITORY.test(adopter)) ||
    !Array.isArray(entries)
  ) {
    throw new Error(`malformed ${label}: it must hold canonical "owner/repo", adopters ["owner/repo", ...] and entries [...]`);
  }
  entries.forEach(checkEntry);
  // Keyed by each path folded as a case-insensitive, Unicode-normalising disk compares it: files maps the key to its
  // path, directories maps each folded ancestor directory to a path beneath it.
  const files = new Map();
  const directories = new Map();
  for (const { path } of entries) {
    const key = path.normalize('NFC').toLowerCase();
    const other = files.get(key);
    if (other === path) throw new Error(`${label} lists ${path} more than once`);
    if (other !== undefined) {
      throw new Error(`${label} lists ${other} and ${path}, which name the same file on a case-insensitive or Unicode-normalising disk`);
    }
    files.set(key, path);
    for (let slash = key.indexOf('/'); slash !== -1; slash = key.indexOf('/', slash + 1)) directories.set(key.slice(0, slash), path);
  }
  for (const [key, path] of files) {
    const under = directories.get(key);
    if (under !== undefined) throw new Error(`${label} lists ${path} and ${under}, and ${under} lies under ${path}`);
  }
  return manifest;
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// The line indexes of the region's two marker lines, each of which must stand alone on exactly one line, start
// before end.
function regionBounds(lines, path) {
  const at = (marker) => lines.flatMap((line, index) => (line === marker ? [index] : []));
  const [starts, ends] = [at(REGION_START), at(REGION_END)];
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) {
    throw new Error(
      `${path}: malformed region markers: "${REGION_START}" and "${REGION_END}" must each stand alone on exactly one line, start before end (found ${starts.length} start and ${ends.length} end)`,
    );
  }
  return [starts[0], ends[0]];
}

// The text strictly between the region's two marker lines.
export function regionText(text, path) {
  const lines = text.split('\n');
  const [start, end] = regionBounds(lines, path);
  return lines.slice(start + 1, end).map((line) => `${line}\n`).join('');
}

// The text with everything strictly between its marker lines replaced by region; the rest stays byte for byte.
function replaceRegion(text, region, path) {
  const lines = text.split('\n');
  const [start, end] = regionBounds(lines, path);
  return `${lines.slice(0, start + 1).join('\n')}\n${region}${lines.slice(end).join('\n')}`;
}

function kindOf(stat) {
  if (stat.isSymbolicLink()) return 'a symlink';
  if (stat.isDirectory()) return 'a directory';
  return stat.isFile() ? 'a regular file' : 'a special file';
}

// The entry's state on disk: { value } holding the file or region hash, plus, for a file entry,
// whether the owner may execute it, which is what git records as mode 100755; or { problem } naming why no value
// of the entry's kind exists at its path.
export function entryState(root, entry) {
  const full = join(root, checkManifestPath(entry.path));
  let stat;
  try {
    stat = lstatSync(full);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { problem: 'missing' };
    throw error;
  }
  if (!stat.isFile()) return { problem: `not a regular file (${kindOf(stat)})` };
  const value = valueOf(entry, readFileSync(full));
  return 'region' in entry ? { value } : { value, executable: (stat.mode & 0o100) !== 0 };
}

const modeName = (executable) => (executable ? 'executable' : 'not executable');

// The value the entry records for a file's bytes: the region hash or the file hash.
function valueOf(entry, data) {
  return sha256('region' in entry ? regionText(data.toString('utf8'), entry.path) : data);
}

// Every entry whose disk state differs from its record, as { path, expected, actual }; actual is the
// disk value or the problem that stands in for it, or, for a file whose bytes match, its executable state.
export function verifyManifest(root, manifest = readManifest(root)) {
  return manifest.entries.flatMap((entry) => {
    const { value, problem, executable } = entryState(root, entry);
    if (value !== entry.sha256) return [{ path: entry.path, expected: entry.sha256, actual: value ?? problem }];
    if (executable === undefined || executable === (entry.executable === true)) return [];
    return [{ path: entry.path, expected: modeName(entry.executable), actual: modeName(executable) }];
  });
}

// The manifest's entries in the same order, each re-recorded from disk; an entry with no value of its kind
// on disk cannot be recorded and throws.
export function computeEntries(root, manifest = readManifest(root)) {
  return manifest.entries.map((entry) => {
    const { value, problem, executable } = entryState(root, entry);
    if (problem) throw new Error(`cannot record ${entry.path}: ${problem}`);
    if ('region' in entry) return { ...entry, sha256: value };
    return { path: entry.path, sha256: value, ...(executable ? { executable: true } : {}) };
  });
}

let localEnvVars;

// The environment for every git call: this process's, with credential prompts off and without every
// repository-scoped variable git itself lists (GIT_DIR, GIT_INDEX_FILE and the rest), which an inherited
// environment would otherwise use to point a call at another repository, index or object store.
export function gitEnvironment() {
  if (!localEnvVars) {
    const list = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' });
    if (list.status !== 0) throw new Error(`cannot list git's repository-scoped variables (${list.error?.code ?? list.stderr.trim()})`);
    localEnvVars = list.stdout.split('\n').filter(Boolean);
  }
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const name of localEnvVars) delete env[name];
  return env;
}

function git(root, ...args) {
  const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnvironment() });
  return run.status === 0 ? run.stdout.trim() : null;
}

// The bytes of a blob in root's object store.
function blob(root, object) {
  const run = spawnSync('git', ['-C', root, 'cat-file', 'blob', object], { env: gitEnvironment() });
  if (run.status !== 0) throw new Error(`cannot read the object ${object} in ${root}`);
  return run.stdout;
}

function committedManifest(root, commit) {
  const label = `the source's ${MANIFEST_PATH} at ${commit}`;
  const text = git(root, 'show', `${commit}:${MANIFEST_PATH}`);
  if (text === null) throw new Error(`cannot read ${label}`);
  return parseManifest(text, label);
}

// Each entry's content in the commit, keyed by path, as { data, mode }: the file bytes or the region text, and the
// git mode. Refuses, naming every such path, an entry whose committed kind or content differs from
// its record.
function committedContents(root, commit, manifest) {
  const listing = git(root, '--literal-pathspecs', 'ls-tree', '-z', commit, '--', ...manifest.entries.map(({ path }) => path));
  if (listing === null) throw new Error(`cannot list the shared paths in the source's commit ${commit}`);
  const tree = new Map(
    listing
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        const [mode, , object] = line.slice(0, tab).split(' ');
        return [line.slice(tab + 1), { mode, object }];
      }),
  );
  const contents = new Map();
  const mismatched = [];
  for (const entry of manifest.entries) {
    const { mode, object } = tree.get(entry.path) ?? {};
    const modes = 'region' in entry ? ['100644', '100755'] : [entry.executable ? '100755' : '100644'];
    const data = modes.includes(mode) ? blob(root, object) : null;
    if (data === null || valueOf(entry, data) !== entry.sha256) {
      mismatched.push(entry.path);
      continue;
    }
    contents.set(entry.path, { data: 'region' in entry ? regionText(data.toString('utf8'), entry.path) : data, mode });
  }
  if (mismatched.length > 0) {
    throw new Error(`the source does not match its own manifest at ${mismatched.join(', ')} in its commit ${commit}`);
  }
  return contents;
}

function uncommitted(root, paths) {
  const status = git(root, '--literal-pathspecs', 'status', '--porcelain', '--untracked-files=all', '--', ...paths);
  if (status === null) throw new Error(`cannot read the git status of ${root}`);
  return status;
}

function resolveCanonical(target, requested) {
  const committed = git(target, 'show', `HEAD:${MANIFEST_PATH}`);
  if (committed === null) {
    if (requested === undefined) {
      throw new Error(`no canonical repository: the target has no committed ${MANIFEST_PATH}, so name one with --canonical <owner/repo>`);
    }
    if (!REPOSITORY.test(requested)) throw new Error(`--canonical ${requested} is not "owner/repo"`);
    return requested;
  }
  let canonical;
  try {
    ({ canonical } = JSON.parse(committed));
  } catch {
    // Unparsable is reported below with the missing canonical.
  }
  if (!REPOSITORY.test(canonical)) throw new Error(`the target's committed ${MANIFEST_PATH} names no canonical "owner/repo"`);
  if (requested !== undefined && requested.toLowerCase() !== canonical.toLowerCase()) {
    throw new Error(`--canonical ${requested} disagrees with ${canonical}, the canonical in the target's committed ${MANIFEST_PATH}`);
  }
  return canonical;
}

// Refuses a path with a symlink among its existing parent directories in the target, whatever the symlink points
// to: a write below it would land away from the manifest path, possibly outside the target. Refuses a path whose
// existing parent is a file, as a former shared symlink is on a checkout that writes symlinks as plain files.
function checkContained(root, path) {
  let dir = root;
  for (const part of path.split('/').slice(0, -1)) {
    dir = join(dir, part);
    let stat;
    try {
      stat = lstatSync(dir);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${path}: its parent ${dir} is a symlink, so a write there would not land at the manifest path and could land outside the target ${root}; if it is a former shared symlink, remove it first: git rm ${dir.slice(root.length + 1)}, commit, then sync`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${path}: its parent ${dir} is a file, not a directory, so the entry cannot be written there; if it is a former shared symlink checked out as a file, remove it first: git rm ${dir.slice(root.length + 1)}, commit, then sync`);
    }
  }
}

function checkReplaceable(full, path) {
  let stat;
  try {
    stat = lstatSync(full);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory() && readdirSync(full).length > 0) throw new Error(`${path}: the target holds a non-empty directory here`);
}

// Clears whatever is at the path, so the new file never writes through an existing one.
function clear(full) {
  let stat;
  try {
    stat = lstatSync(full);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory()) rmdirSync(full);
  else unlinkSync(full);
}

function writeRegular(full, data, mode) {
  clear(full);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  chmodSync(full, mode);
}

// Fetches the source's origin main and returns the fetched commit; throws with git's own cause when it cannot.
export function fetchMain(source) {
  const fetch = spawnSync('git', ['-C', source, 'fetch', '--quiet', 'origin', 'main'], { encoding: 'utf8', env: gitEnvironment() });
  if (fetch.status !== 0) throw new Error(fetch.stderr.trim() || 'git fetch origin main failed');
  const fetched = git(source, 'rev-parse', 'FETCH_HEAD');
  if (fetched === null) throw new Error('cannot read FETCH_HEAD after fetching origin main');
  return fetched;
}

// Syncs the source's manifest entries into the target, per the contract at the top of this file. fetchMain, the
// function above or a stand-in, fetches the source's origin main and returns its commit; it throws when the fetch
// fails. Returns the counts written, as { files, regions }.
export function syncInto({ source, target, canonical: requested, fetchMain }) {
  const canonical = resolveCanonical(target, requested);

  const sourceOrigin = git(source, 'remote', 'get-url', 'origin');
  if (sourceOrigin === null) throw new Error(`the source has no origin remote; it must be a clone of github.com/${canonical}`);
  if (!isGithubRepository(sourceOrigin, canonical)) {
    throw new Error(`the source's origin ${sourceOrigin} is not github.com/${canonical}`);
  }
  const targetOrigin = git(target, 'remote', 'get-url', 'origin');
  if (isGithubRepository(targetOrigin, canonical)) {
    throw new Error(`the target's origin ${targetOrigin} is the canonical github.com/${canonical}: never sync into the canonical`);
  }

  let fetched;
  try {
    fetched = fetchMain(source);
  } catch (error) {
    throw new Error(`cannot fetch the source's origin main (${error.message})`);
  }
  const head = git(source, 'rev-parse', 'HEAD');
  if (head !== fetched) {
    throw new Error(`the source is not on its freshly fetched origin main: HEAD is ${head ?? '(none)'}, origin main is ${fetched}`);
  }

  const manifest = committedManifest(source, fetched);
  if (manifest.canonical.toLowerCase() !== canonical.toLowerCase()) {
    throw new Error(`the source's manifest names the canonical ${manifest.canonical}, not ${canonical}`);
  }
  const shared = [...manifest.entries.map((entry) => entry.path), MANIFEST_PATH];
  const sourceChanges = uncommitted(source, shared);
  if (sourceChanges) throw new Error(`the source has uncommitted changes at shared paths: ${sourceChanges}`);
  const contents = committedContents(source, fetched, manifest);
  const targetChanges = uncommitted(target, shared);
  if (targetChanges) throw new Error(`the target has uncommitted changes at shared paths: ${targetChanges}`);

  const root = realpathSync(target);
  for (const entry of manifest.entries) {
    checkContained(root, entry.path);
    if (!('region' in entry)) checkReplaceable(join(root, entry.path), entry.path);
  }
  checkContained(root, MANIFEST_PATH);
  checkReplaceable(join(root, MANIFEST_PATH), MANIFEST_PATH);
  const regions = new Map(
    manifest.entries
      .filter((entry) => 'region' in entry)
      .map(({ path }) => {
        const label = `target ${path}`;
        if (!lstatSync(join(root, path), { throwIfNoEntry: false })?.isFile()) {
          throw new Error(`${label}: malformed region markers: the target has no regular file here`);
        }
        return [path, replaceRegion(readFileSync(join(root, path), 'utf8'), contents.get(path).data, label)];
      }),
  );

  const written = { files: 0, regions: 0 };
  for (const entry of manifest.entries) {
    const full = join(root, entry.path);
    if ('region' in entry) {
      writeRegular(full, regions.get(entry.path), lstatSync(full).mode & 0o777);
      written.regions += 1;
    } else {
      const { data, mode } = contents.get(entry.path);
      writeRegular(full, data, mode === '100755' ? 0o755 : 0o644);
      written.files += 1;
    }
  }
  const record = { canonical, adopters: manifest.adopters, syncedFrom: fetched, entries: manifest.entries };
  writeRegular(join(root, MANIFEST_PATH), `${JSON.stringify(record, null, 2)}\n`, 0o644);
  return written;
}

const sameEntry = (a, b) => a.sha256 === b.sha256 && a.region === b.region && a.executable === b.executable;

// Compares this repository's manifest with the canonical's manifest on main, per the --check contract at the top
// of this file. fetchCanonicalManifest(canonical) returns that manifest's raw text and throws when it cannot.
// Returns { state: 'in-sync' | 'drifted' | 'unknown', differences, cause }.
export function checkLag({ root, fetchCanonicalManifest }) {
  const unknown = (cause) => ({ state: 'unknown', differences: [], cause });
  let local;
  try {
    local = readManifest(root);
  } catch (error) {
    return unknown(error.cause?.code === 'ENOENT' ? 'no factory manifest here; run the first sync with --from' : error.message);
  }
  const label = `${local.canonical} main's ${MANIFEST_PATH}`;
  let text;
  try {
    text = fetchCanonicalManifest(local.canonical);
  } catch (error) {
    return unknown(`cannot fetch ${label} (${error.message})`);
  }
  let remote;
  try {
    remote = parseManifest(text, label);
  } catch (error) {
    return unknown(error.message);
  }

  const differences = [];
  if (local.canonical !== remote.canonical) differences.push(`canonical: ${local.canonical} here, ${remote.canonical} on main`);
  if (local.adopters.join(', ') !== remote.adopters.join(', ')) {
    differences.push(`adopters: ${local.adopters.join(', ')} here, ${remote.adopters.join(', ')} on main`);
  }
  const [here, there] = [local, remote].map(({ entries }) => new Map(entries.map((entry) => [entry.path, entry])));
  for (const path of [...new Set([...here.keys(), ...there.keys()])].sort()) {
    if (!here.has(path)) differences.push(`${path}: missing here`);
    else if (!there.has(path)) differences.push(`${path}: no longer shared`);
    else if (!sameEntry(here.get(path), there.get(path))) differences.push(`${path}: changed`);
  }
  return { state: differences.length === 0 ? 'in-sync' : 'drifted', differences, cause: null };
}
