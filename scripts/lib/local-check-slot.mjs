// local-check-slot.mjs — the places a full local check can run in on one machine.
//
// A check takes a place by binding a loopback port and holding it until its process exits; the
// operating system releases the port when the process dies, however it dies. Each place has a run
// lock, held by the whole run, and a database lock, held by the database step. A place is free only
// when both are free. Every place port stays below 32768, outside each system's automatic port range.
import { createServer } from 'node:net';

export const LOCAL_CHECK_LIMIT = 2;

export const LOCAL_CHECK_LIMIT_MESSAGE = `The full local check runs at most ${LOCAL_CHECK_LIMIT} at a time on this machine, and all ${LOCAL_CHECK_LIMIT} places are in use. Nothing ran. Run it again when one of them has finished.`;

const HOSTED_PROJECT = 'rentcottage-verification';
const HOSTED_TEMP_PREFIX = 'rentcottage-docker-config-';

const heldLocks = [];

export function localCheckSlotBusyMessage(slot) {
  return `The database step of an earlier check in place ${slot} is still running or shutting down. Nothing ran. Run it again in a moment.`;
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
