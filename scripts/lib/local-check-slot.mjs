// local-check-slot.mjs — the places a full local check can run in on one machine.
//
// A check takes a place by binding a loopback port and holding it until its process exits; the
// operating system releases the port when the process dies, however it dies. Each place has a run
// lock, held by the whole run, and a database lock, held by the database step. A place is free only
// when both are free. Every place port stays below 32768, outside each system's automatic port range.
// A free lock shows no live check holds the place, not who made what is in it.
import { readdirSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const LOCAL_CHECK_LIMIT = 2;

export const LOCAL_CHECK_LIMIT_MESSAGE = `The full local check runs at most ${LOCAL_CHECK_LIMIT} at a time on this machine, and all ${LOCAL_CHECK_LIMIT} places are in use. Nothing ran. Run it again when one of them has finished.`;

const HOSTED_PROJECT = 'rentcottage-verification';
const HOSTED_TEMP_PREFIX = 'rentcottage-docker-config-';

export const PLACE_DATABASE_LISTING_FORMAT = '{{.Names}}|{{.Label "com.supabase.cli.project"}}|{{.Label "com.supabase.cli.workdir"}}';

const heldLocks = [];

export function localCheckSlotBusyMessage(slot) {
  return `Port ${localCheckSettings(slot).locks.database}, the database lock of place ${slot} of the full local check, is taken. An earlier check's database step may still be running or shutting down. Nothing ran. Run it again in a moment; if the port stays taken, find what is using it.`;
}

export function localCheckServerBusyMessage(slot, port) {
  return `Something still answers on port ${port}, which place ${slot} of the full local check uses for its test server. A server from an earlier check may still be running. Nothing was removed and nothing ran. Run it again when the port is free; if it stays in use, stop what is using it.`;
}

export function isHostedCheck(environment) {
  return environment.GITHUB_ACTIONS === 'true' && environment.RUNNER_ENVIRONMENT === 'github-hosted';
}

export function isLocalCheckSlotProject(name) {
  for (let slot = 1; slot <= LOCAL_CHECK_LIMIT; slot += 1) {
    if (name === `${HOSTED_PROJECT}-${slot}`) return true;
  }
  return false;
}

export function parseLocalCheckSlot(value) {
  if (value === undefined) return undefined;
  const slot = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!(slot <= LOCAL_CHECK_LIMIT)) {
    throw new Error(`VERIFY_LOCAL_SLOT must be an integer from 1 to ${LOCAL_CHECK_LIMIT}, got "${value}"`);
  }
  return slot;
}

export function localCheckSettings(slot) {
  if (slot === undefined) {
    return {
      project: HOSTED_PROJECT,
      tempPrefix: HOSTED_TEMP_PREFIX,
      ports: {
        api: 55331,
        database: 55332,
        shadowDatabase: 15330,
        pooler: 55339,
        studio: 55333,
        mail: 55334,
        analytics: 55337,
        edgeInspector: 8183,
        next: 3000,
      },
    };
  }
  const block = 15330 + slot * 10;
  return {
    project: `${HOSTED_PROJECT}-${slot}`,
    tempPrefix: `${HOSTED_TEMP_PREFIX}${slot}-`,
    ports: {
      api: block + 1,
      database: block + 2,
      shadowDatabase: block,
      pooler: block + 9,
      studio: block + 3,
      mail: block + 4,
      analytics: block + 7,
      edgeInspector: 8183 + slot * 10,
      next: 3000 + slot * 10,
      worker: 8788 + slot * 10,
    },
    locks: { run: block + 5, database: block + 6 },
  };
}

export function bindLoopbackPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(undefined);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      // A held lock must never keep its process alive.
      server.unref();
      resolve(server);
    });
  });
}

// A connection attempt, not a bind: on macOS a bind to 127.0.0.1 can succeed beside a server
// listening on every address.
export function loopbackPortAnswers(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

function release(lock) {
  return new Promise((resolve) => lock.close(resolve));
}

export async function claimRunSlot({ bind = bindLoopbackPort } = {}) {
  for (let slot = 1; slot <= LOCAL_CHECK_LIMIT; slot += 1) {
    const { locks } = localCheckSettings(slot);
    const runLock = await bind(locks.run);
    if (!runLock) continue;
    const databaseProbe = await bind(locks.database);
    if (!databaseProbe) {
      // The place's database step from an earlier check is still alive.
      await release(runLock);
      continue;
    }
    await release(databaseProbe);
    heldLocks.push(runLock);
    return slot;
  }
  return undefined;
}

export async function claimDatabaseSlot(inheritedSlot, { bind = bindLoopbackPort } = {}) {
  const first = inheritedSlot ?? 1;
  const last = inheritedSlot ?? LOCAL_CHECK_LIMIT;
  for (let slot = first; slot <= last; slot += 1) {
    const { locks } = localCheckSettings(slot);
    // An inherited place's run lock binds only when the run that passed the place on has died.
    const runLock = await bind(locks.run);
    if (!runLock && inheritedSlot === undefined) continue;
    const databaseLock = await bind(locks.database);
    if (!databaseLock) {
      if (runLock) await release(runLock);
      continue;
    }
    if (runLock) heldLocks.push(runLock);
    heldLocks.push(databaseLock);
    return slot;
  }
  return undefined;
}

function placeFolderPattern(slot) {
  return new RegExp(`^${localCheckSettings(slot).tempPrefix}[A-Za-z0-9]{6}$`);
}

export function classifyPlaceDatabase({ slot, container, listing, ownWorkdir }) {
  const lines = listing
    .split('\n')
    .map((line) => line.split('|'))
    .filter(([name]) => name === container);
  if (lines.length === 0) return { state: 'absent' };
  if (lines.length > 1 || lines[0].length !== 3) return { state: 'unproven', found: 'its labels could not be read' };
  const [, project, workdir] = lines[0];
  const madeHere =
    project === localCheckSettings(slot).project &&
    isAbsolute(workdir) &&
    basename(workdir) === 'project' &&
    placeFolderPattern(slot).test(basename(dirname(workdir))) &&
    dirname(dirname(resolve(workdir))) === dirname(dirname(resolve(ownWorkdir)));
  if (madeHere) return { state: 'made-here' };
  return { state: 'unproven', found: `its project label is "${project}" and its folder label is "${workdir}"` };
}

export function removeStaleLocalCheckFolders(slot, ownFolder, { remove = (path) => rmSync(path, { recursive: true }) } = {}) {
  const parent = dirname(ownFolder);
  const pattern = placeFolderPattern(slot);
  const stale = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name) && entry.name !== basename(ownFolder))
    .map((entry) => join(parent, entry.name));
  for (const path of stale) remove(path);
  return stale;
}
