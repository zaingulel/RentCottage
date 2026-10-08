import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {
  LOCAL_CHECK_LIMIT,
  LOCAL_CHECK_LIMIT_MESSAGE,
  bindLoopbackPort,
  claimRunSlot,
  isHostedCheck,
  isLocalCheckSlotProject,
  localCheckSettings,
  parseLocalCheckSlot,
} from './local-check-slot.mjs';

// Hand-listed from the plan's table, never computed with the module's own arithmetic.
const HOSTED = {
  project: 'rentcottage-verification',
  tempPrefix: 'rentcottage-docker-config-',
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
const PLACE_1 = {
  project: 'rentcottage-verification-1',
  tempPrefix: 'rentcottage-docker-config-1-',
  ports: {
    api: 15341,
    database: 15342,
    shadowDatabase: 15340,
    pooler: 15349,
    studio: 15343,
    mail: 15344,
    analytics: 15347,
    edgeInspector: 8193,
    next: 3010,
    worker: 8798,
  },
  locks: { run: 15345, database: 15346 },
};
const PLACE_2 = {
  project: 'rentcottage-verification-2',
  tempPrefix: 'rentcottage-docker-config-2-',
  ports: {
    api: 15351,
    database: 15352,
    shadowDatabase: 15350,
    pooler: 15359,
    studio: 15353,
    mail: 15354,
    analytics: 15357,
    edgeInspector: 8203,
    next: 3020,
    worker: 8808,
  },
  locks: { run: 15355, database: 15356 },
};
const DEMO_PORTS = [56331, 56332, 56333, 56334, 56335, 56336, 56337, 56338, 56339, 16330, 8792];

// The in-memory stand-in for the machine's loopback ports, so no test binds a real place port and
// collides with a check running on this machine. `held` is what the tests inspect.
function bindDouble(held = new Set()) {
  return {
    held,
    bind: async (port) => {
      if (held.has(port)) return undefined;
      held.add(port);
      return {
        close(closed) {
          held.delete(port);
          closed();
        },
      };
    },
  };
}

test('gives each place its own project, folder prefix and ports below every automatic port range, and keeps the hosted check\'s fixed values', () => {
  assert.equal(LOCAL_CHECK_LIMIT, 2);
  assert.deepEqual(localCheckSettings(undefined), HOSTED);
  assert.deepEqual(localCheckSettings(1), PLACE_1);
  assert.deepEqual(localCheckSettings(2), PLACE_2);

  const placePorts = [1, 2].flatMap((slot) => {
    const { ports, locks } = localCheckSettings(slot);
    return [...Object.values(ports), ...Object.values(locks)];
  });
  assert.equal(placePorts.length, 24);
  for (const port of placePorts) assert.ok(port < 32768, `${port} is inside an automatic port range`);

  const everyPort = [...placePorts, ...Object.values(localCheckSettings(undefined).ports)];
  assert.equal(new Set(everyPort).size, everyPort.length);
  for (const port of DEMO_PORTS) assert.ok(!everyPort.includes(port), `${port} is a demo port`);
});

test('lets one holder at a time bind a real loopback port', async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  const holder = await bindLoopbackPort(port);
  try {
    assert.equal(holder.address().port, port);
    assert.equal(holder.address().address, '127.0.0.1');
    assert.equal(await bindLoopbackPort(port), undefined);
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

test('hands two simultaneous claims different places and refuses a third', async () => {
  const { bind, held } = bindDouble();

  const claimed = await Promise.all([claimRunSlot({ bind }), claimRunSlot({ bind })]);

  assert.deepEqual(claimed.toSorted(), [1, 2]);
  assert.deepEqual([...held].toSorted(), [15345, 15355]);
  assert.equal(await claimRunSlot({ bind }), undefined);
  assert.deepEqual([...held].toSorted(), [15345, 15355]);
  assert.equal(
    LOCAL_CHECK_LIMIT_MESSAGE,
    'The full local check runs at most 2 at a time on this machine, and all 2 places are in use. Nothing ran. Run it again when one of them has finished.',
  );
});

test('skips a place whose database step is still alive', async () => {
  const { bind, held } = bindDouble(new Set([15346]));

  assert.equal(await claimRunSlot({ bind }), 2);
  assert.deepEqual([...held].toSorted(), [15346, 15355]);
});

test('accepts only a place number within the limit', () => {
  assert.equal(parseLocalCheckSlot('1'), 1);
  assert.equal(parseLocalCheckSlot('2'), 2);
  assert.equal(parseLocalCheckSlot(undefined), undefined);
  for (const rejected of ['0', '3', '1.5', 'one', ' 1', '']) {
    assert.throws(() => parseLocalCheckSlot(rejected), /VERIFY_LOCAL_SLOT/, `accepted "${rejected}"`);
  }
});

test('recognises only the GitHub-hosted runner as hosted and only a place\'s exact project name as a place', () => {
  assert.equal(isHostedCheck({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }), true);
  assert.equal(isHostedCheck({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }), false);
  assert.equal(isHostedCheck({ RUNNER_ENVIRONMENT: 'github-hosted' }), false);
  assert.equal(isHostedCheck({}), false);

  assert.equal(isLocalCheckSlotProject('rentcottage-verification-1'), true);
  assert.equal(isLocalCheckSlotProject('rentcottage-verification-2'), true);
  assert.equal(isLocalCheckSlotProject('rentcottage-verification'), false);
  assert.equal(isLocalCheckSlotProject('rentcottage-verification-3'), false);
  assert.equal(isLocalCheckSlotProject('rentcottage-verification-1-copy'), false);
});
